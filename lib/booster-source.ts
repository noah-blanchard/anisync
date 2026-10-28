import "server-only";
import { and, eq, gt, or } from "drizzle-orm";
import { fetchBoosterPage } from "./anilist";
import { drawPack, PACK_SIZE, type BoosterCard, type PoolItem, type Rarity } from "./booster";
import type { BoosterDefinition } from "./boosters";
import { getDb } from "./db";
import { userMessage } from "./errors";
import type { CanonicalStatus } from "./mapping";
import { displayState } from "./merge";
import { boosterSwipes } from "./schema";
import { getMergedList } from "./sync";

export interface BoosterRequest {
  booster: BoosterDefinition;
}

/**
 * Where pack contents come from. Today: random picks from a cached AniList pool per booster.
 * Later: a recommendation engine, without touching the API route or the UI.
 */
export interface BoosterSource {
  getBoosterCards(request: BoosterRequest): Promise<BoosterCard[]>;
}

const POOL_TTL_MS = 24 * 60 * 60_000;
/** An ignored card stays out of packs for a month. */
const SKIP_COOLDOWN_MS = 30 * 24 * 60 * 60_000;
/** Cards drawn recently are not drawn again right away, even if never swiped. */
const RECENT_LIMIT = 60;
/** Pages per band fetched before the first pack is served; the rest fills in the background. */
const INITIAL_PAGES = 2;
const DEFAULT_PAGES = 10;

interface Pool {
  items: Map<number, PoolItem>;
  /** "band:page" keys already fetched */
  fetched: Set<string>;
  /** Last page to fetch per band, lowered when AniList runs out of results */
  last: number[];
  expiresAt: number;
  filling: Promise<void> | null;
}

const globalForPool = globalThis as unknown as {
  __anisyncBoosterPools?: Map<string, Pool>;
  __anisyncBoosterRecent?: number[];
  __anisyncBoosterFills?: Promise<void>;
};

/** One pool per booster, built the first time that booster is opened, then kept for a day. */
function currentPool(booster: BoosterDefinition): Pool {
  const pools = (globalForPool.__anisyncBoosterPools ??= new Map());
  const pool = pools.get(booster.id);
  if (pool && pool.expiresAt > Date.now()) return pool;
  const fresh: Pool = {
    items: new Map(),
    fetched: new Set(),
    last: booster.filters.map((f) => f.pages ?? DEFAULT_PAGES),
    expiresAt: Date.now() + POOL_TTL_MS,
    filling: null,
  };
  pools.set(booster.id, fresh);
  return fresh;
}

async function fetchPage(pool: Pool, booster: BoosterDefinition, band: number, page: number): Promise<void> {
  const key = `${band}:${page}`;
  if (pool.fetched.has(key) || page > pool.last[band]!) return;
  const { items, hasNextPage } = await fetchBoosterPage(booster.filters[band]!, page, booster);
  for (const item of items) pool.items.set(item.anilistId, item);
  pool.fetched.add(key);
  if (!hasNextPage) pool.last[band] = Math.min(pool.last[band]!, page);
}

/**
 * Sequential, and queued behind the other boosters' fills: one AniList page at a time for the whole app,
 * so browsing every pack stays far below AniList's rate limit.
 */
function fillInBackground(pool: Pool, booster: BoosterDefinition): void {
  if (pool.filling) return;
  const previous = globalForPool.__anisyncBoosterFills ?? Promise.resolve();
  pool.filling = previous.then(async () => {
    const deepest = Math.max(...pool.last);
    for (let page = 1; page <= deepest; page++) {
      for (let band = 0; band < booster.filters.length; band++) {
        try {
          await fetchPage(pool, booster, band, page);
        } catch (error) {
          console.warn(`[anisync] booster ${booster.id} page ${page} skipped: ${userMessage(error)}`);
        }
      }
    }
  }).finally(() => {
    pool.filling = null;
  });
  globalForPool.__anisyncBoosterFills = pool.filling;
}

