/**
 * Silver: from the merged list and the raw bronze payloads to one clean row per anime.
 * Pure functions (no I/O), unit-tested in tests/stats.test.ts.
 */
import { normalizeTotal } from "../mapping";
import { displayState, type MergedEntry } from "../merge";
import type { RawAniListEntry, RawMalEntry, RawMedia } from "./raw";
import type { Calibration, LengthBucket, SeasonName, StatsRow } from "./types";

/** Tags below this AniList relevance rank (0-100) describe the title too loosely. */
export const TAG_MIN_RANK = 60;

/** The common base: a typical rater on MAL / AniList. */
export const REFERENCE_MEAN = 7;
export const REFERENCE_SD = 1.5;
/** Below this, a spread is too narrow to divide by (everything rated alike). */
const MIN_SD = 0.5;

const FOLLOW_UP_RELATIONS = new Set(["PREQUEL", "PARENT"]);
const SEASONS = new Set<SeasonName>(["WINTER", "SPRING", "SUMMER", "FALL"]);

export interface SilverInput {
  entries: readonly MergedEntry[];
  media: ReadonlyMap<number, RawMedia>;
  anilist: readonly RawAniListEntry[] | null;
  mal: readonly RawMalEntry[] | null;
}

/** Minutes per episode when AniList does not say. */
export function defaultDuration(format: string | null): number {
  if (format === "MOVIE") return 90;
  if (format === "TV_SHORT" || format === "MUSIC") return 5;
  return 24;
}

export function lengthOf(format: string | null, episodes: number | null): LengthBucket | null {
  if (format === "MOVIE") return "film";
  if (episodes === null) return null;
  if (episodes <= 13) return "short";
  if (episodes <= 26) return "standard";
  if (episodes <= 64) return "long";
  return "saga";
}

/** AniList FuzzyDate -> epoch ms (UTC), null without a year. */
export function fuzzyDate(date: { year?: number | null; month?: number | null; day?: number | null } | null | undefined) {
  if (!date?.year) return null;
  return Date.UTC(date.year, (date.month ?? 1) - 1, date.day ?? 1);
}

/** MAL "YYYY-MM-DD", "YYYY-MM" or "YYYY" -> epoch ms (UTC). */
export function malDate(value: string | null | undefined): number | null {
  const match = value ? /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1900) return null;
  return Date.UTC(year, Number(match[2] ?? 1) - 1, Number(match[3] ?? 1));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function rowOf(
  entry: MergedEntry,
  media: RawMedia | undefined,
  al: RawAniListEntry | undefined,
  mal: RawMalEntry | undefined,
): StatsRow | null {
  const state = displayState(entry);
  if (!state) return null;

  const format = media?.format ?? entry.format ?? null;
  const episodes = normalizeTotal(media?.episodes) ?? normalizeTotal(entry.totalEpisodes);
  const duration = media?.duration && media.duration > 0 ? media.duration : defaultDuration(format);
  // A completed title counts in full even when the service kept no progress.
  const progress =
    state.status === "completed" && episodes !== null ? Math.max(state.progress, episodes) : state.progress;
  const repeat = Math.max(al?.repeat ?? 0, mal?.list_status.num_times_rewatched ?? 0, 0);
  const minutesWatched = progress * duration + repeat * (episodes ?? progress) * duration;
  const minutesLeft = episodes !== null ? Math.max(0, episodes - progress) * duration : null;

  const season = media?.season && SEASONS.has(media.season as SeasonName) ? (media.season as SeasonName) : null;
  const year = media?.seasonYear ?? media?.startDate?.year ?? null;
  const community = media?.averageScore ?? media?.meanScore ?? null;
  const tags = (media?.tags ?? [])
    .filter((t) => t && !t.isMediaSpoiler && !t.isGeneralSpoiler && (t.rank ?? 0) >= TAG_MIN_RANK)
    .map((t) => t!.name);

  return {
    key: entry.key,
    malId: entry.malId,
    anilistId: entry.anilistId,
    title: entry.title,
    cover: entry.cover,
    status: state.status,
    progress,
    score: state.score > 0 ? state.score : null,
    scoreZ: null,
    scorePercentile: null,
    scoreNormalized: null,
    episodes,
    duration,
    minutesWatched,
    minutesLeft,
    repeat,
    format,
    year,
    season,
    length: lengthOf(format, episodes),
    genres: (media?.genres ?? []).filter((g): g is string => Boolean(g)),
    tags,
    studios: (media?.studios?.nodes ?? []).filter((s) => s !== null && s !== undefined).map((s) => s!.name),
    source: media?.source ?? null,
    country: media?.countryOfOrigin ?? null,
    community: community !== null && community > 0 ? round1(community / 10) : null,
    popularity: media?.popularity ?? null,
    isAdult: media?.isAdult ?? false,
    isSequel: (media?.relations?.edges ?? []).some((e) => e?.relationType && FOLLOW_UP_RELATIONS.has(e.relationType)),
    airing: media?.status ?? null,
    startedAt: fuzzyDate(al?.startedAt) ?? malDate(mal?.list_status.start_date),
    completedAt: fuzzyDate(al?.completedAt) ?? malDate(mal?.list_status.finish_date),
    addedAt: al?.createdAt ? al.createdAt * 1000 : null,
    updatedAt: entry.updatedAt > 0 ? entry.updatedAt : null,
    hasMeta: media !== undefined,
  };
}

