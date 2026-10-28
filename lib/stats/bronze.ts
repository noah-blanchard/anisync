import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { fetchStatsListEntries, fetchStatsMedia, STATS_MEDIA_BATCH } from "../anilist";
import { getConnectionInfos } from "../connections";
import { getDb } from "../db";
import { userMessage } from "../errors";
import { fetchMalStatsEntries } from "../mal";
import { listSnapshots, statsMedia } from "../schema";
import { rawMediaSchema, type RawAniListEntry, type RawMalEntry, type RawMedia } from "./raw";

/**
 * Bronze: raw MAL and AniList payloads, stored in SQLite as received.
 * - stats_media: AniList metadata of every anime in my list (refreshed weekly)
 * - list_snapshots: my raw list on each service, one snapshot a day (the list history)
 */

const MEDIA_TTL_MS = 7 * 24 * 60 * 60_000;
/** Batches fetched before answering; the rest fills in the background (one batch at a time). */
const SYNC_BATCHES = 6;
/** After a failed batch (rate limit, outage), AniList is left alone this long. */
const BACKOFF_MS = 60_000;
const LIST_TTL_MS = 10 * 60_000;
/** Daily snapshots are kept this long, then only the first one of each month. */
const DAILY_RETENTION_DAYS = 90;

const globalForBronze = globalThis as unknown as {
  __anisyncStatsFill?: Promise<void> | null;
  __anisyncStatsBackoffUntil?: number;
  __anisyncStatsLists?: { value: RawLists; expiresAt: number };
};

// ---------------------------------------------------------------------------
// Media metadata
// ---------------------------------------------------------------------------

interface CachedMedia {
  media: RawMedia | null;
  fetchedAt: number;
}

function readMediaCache(): Map<number, CachedMedia> {
  const cache = new Map<number, CachedMedia>();
  for (const row of getDb().select().from(statsMedia).all()) {
    if (row.payload === null) {
      cache.set(row.anilistId, { media: null, fetchedAt: row.fetchedAt });
      continue;
    }
    const parsed = rawMediaSchema.safeParse(row.payload);
    if (parsed.success) cache.set(row.anilistId, { media: parsed.data, fetchedAt: row.fetchedAt });
  }
  return cache;
}

/** Fetches and stores one batch; on failure, AniList is left alone for a minute. */
async function fetchBatch(ids: number[]): Promise<void> {
  try {
    await storeBatch(ids);
  } catch (error) {
    globalForBronze.__anisyncStatsBackoffUntil = Date.now() + BACKOFF_MS;
    throw error;
  }
}

function backingOff(): boolean {
  return (globalForBronze.__anisyncStatsBackoffUntil ?? 0) > Date.now();
}

/** Ids AniList does not return are stored as empty so they are not asked again before the weekly refresh. */
async function storeBatch(ids: number[]): Promise<void> {
  const found = new Map((await fetchStatsMedia(ids)).map((m) => [m.id, m]));
  const absent = ids.filter((id) => !found.has(id));
  if (absent.length > 0) for (const m of await fetchStatsMedia(absent, true)) found.set(m.id, m);
  const fetchedAt = Date.now();
  const db = getDb();
  db.transaction((tx) => {
    for (const id of ids) {
      const payload = found.get(id) ?? null;
      tx.insert(statsMedia)
        .values({ anilistId: id, payload, fetchedAt })
        .onConflictDoUpdate({ target: statsMedia.anilistId, set: { payload, fetchedAt } })
        .run();
    }
  });
}

function batches(ids: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += STATS_MEDIA_BATCH) out.push(ids.slice(i, i + STATS_MEDIA_BATCH));
  return out;
}

/** One background fill at a time for the whole app, sequential, so AniList's rate limit stays far away. */
function fillInBackground(ids: number[]): void {
  if (ids.length === 0 || globalForBronze.__anisyncStatsFill || backingOff()) return;
  globalForBronze.__anisyncStatsFill = (async () => {
    for (const batch of batches(ids)) {
      try {
        await fetchBatch(batch);
      } catch (error) {
        console.warn(`[anisync] stats metadata batch skipped: ${userMessage(error)}`);
        return;
      }
    }
  })().finally(() => {
    globalForBronze.__anisyncStatsFill = null;
  });
}