async function ensurePool(booster: BoosterDefinition): Promise<PoolItem[]> {
  const pool = currentPool(booster);
  if (pool.items.size === 0) {
    const first = booster.filters.flatMap((_, band) =>
      Array.from({ length: INITIAL_PAGES }, (_, i) => fetchPage(pool, booster, band, i + 1)),
    );
    const results = await Promise.allSettled(first);
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (pool.items.size === 0 && failure) throw failure.reason;
  }
  fillInBackground(pool, booster);
  return [...pool.items.values()];
}

function recentlyDrawn(): number[] {
  return (globalForPool.__anisyncBoosterRecent ??= []);
}

function rememberDrawn(ids: number[]): void {
  globalForPool.__anisyncBoosterRecent = [...recentlyDrawn(), ...ids].slice(-RECENT_LIMIT);
}

/** Statuses meaning you know a title, so its sequels make sense. */
const SEEN_STATUSES = new Set<CanonicalStatus>(["watching", "rewatching", "completed", "on_hold"]);

async function exclusions(): Promise<{ anilist: Set<number>; mal: Set<number>; seen: Set<number> }> {
  const anilist = new Set<number>(recentlyDrawn());
  const mal = new Set<number>();
  const seen = new Set<number>();

  // The swipe log covers what the list cache may not know yet (adds made seconds ago).
  const swiped = getDb()
    .select({ anilistId: boosterSwipes.anilistId })
    .from(boosterSwipes)
    .where(
      or(
        eq(boosterSwipes.decision, "added"),
        and(eq(boosterSwipes.decision, "skipped"), gt(boosterSwipes.swipedAt, Date.now() - SKIP_COOLDOWN_MS)),
      ),
    )
    .all();
  for (const row of swiped) anilist.add(row.anilistId);

  try {
    const list = await getMergedList();
    for (const entry of list.entries) {
      if (!entry.mal && !entry.anilist) continue;
      if (entry.anilistId !== null) anilist.add(entry.anilistId);
      if (entry.malId !== null) mal.add(entry.malId);
      const state = displayState(entry);
      if (entry.anilistId !== null && state && SEEN_STATUSES.has(state.status)) seen.add(entry.anilistId);
    }
  } catch (error) {
    console.warn(`[anisync] booster without list exclusions: ${userMessage(error)}`);
  }
  return { anilist, mal, seen };
}

export class RandomPoolSource implements BoosterSource {
  async getBoosterCards({ booster }: BoosterRequest): Promise<BoosterCard[]> {
    const [pool, exclude] = await Promise.all([ensurePool(booster), exclusions()]);
    const cards = drawPack(pool, {
      excludeAniList: exclude.anilist,
      excludeMal: exclude.mal,
      adult: booster.adult ?? false,
      sequels: booster.sequels,
      seen: exclude.seen,
      size: PACK_SIZE,
    });
    rememberDrawn(cards.map((c) => c.anilistId));
    return cards;
  }
}

/** The source used by /api/booster: swap this line to plug in recommendations. */
export const boosterSource: BoosterSource = new RandomPoolSource();

export function getBoosterCards(request: BoosterRequest): Promise<BoosterCard[]> {
  return boosterSource.getBoosterCards(request);
}

export function recordSwipe(swipe: { anilistId: number; decision: "added" | "skipped"; rarity: Rarity }): void {
  const row = { ...swipe, swipedAt: Date.now() };
  getDb()
    .insert(boosterSwipes)
    .values(row)
    .onConflictDoUpdate({
      target: boosterSwipes.anilistId,
      set: { decision: row.decision, rarity: row.rarity, swipedAt: row.swipedAt },
    })
    .run();
}

export function forgetSwipe(anilistId: number): void {
  getDb().delete(boosterSwipes).where(eq(boosterSwipes.anilistId, anilistId)).run();
}