/** One row per anime in my list (entries without any state are left out). */
export function buildRows(input: SilverInput): StatsRow[] {
  const al = new Map((input.anilist ?? []).map((e) => [e.mediaId, e]));
  const mal = new Map((input.mal ?? []).map((e) => [e.node.id, e]));
  const rows: StatsRow[] = [];
  for (const entry of input.entries) {
    const media = entry.anilistId !== null ? input.media.get(entry.anilistId) : undefined;
    const row = rowOf(
      entry,
      media,
      entry.anilistId !== null ? al.get(entry.anilistId) : undefined,
      entry.malId !== null ? mal.get(entry.malId) : undefined,
    );
    if (row) rows.push(row);
  }
  return rows;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Population standard deviation. */
export function standardDeviation(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null) return null;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length);
}

/**
 * Normalizes every score against my whole list (never a filtered slice, so a title keeps its value):
 * rank among my ratings, and value on the common base, where my average becomes a 7.
 */
export function calibrate(rows: readonly StatsRow[]): { rows: StatsRow[]; calibration: Calibration } {
  const scores = rows.map((r) => r.score).filter((s): s is number => s !== null);
  const m = mean(scores);
  const sd = standardDeviation(scores);
  if (m === null || sd === null) {
    return { rows: [...rows], calibration: { count: 0, mean: null, sd: null, translation: [] } };
  }

  const spread = Math.max(sd, MIN_SD);
  const counts = new Map<number, number>();
  for (const s of scores) counts.set(s, (counts.get(s) ?? 0) + 1);
  const sorted = [...counts.keys()].sort((a, b) => a - b);
  const below = new Map<number, number>();
  let running = 0;
  for (const s of sorted) {
    below.set(s, running);
    running += counts.get(s)!;
  }

  const percentileOf = (s: number) => round1(((below.get(s)! + counts.get(s)! / 2) / scores.length) * 100);
  const zOf = (s: number) => (s - m) / spread;
  const normalizedOf = (s: number) => round1(Math.min(10, Math.max(1, REFERENCE_MEAN + REFERENCE_SD * zOf(s))));

  return {
    rows: rows.map((r) =>
      r.score === null
        ? r
        : {
            ...r,
            scoreZ: Math.round(zOf(r.score) * 100) / 100,
            scorePercentile: percentileOf(r.score),
            scoreNormalized: normalizedOf(r.score),
          },
    ),
    calibration: {
      count: scores.length,
      mean: Math.round(m * 100) / 100,
      sd: Math.round(sd * 100) / 100,
      translation: sorted.map((s) => ({
        score: s,
        count: counts.get(s)!,
        percentile: percentileOf(s),
        normalized: normalizedOf(s),
      })),
    },
  };
}

/** AniList tag name -> category, from every media seen. */
export function tagCategories(media: Iterable<RawMedia>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of media) {
    for (const t of m.tags ?? []) if (t?.category) out[t.name] = t.category;
  }
  return out;
}
