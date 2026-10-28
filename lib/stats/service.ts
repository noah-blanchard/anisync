import "server-only";
import { userMessage } from "../errors";
import { getMergedList } from "../sync";
import { loadMedia, loadRawLists } from "./bronze";
import type { RawMedia } from "./raw";
import { buildRows, calibrate, tagCategories } from "./silver";
import type { StatsPayload } from "./types";

const CACHE_TTL_MS = 60_000;

const globalForStats = globalThis as unknown as {
  __anisyncStats?: { payload: StatsPayload; expiresAt: number };
  __anisyncStatsInFlight?: Promise<StatsPayload> | null;
};

/** Bronze (raw payloads) -> silver (one row per anime, normalized scores). Gold runs in the browser. */
async function loadStats(force: boolean): Promise<StatsPayload> {
  const [list, raw] = await Promise.all([getMergedList({ force }), loadRawLists({ force })]);
  const errors = [...Object.values(list.errors), ...raw.errors];

  const ids = [...new Set(list.entries.map((e) => e.anilistId).filter((id): id is number => id !== null))];
  let media = new Map<number, RawMedia>();
  let pending = 0;
  try {
    ({ media, pending } = await loadMedia(ids));
  } catch (error) {
    errors.push(`Métadonnées : ${userMessage(error)}`);
  }

  const { rows, calibration } = calibrate(
    buildRows({ entries: list.entries, media, anilist: raw.anilist, mal: raw.mal }),
  );
  return { rows, calibration, tagCategories: tagCategories(media.values()), pending, errors, fetchedAt: Date.now() };
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
