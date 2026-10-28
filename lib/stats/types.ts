import type { CanonicalStatus } from "../mapping";

export type SeasonName = "WINTER" | "SPRING" | "SUMMER" | "FALL";

/** Length of a title: a film, or its episode count band. */
export type LengthBucket = "film" | "short" | "standard" | "long" | "saga";

/** Silver: one clean row per anime of my list, with its metadata and my normalized score. */
export interface StatsRow {
  key: string;
  malId: number | null;
  anilistId: number | null;
  title: string;
  cover: string | null;
  status: CanonicalStatus;
  progress: number;
  /** 1-10, null when not rated */
  score: number | null;
  /** (score - my mean) / my standard deviation, over my whole list */
  scoreZ: number | null;
  /** Rank of the score among all my ratings, 0-100 (ties count half) */
  scorePercentile: number | null;
  /** The score moved to the common base (a typical rater: mean 7, standard deviation 1.5), 1-10 */
  scoreNormalized: number | null;
  /** Total episodes, null when unknown or still airing without a planned count */
  episodes: number | null;
  /** Minutes per episode, estimated from the format when AniList does not say */
  duration: number;
  /** Includes rewatches */
  minutesWatched: number;
  /** Minutes until the end, null when the episode count is unknown */
  minutesLeft: number | null;
  repeat: number;
  format: string | null;
  year: number | null;
  season: SeasonName | null;
  length: LengthBucket | null;
  genres: string[];
  /** Relevant, non-spoiler AniList tags */
  tags: string[];
  /** Main studios */
  studios: string[];
  source: string | null;
  country: string | null;
  /** AniList average score, 0-10 with one decimal */
  community: number | null;
  /** AniList members */
  popularity: number | null;
  isAdult: boolean;
  /** Has a prequel or a parent story */
  isSequel: boolean;
  /** AniList airing status (FINISHED, RELEASING…) */
  airing: string | null;
  /** epoch milliseconds */
  startedAt: number | null;
  completedAt: number | null;
  addedAt: number | null;
  updatedAt: number | null;
  /** false while AniList metadata is missing (MAL-only title or not fetched yet) */
  hasMeta: boolean;
}

/** How I rate, measured on my whole list: the basis of the normalized scores. */
export interface Calibration {
  /** Rated titles */
  count: number;
  mean: number | null;
  sd: number | null;
  /** My score -> its rank and its value on the common base */
  translation: { score: number; count: number; percentile: number; normalized: number }[];
}

export interface StatsPayload {
  rows: StatsRow[];
  calibration: Calibration;
  /** AniList tag -> its category ("Theme-Action", "Setting-Universe"…) */
  tagCategories: Record<string, string>;
  /** Titles whose metadata is still being fetched in the background */
  pending: number;
  errors: string[];
  fetchedAt: number;
}
