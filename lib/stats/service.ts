import "server-only";
import { fetchUserList } from "../anilist";
import { userMessage } from "../errors";
import type { MergedEntry } from "../merge";
import { getMergedList } from "../sync";
import { loadMedia, loadRawLists, saveUserSnapshot } from "./bronze";
import type { RawAniListEntry, RawMalEntry, RawMedia, RawUser, RawUserEntry } from "./raw";
import { buildRows, calibrate, entriesFromUserList, tagCategories } from "./silver";
import type { StatsPayload } from "./types";

const CACHE_TTL_MS = 60_000;
/** Someone else's list is fetched again after this long (or on refresh). */
const USER_LIST_TTL_MS = 10 * 60_000;

type UserList = { user: RawUser; entries: RawUserEntry[] };

const globalForStats = globalThis as unknown as {
  __anisyncStats?: { payload: StatsPayload; expiresAt: number };
  __anisyncStatsInFlight?: Promise<StatsPayload> | null;
  __anisyncUserLists?: Map<string, { list: UserList; expiresAt: number }>;
  __anisyncUserStatsInFlight?: Map<string, Promise<StatsPayload>>;
};

/** Bronze (raw payloads) -> silver (one row per anime, normalized scores). Gold runs in the browser. */
async function toSilver(
  entries: MergedEntry[],
  raw: { anilist: RawAniListEntry[] | null; mal: RawMalEntry[] | null },
  errors: string[],
): Promise<StatsPayload> {
  const ids = [...new Set(entries.map((e) => e.anilistId).filter((id): id is number => id !== null))];
  let media = new Map<number, RawMedia>();
  let pending = 0;
  try {
    ({ media, pending } = await loadMedia(ids));
  } catch (error) {
    errors.push(`Métadonnées : ${userMessage(error)}`);
  }
  const { rows, calibration } = calibrate(buildRows({ entries, media, anilist: raw.anilist, mal: raw.mal }));
  return { rows, calibration, tagCategories: tagCategories(media.values()), pending, errors, fetchedAt: Date.now() };
}

async function loadStats(force: boolean): Promise<StatsPayload> {
  const [list, raw] = await Promise.all([getMergedList({ force }), loadRawLists({ force })]);
  return toSilver(list.entries, raw, [...Object.values(list.errors), ...raw.errors]);
}

export async function getStats(options: { force?: boolean } = {}): Promise<StatsPayload> {
  const cached = globalForStats.__anisyncStats;
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.payload;

  globalForStats.__anisyncStatsInFlight ??= loadStats(options.force ?? false)
    .then((payload) => {
      // While metadata is still coming in, do not cache: the next poll should see the progress.
      if (payload.pending === 0) globalForStats.__anisyncStats = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
      return payload;
    })
    .finally(() => {
      globalForStats.__anisyncStatsInFlight = null;
    });
  return globalForStats.__anisyncStatsInFlight;
}

// ---------------------------------------------------------------------------
// Someone else's public AniList profile
// ---------------------------------------------------------------------------

async function userList(name: string, force: boolean): Promise<UserList> {
  const lists = (globalForStats.__anisyncUserLists ??= new Map());
  const key = name.toLowerCase();
  const cached = lists.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.list;

  const list = await fetchUserList(name);
  try {
    saveUserSnapshot(list.user, list.entries);
  } catch (error) {
    console.warn(`[anisync] user snapshot skipped: ${userMessage(error)}`);
  }
  lists.set(key, { list, expiresAt: Date.now() + USER_LIST_TTL_MS });
  return list;
}

async function loadUserStats(name: string, force: boolean): Promise<StatsPayload> {
  const { user, entries } = await userList(name, force);
  const payload = await toSilver(entriesFromUserList(entries), { anilist: entries, mal: null }, []);
  return {
    ...payload,
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar?.medium ?? null,
      url: user.siteUrl ?? `https://anilist.co/user/${encodeURIComponent(user.name)}`,
    },
  };
}

/** The same stats for a public AniList profile (the AniList side only: no MAL list to merge). */
export function getUserStats(name: string, options: { force?: boolean } = {}): Promise<StatsPayload> {
  const inFlight = (globalForStats.__anisyncUserStatsInFlight ??= new Map());
  const key = name.toLowerCase();
  let promise = inFlight.get(key);
  if (!promise) {
    promise = loadUserStats(name, options.force ?? false).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
  }
  return promise;
}