/**
 * AniList metadata of these anime: from the cache, missing ones fetched now (a few batches),
 * the rest and the stale ones refreshed in the background.
 */
export async function loadMedia(ids: number[]): Promise<{ media: Map<number, RawMedia>; pending: number }> {
  const now = Date.now();
  let cache = readMediaCache();
  const missing = ids.filter((id) => !cache.has(id));
  const stale = ids.filter((id) => cache.has(id) && now - cache.get(id)!.fetchedAt > MEDIA_TTL_MS);

  if (missing.length > 0 && !globalForBronze.__anisyncStatsFill && !backingOff()) {
    for (const batch of batches(missing).slice(0, SYNC_BATCHES)) {
      try {
        await fetchBatch(batch);
      } catch (error) {
        console.warn(`[anisync] stats metadata deferred: ${userMessage(error)}`);
        break;
      }
    }
    cache = readMediaCache();
  }

  const stillMissing = ids.filter((id) => !cache.has(id));
  fillInBackground([...stillMissing, ...stale]);

  const media = new Map<number, RawMedia>();
  for (const id of ids) {
    const cached = cache.get(id)?.media;
    if (cached) media.set(id, cached);
  }
  return { media, pending: stillMissing.length };
}

// ---------------------------------------------------------------------------
// Raw lists and their daily snapshots
// ---------------------------------------------------------------------------

export interface RawLists {
  /** null = service not connected or list unavailable */
  anilist: RawAniListEntry[] | null;
  mal: RawMalEntry[] | null;
  errors: string[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function saveSnapshot(service: "mal" | "anilist", payload: unknown[]): void {
  const row = { service, day: today(), fetchedAt: Date.now(), payload };
  getDb()
    .insert(listSnapshots)
    .values(row)
    .onConflictDoUpdate({
      target: [listSnapshots.service, listSnapshots.day],
      set: { fetchedAt: row.fetchedAt, payload: row.payload },
    })
    .run();
}

/** Older than the retention: keep the first snapshot of each month only. */
function pruneSnapshots(): void {
  const cutoff = new Date(Date.now() - DAILY_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  const db = getDb();
  const old = db
    .select({ service: listSnapshots.service, day: listSnapshots.day })
    .from(listSnapshots)
    .where(lt(listSnapshots.day, cutoff))
    .orderBy(listSnapshots.day)
    .all();
  const kept = new Set<string>();
  for (const { service, day } of old) {
    const month = `${service}:${day.slice(0, 7)}`;
    if (!kept.has(month)) {
      kept.add(month);
      continue;
    }
    db.delete(listSnapshots).where(and(eq(listSnapshots.service, service), eq(listSnapshots.day, day))).run();
  }
}

/** My raw lists (cached 10 minutes), saved as today's snapshot. */
export async function loadRawLists(options: { force?: boolean } = {}): Promise<RawLists> {
  const cached = globalForBronze.__anisyncStatsLists;
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

  const connections = getConnectionInfos();
  const [anilist, mal] = await Promise.allSettled([
    connections.anilist ? fetchStatsListEntries() : Promise.resolve(null),
    connections.mal ? fetchMalStatsEntries() : Promise.resolve(null),
  ]);

  const value: RawLists = { anilist: null, mal: null, errors: [] };
  if (anilist.status === "fulfilled") value.anilist = anilist.value;
  else value.errors.push(`AniList : ${userMessage(anilist.reason)}`);
  if (mal.status === "fulfilled") value.mal = mal.value;
  else value.errors.push(`MAL : ${userMessage(mal.reason)}`);

  try {
    if (value.anilist) saveSnapshot("anilist", value.anilist);
    if (value.mal) saveSnapshot("mal", value.mal);
    pruneSnapshots();
  } catch (error) {
    console.warn(`[anisync] list snapshot skipped: ${userMessage(error)}`);
  }

  globalForBronze.__anisyncStatsLists = { value, expiresAt: Date.now() + LIST_TTL_MS };
  return value;
}
