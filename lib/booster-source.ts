import "server-only";
import { and, eq, gt, or } from "drizzle-orm";
import { fetchBoosterPage, type BoosterPageQuery } from "./anilist";
import { drawPack, PACK_SIZE, type BoosterCard, type PoolItem, type Rarity } from "./booster";
import { getDb } from "./db";
import { userMessage } from "./errors";
import { boosterSwipes } from "./schema";
import { getMergedList } from "./sync";

export interface BoosterRequest {
  /** Allow +18 and ecchi titles */
  adult: boolean;
}

/**
 * Where pack contents come from. Today: random picks from a cached AniList pool.
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
/** Pages fetched before the first pack is served; the rest of the pool fills in the background. */
const INITIAL_PAGES = 4;

const POPULAR: BoosterPageQuery = { page: 1, sort: "POPULARITY_DESC", isAdult: false, minScore: 64 };
const GEMS: BoosterPageQuery = {
  page: 1,
  sort: "SCORE_DESC",
  isAdult: false,
  minScore: 77,
  minPopularity: 2_500,
  maxPopularity: 40_000,
};
const ADULT: BoosterPageQuery = { page: 1, sort: "POPULARITY_DESC", isAdult: true, minScore: 64 };

const pages = (base: BoosterPageQuery, count: number) =>
  Array.from({ length: count }, (_, i) => ({ ...base, page: i + 1 }));

const SAFE_PAGES = [...pages(POPULAR, 20), ...pages(GEMS, 8)];
const ADULT_PAGES = pages(ADULT, 3);

interface Pool {
  items: Map<number, PoolItem>;
  done: Set<string>;
  expiresAt: number;
  filling: Promise<void> | null;
}

const globalForPool = globalThis as unknown as { __anisyncBoosterPool?: Pool; __anisyncBoosterRecent?: number[] };

const pageKey = (q: BoosterPageQuery) => `${q.sort}:${q.isAdult}:${q.minScore}:${q.page}`;

function currentPool(): Pool {
  const pool = globalForPool.__anisyncBoosterPool;
  if (pool && pool.expiresAt > Date.now()) return pool;
  const fresh: Pool = { items: new Map(), done: new Set(), expiresAt: Date.now() + POOL_TTL_MS, filling: null };
  globalForPool.__anisyncBoosterPool = fresh;
  return fresh;
}

async function fetchInto(pool: Pool, query: BoosterPageQuery): Promise<void> {
  const key = pageKey(query);
  if (pool.done.has(key)) return;
  const items = await fetchBoosterPage(query);
  for (const item of items) pool.items.set(item.anilistId, item);
  pool.done.add(key);
}

/** Sequential, so a full refill (~30 requests) stays far below AniList's rate limit. */
function fillInBackground(pool: Pool, queries: BoosterPageQuery[]): void {
  if (pool.filling) return;
  pool.filling = (async () => {
    for (const query of queries) {
      try {
        await fetchInto(pool, query);
      } catch (error) {
        console.warn(`[anisync] booster pool page skipped: ${userMessage(error)}`);
      }
    }
  })().finally(() => {
    pool.filling = null;
  });
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function ensurePool(adult: boolean): Promise<PoolItem[]> {
  const pool = currentPool();
  const wanted = adult ? [...SAFE_PAGES, ...ADULT_PAGES] : SAFE_PAGES;
  const missing = wanted.filter((q) => !pool.done.has(pageKey(q)));

  // A few random pages from each band make a varied first pack; adult pages join on the first adult pack.
  const first: BoosterPageQuery[] = [];
  if (pool.items.size === 0) {
    first.push(...shuffled(missing.filter((q) => q.sort === "POPULARITY_DESC" && !q.isAdult)).slice(0, INITIAL_PAGES - 1));
    first.push(...shuffled(missing.filter((q) => q.sort === "SCORE_DESC")).slice(0, 1));
  }
  if (adult && !ADULT_PAGES.some((q) => pool.done.has(pageKey(q)))) first.push(...ADULT_PAGES.slice(0, 1));
  if (first.length > 0) {
    const results = await Promise.allSettled(first.map((q) => fetchInto(pool, q)));
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (pool.items.size === 0 && failure) throw failure.reason;
  }
  fillInBackground(pool, missing);
  return [...pool.items.values()];
}

function recentlyDrawn(): number[] {
  return (globalForPool.__anisyncBoosterRecent ??= []);
}

function rememberDrawn(ids: number[]): void {
  globalForPool.__anisyncBoosterRecent = [...recentlyDrawn(), ...ids].slice(-RECENT_LIMIT);
}

async function exclusions(): Promise<{ anilist: Set<number>; mal: Set<number> }> {
  const anilist = new Set<number>(recentlyDrawn());
  const mal = new Set<number>();

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
    }
  } catch (error) {
    console.warn(`[anisync] booster without list exclusions: ${userMessage(error)}`);
  }
  return { anilist, mal };
}

export class RandomPoolSource implements BoosterSource {
  async getBoosterCards({ adult }: BoosterRequest): Promise<BoosterCard[]> {
    const [pool, exclude] = await Promise.all([ensurePool(adult), exclusions()]);
    const cards = drawPack(pool, { excludeAniList: exclude.anilist, excludeMal: exclude.mal, adult, size: PACK_SIZE });
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
