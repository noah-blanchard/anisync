import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { isTmdbEnabled } from "./env";
import { ServiceError, userMessage } from "./errors";
import type { EntryPatch, EntryState, LocalKind } from "./mapping";
import { nextLocalState, showPointers } from "./media-core";
import type { LocalListItem } from "./merge";
import { mediaEntries } from "./schema";
import { getTmdbDetails, isStale, readCachedDetails } from "./tmdb";
import { tmdbPosterUrl, type TmdbDetails } from "./tmdb-parse";

/** Max stale or missing TMDB details refreshed per list load, so a big list never blocks the page. */
const MAX_REFRESH_PER_LOAD = 20;
const REFRESH_CONCURRENCY = 4;

export interface LocalRef {
  kind: LocalKind;
  tmdbId: number;
}

type Row = typeof mediaEntries.$inferSelect;

function whereRef(ref: LocalRef) {
  return and(eq(mediaEntries.kind, ref.kind), eq(mediaEntries.tmdbId, ref.tmdbId));
}

function stateOf(row: Row): EntryState {
  return { status: row.status, progress: row.progress, score: row.score, updatedAt: row.updatedAt, entryId: null };
}

function totalOf(details: TmdbDetails | null | undefined): number | null {
  if (!details) return null;
  return details.kind === "movie" ? 1 : showPointers(details, 0).totalEpisodes;
}

function toItem(row: Row, details: TmdbDetails | null): LocalListItem {
  const base = {
    tmdbId: row.tmdbId,
    kind: row.kind,
    title: row.title,
    originalTitle: row.originalTitle,
    cover: tmdbPosterUrl(row.posterPath),
    year: row.year,
    state: stateOf(row),
  };
  if (row.kind === "movie") {
    return { ...base, totalEpisodes: 1, nextEpisode: null, lastEpisode: null, nextAiring: null };
  }
  if (details?.kind !== "show") {
    return { ...base, totalEpisodes: null, nextEpisode: null, lastEpisode: null, nextAiring: null };
  }
  return { ...base, ...showPointers(details, row.progress) };
}

/** Refreshes the given stale entries (concurrency 4); failures keep the cache and only warn. */
async function refreshDetails(refs: LocalRef[]): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < refs.length) {
      const ref = refs[next++] as LocalRef;
      try {
        await getTmdbDetails(ref.kind, ref.tmdbId, { force: true });
      } catch (error) {
        console.warn(`[anisync] tmdb refresh skipped (${ref.kind} ${ref.tmdbId}): ${userMessage(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, refs.length) }, worker));
}

/** Every tracked show and movie with its TMDB pointers. Never throws because of TMDB. */
export async function loadLocalList(): Promise<LocalListItem[]> {
  const rows = getDb().select().from(mediaEntries).all();
  if (rows.length === 0) return [];

  const cached = new Map(rows.map((row) => [`${row.kind}:${row.tmdbId}`, readCachedDetails(row.kind, row.tmdbId)]));
  const stale = rows
    .filter((row) => isStale(cached.get(`${row.kind}:${row.tmdbId}`), row.kind))
    .slice(0, MAX_REFRESH_PER_LOAD)
    .map((row) => ({ kind: row.kind, tmdbId: row.tmdbId }));
  if (stale.length > 0 && isTmdbEnabled()) {
    await refreshDetails(stale);
    for (const ref of stale) cached.set(`${ref.kind}:${ref.tmdbId}`, readCachedDetails(ref.kind, ref.tmdbId));
  }

  return rows.map((row) => toItem(row, cached.get(`${row.kind}:${row.tmdbId}`)?.details ?? null));
}

/**
 * Creates or updates a tracked show / movie. Creating needs TMDB (title, poster and year are
 * copied into the database); updating works offline with the cached details only.
 */
export async function writeLocalEntry(ref: LocalRef, patch: EntryPatch): Promise<EntryState> {
  const db = getDb();
  const existing = db.select().from(mediaEntries).where(whereRef(ref)).get();
  const now = Date.now();

  if (!existing) {
    const details = await getTmdbDetails(ref.kind, ref.tmdbId);
    if (!details) throw new ServiceError("tmdb", 404, "Titre introuvable sur TMDB");
    const { state, startedAt, completedAt } = nextLocalState(ref.kind, null, patch, totalOf(details), now);
    db.insert(mediaEntries)
      .values({
        kind: ref.kind,
        tmdbId: ref.tmdbId,
        title: details.title,
        originalTitle: details.originalTitle,
        posterPath: details.posterPath,
        year: details.year,
        status: state.status,
        progress: state.progress,
        score: state.score,
        addedAt: now,
        updatedAt: now,
        startedAt: startedAt ?? null,
        completedAt: completedAt ?? null,
      })
      .run();
    return state;
  }

  const total = totalOf(readCachedDetails(ref.kind, ref.tmdbId)?.details);
  const { state, startedAt, completedAt } = nextLocalState(
    ref.kind,
    { ...stateOf(existing), startedAt: existing.startedAt, completedAt: existing.completedAt },
    patch,
    total,
    now,
  );
  db.update(mediaEntries)
    .set({
      status: state.status,
      progress: state.progress,
      score: state.score,
      updatedAt: now,
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
    })
    .where(whereRef(ref))
    .run();
  return state;
}

/** One tracked entry with its pointers, from the database and the TMDB cache only (no network). */
export function readLocalItem(ref: LocalRef): LocalListItem | null {
  const row = getDb().select().from(mediaEntries).where(whereRef(ref)).get();
  if (!row) return null;
  return toItem(row, readCachedDetails(ref.kind, ref.tmdbId)?.details ?? null);
}

export function removeLocalEntry(ref: LocalRef): void {
  getDb().delete(mediaEntries).where(whereRef(ref)).run();
}
