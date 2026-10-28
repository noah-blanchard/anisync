/**
 * Gold: every aggregate of the stats page, computed from (filtered) silver rows.
 * Pure functions (no I/O), unit-tested in tests/stats.test.ts. They run in the browser,
 * so a filter change recomputes everything instantly.
 */
import { CANONICAL_STATUSES, type CanonicalStatus } from "../mapping";
import { genreLabel } from "./labels";
import { mean, REFERENCE_MEAN, standardDeviation } from "./silver";
import type { LengthBucket, StatsRow } from "./types";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface StatsFilters {
  /** Empty = every status */
  statuses: CanonicalStatus[];
  genres: string[];
  /** "any": at least one of the genres, "all": every one of them */
  genreMode: "any" | "all";
  /** Every one of them */
  tags: string[];
  formats: string[];
  sources: string[];
  studios: string[];
  countries: string[];
  decades: number[];
  lengths: LengthBucket[];
  /** Inclusive, on my 1-10 scores; set = unrated titles are left out */
  scoreMin: number | null;
  scoreMax: number | null;
}

export const EMPTY_FILTERS: StatsFilters = {
  statuses: [],
  genres: [],
  genreMode: "any",
  tags: [],
  formats: [],
  sources: [],
  studios: [],
  countries: [],
  decades: [],
  lengths: [],
  scoreMin: null,
  scoreMax: null,
};

export function activeFilterCount(f: StatsFilters): number {
  return (
    f.statuses.length +
    f.genres.length +
    f.tags.length +
    f.formats.length +
    f.sources.length +
    f.studios.length +
    f.countries.length +
    f.decades.length +
    f.lengths.length +
    (f.scoreMin !== null || f.scoreMax !== null ? 1 : 0)
  );
}

export const decadeOf = (year: number) => Math.floor(year / 10) * 10;

function oneOf<T>(selected: readonly T[], value: T | null): boolean {
  return selected.length === 0 || (value !== null && selected.includes(value));
}

export function matchesFilters(row: StatsRow, f: StatsFilters): boolean {
  if (!oneOf(f.statuses, row.status)) return false;
  if (f.genres.length > 0) {
    const has = (g: string) => row.genres.includes(g);
    if (f.genreMode === "all" ? !f.genres.every(has) : !f.genres.some(has)) return false;
  }
  if (f.tags.length > 0 && !f.tags.every((t) => row.tags.includes(t))) return false;
  if (!oneOf(f.formats, row.format)) return false;
  if (!oneOf(f.sources, row.source)) return false;
  if (!oneOf(f.countries, row.country)) return false;
  if (!oneOf(f.lengths, row.length)) return false;
  if (!oneOf(f.decades, row.year !== null ? decadeOf(row.year) : null)) return false;
  if (f.studios.length > 0 && !f.studios.some((s) => row.studios.includes(s))) return false;
  if (f.scoreMin !== null || f.scoreMax !== null) {
    if (row.score === null) return false;
    if (f.scoreMin !== null && row.score < f.scoreMin) return false;
    if (f.scoreMax !== null && row.score > f.scoreMax) return false;
  }
  return true;
}

export function applyFilters(rows: readonly StatsRow[], f: StatsFilters): StatsRow[] {
  return rows.filter((r) => matchesFilters(r, f));
}

/**
 * Taste aggregates (genres, scores, profile) ignore titles still to watch,
 * unless the status filter asks for them.
 */
export function tasteRows(rows: readonly StatsRow[], f: StatsFilters): StatsRow[] {
  return f.statuses.length > 0 ? [...rows] : rows.filter((r) => r.status !== "plan_to_watch");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Linear interpolation quantile, q in 0-1. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (pos - low);
}

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const scored = (rows: readonly StatsRow[]) => rows.filter((r): r is StatsRow & { score: number } => r.score !== null);
const compared = (rows: readonly StatsRow[]) =>
  rows.filter((r): r is StatsRow & { score: number; community: number } => r.score !== null && r.community !== null);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface Overview {
  titles: number;
  episodes: number;
  minutes: number;
  rated: number;
  meanScore: number | null;
  medianScore: number | null;
  byStatus: Record<CanonicalStatus, number>;
  /** completed / (completed + dropped) */
  completionRate: number | null;
  /** Minutes left on titles in progress or paused */
  minutesLeftInProgress: number;
  /** Minutes of the titles still to watch (episode count known) */
  plannedMinutes: number;
  rewatches: number;
  sequelShare: number | null;
}

export function overview(rows: readonly StatsRow[]): Overview {
  const byStatus = Object.fromEntries(CANONICAL_STATUSES.map((s) => [s, 0])) as Record<CanonicalStatus, number>;
  let episodes = 0;
  let minutes = 0;
  let minutesLeftInProgress = 0;
  let plannedMinutes = 0;
  let rewatches = 0;
  let sequels = 0;
  let withMeta = 0;
  for (const r of rows) {
    byStatus[r.status]++;
    episodes += r.progress + r.repeat * (r.episodes ?? r.progress);
    minutes += r.minutesWatched;
    rewatches += r.repeat;
    if (r.status === "plan_to_watch") plannedMinutes += r.minutesLeft ?? 0;
    else if (r.status === "watching" || r.status === "rewatching" || r.status === "on_hold") {
      minutesLeftInProgress += r.minutesLeft ?? 0;
    }
    if (r.hasMeta) {
      withMeta++;
      if (r.isSequel) sequels++;
    }
  }
  const scores = scored(rows).map((r) => r.score);
  const ended = byStatus.completed + byStatus.dropped;
  return {
    titles: rows.length,
    episodes,
    minutes,
    rated: scores.length,
    meanScore: mean(scores),
    medianScore: median(scores),
    byStatus,
    completionRate: ended > 0 ? byStatus.completed / ended : null,
    minutesLeftInProgress,
    plannedMinutes,
    rewatches,
    sequelShare: withMeta > 0 ? sequels / withMeta : null,
  };
}

// ---------------------------------------------------------------------------
// Grouping by a dimension
// ---------------------------------------------------------------------------

export type Dimension =
  | "genre"
  | "tag"
  | "studio"
  | "format"
  | "source"
  | "country"
  | "decade"
  | "year"
  | "season"
  | "length"
  | "status"
  | "score";

const LENGTH_ORDER: LengthBucket[] = ["film", "short", "standard", "long", "saga"];
const SEASON_ORDER = ["WINTER", "SPRING", "SUMMER", "FALL"];

/** Values of a row on a dimension (several for genres, tags and studios). */
export function valuesOf(row: StatsRow, dimension: Dimension): string[] {
  switch (dimension) {
    case "genre":
      return row.genres;
    case "tag":
      return row.tags;
    case "studio":
      return row.studios;
    case "format":
      return row.format ? [row.format] : [];
    case "source":
      return row.source ? [row.source] : [];
    case "country":
      return row.country ? [row.country] : [];
    case "decade":
      return row.year !== null ? [String(decadeOf(row.year))] : [];
    case "year":
      return row.year !== null ? [String(row.year)] : [];
    case "season":
      return row.season ? [row.season] : [];
    case "length":
      return row.length ? [row.length] : [];
    case "status":
      return [row.status];
    case "score":
      return row.score !== null ? [String(row.score)] : [];
  }
}

/** Dimensions with a natural order (shown in that order rather than by value). */
export function naturalOrder(dimension: Dimension): ((a: string, b: string) => number) | null {
  switch (dimension) {
    case "decade":
    case "year":
    case "score":
      return (a, b) => Number(a) - Number(b);
    case "length":
      return (a, b) => LENGTH_ORDER.indexOf(a as LengthBucket) - LENGTH_ORDER.indexOf(b as LengthBucket);
    case "season":
      return (a, b) => SEASON_ORDER.indexOf(a) - SEASON_ORDER.indexOf(b);
    case "status":
      return (a, b) => CANONICAL_STATUSES.indexOf(a as CanonicalStatus) - CANONICAL_STATUSES.indexOf(b as CanonicalStatus);
    default:
      return null;
  }
}

export interface Group {
  value: string;
  count: number;
  /** Share of the rows that have this value (multi-valued dimensions add up to more than 100 %) */
  share: number;
  minutes: number;
  rated: number;
  meanScore: number | null;
  /** Mean normalized score minus the common base mean: above 0 = I like it more than my average title */
  affinity: number | null;
  /** Titles with both my score and a community score */
  pairs: number;
  communityMean: number | null;
  /** Mean of (my score - community score) */
  delta: number | null;
  completed: number;
  dropped: number;
  /** dropped / (completed + dropped) */
  dropRate: number | null;
}

export function groupBy(rows: readonly StatsRow[], dimension: Dimension): Group[] {
  const buckets = new Map<string, StatsRow[]>();
  for (const row of rows) {
    for (const value of new Set(valuesOf(row, dimension))) {
      let bucket = buckets.get(value);
      if (!bucket) buckets.set(value, (bucket = []));
      bucket.push(row);
    }
  }
  const groups: Group[] = [];
  for (const [value, members] of buckets) {
    const rated = scored(members);
    const pairs = compared(members);
    const normalized = rated.map((r) => r.scoreNormalized).filter((n): n is number => n !== null);
    const completed = members.filter((r) => r.status === "completed").length;
    const dropped = members.filter((r) => r.status === "dropped").length;
    const affinity = mean(normalized);
    groups.push({
      value,
      count: members.length,
      share: rows.length > 0 ? members.length / rows.length : 0,
      minutes: members.reduce((sum, r) => sum + r.minutesWatched, 0),
      rated: rated.length,
      meanScore: mean(rated.map((r) => r.score)),
      affinity: affinity !== null ? affinity - REFERENCE_MEAN : null,
      pairs: pairs.length,
      communityMean: mean(members.map((r) => r.community).filter((c): c is number => c !== null)),
      delta: mean(pairs.map((r) => r.score - r.community)),
      completed,
      dropped,
      dropRate: completed + dropped > 0 ? dropped / (completed + dropped) : null,
    });
  }
  return groups.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export type Metric = "count" | "hours" | "score" | "affinity" | "delta" | "dropRate";

/** Mean-based metrics need a few titles before they say anything. */
export const MIN_SAMPLE = 3;

export const METRICS: Record<
  Metric,
  { value: (g: Group) => number | null; sample: (g: Group) => number; diverging: boolean }
> = {
  count: { value: (g) => g.count, sample: (g) => g.count, diverging: false },
  hours: { value: (g) => g.minutes / 60, sample: (g) => g.count, diverging: false },
  score: { value: (g) => g.meanScore, sample: (g) => g.rated, diverging: false },
  affinity: { value: (g) => g.affinity, sample: (g) => g.rated, diverging: true },
  delta: { value: (g) => g.delta, sample: (g) => g.pairs, diverging: true },
  dropRate: { value: (g) => g.dropRate, sample: (g) => g.completed + g.dropped, diverging: false },
};

export interface Ranked {
  group: Group;
  value: number;
}

/**
 * Groups with a value for the metric (mean-based ones need MIN_SAMPLE titles),
 * by value, or in the dimension's natural order.
 */
export function rankGroups(
  groups: readonly Group[],
  metric: Metric,
  order: ((a: string, b: string) => number) | null = null,
): Ranked[] {
  const spec = METRICS[metric];
  const minSample = metric === "count" || metric === "hours" ? 1 : MIN_SAMPLE;
  const ranked: Ranked[] = [];
  for (const group of groups) {
    const value = spec.value(group);
    if (value === null || spec.sample(group) < minSample) continue;
    ranked.push({ group, value });
  }
  return ranked.sort((a, b) =>
    order ? order(a.group.value, b.group.value) : b.value - a.value || b.group.count - a.group.count,
  );
}

/** Pairs of values seen together (genre combos), most frequent first. */
export function combos(
  rows: readonly StatsRow[],
  dimension: "genre" | "tag",
  limit = 10,
): { a: string; b: string; count: number; meanScore: number | null }[] {
  const pairs = new Map<string, { a: string; b: string; rows: StatsRow[] }>();
  for (const row of rows) {
    const values = [...new Set(valuesOf(row, dimension))].sort();
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const key = `${values[i]}\u0000${values[j]}`;
        let pair = pairs.get(key);
        if (!pair) pairs.set(key, (pair = { a: values[i]!, b: values[j]!, rows: [] }));
        pair.rows.push(row);
      }
    }
  }
  return [...pairs.values()]
    .map((p) => ({ a: p.a, b: p.b, count: p.rows.length, meanScore: mean(scored(p.rows).map((r) => r.score)) }))
    .sort((x, y) => y.count - x.count || (y.meanScore ?? 0) - (x.meanScore ?? 0))
    .slice(0, limit);
}

/** Genres I like more than my average but rarely watch: worth digging. */
export function untappedGroups(groups: readonly Group[], limit = 5): Group[] {
  const eligible = groups.filter((g) => g.rated >= MIN_SAMPLE && g.affinity !== null);
  const typical = median(eligible.map((g) => g.count)) ?? 0;
  return eligible
    .filter((g) => g.affinity! >= 0.3 && g.count <= typical)
    .sort((a, b) => b.affinity! - a.affinity!)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export interface ScoreShares {
  /** 1-4 */
  low: number;
  /** 5-7 */
  mid: number;
  /** 8-10 */
  high: number;
}

function sharesOf(scores: readonly number[]): ScoreShares | null {
  if (scores.length === 0) return null;
  const n = scores.length;
  return {
    low: scores.filter((s) => s <= 4).length / n,
    mid: scores.filter((s) => s >= 5 && s <= 7).length / n,
    high: scores.filter((s) => s >= 8).length / n,
  };
}

export type GenerosityLevel = "very_harsh" | "harsh" | "fair" | "generous" | "very_generous";
export type SpreadLevel = "cautious" | "nuanced" | "decisive";
export type AgreementLevel = "contrarian" | "independent" | "consensual";

export const GENEROSITY_LABELS: Record<GenerosityLevel, string> = {
  very_harsh: "Très sévère",
  harsh: "Sévère",
  fair: "Juste",
  generous: "Généreux",
  very_generous: "Très généreux",
};
export const SPREAD_LABELS: Record<SpreadLevel, string> = {
  cautious: "Prudent",
  nuanced: "Nuancé",
  decisive: "Tranchant",
};
export const AGREEMENT_LABELS: Record<AgreementLevel, string> = {
  contrarian: "À contre-courant",
  independent: "Indépendant",
  consensual: "Dans le consensus",
};

export function generosityLevel(bias: number): GenerosityLevel {
  if (bias <= -1) return "very_harsh";
  if (bias <= -0.35) return "harsh";
  if (bias < 0.35) return "fair";
  if (bias < 1) return "generous";
  return "very_generous";
}

export function spreadLevel(sd: number): SpreadLevel {
  if (sd < 1) return "cautious";
  if (sd < 1.8) return "nuanced";
  return "decisive";
}

export function agreementLevel(correlation: number): AgreementLevel {
  if (correlation < 0.3) return "contrarian";
  if (correlation < 0.6) return "independent";
  return "consensual";
}

/** Below this many rated titles with a community score, bias and agreement are not shown. */
export const MIN_PAIRS = 5;

export interface RaterProfile {
  rated: number;
  unrated: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  p10: number | null;
  p90: number | null;
  /** Distinct scores used */
  distinct: number;
  /** Scores 1-10: how many titles I gave it, and how many the community "gives" (rounded average) */
  histogram: { score: number; mine: number; community: number }[];
  pairs: number;
  /** Mean of (my score - community score) on the same titles */
  bias: number | null;
  /** Pearson correlation between my scores and the community's */
  correlation: number | null;
  /** On the titles both rated, so the two sides compare */
  shares: { mine: ScoreShares; community: ScoreShares } | null;
  generosity: GenerosityLevel | null;
  /** 0-100, 50 = rates like the community */
  generosityIndex: number | null;
  spread: SpreadLevel | null;
  agreement: AgreementLevel | null;
}

export function raterProfile(rows: readonly StatsRow[]): RaterProfile {
  const rated = scored(rows);
  const scores = rated.map((r) => r.score);
  const pairs = compared(rows);
  const histogram = Array.from({ length: 10 }, (_, i) => ({ score: i + 1, mine: 0, community: 0 }));
  for (const s of scores) histogram[s - 1]!.mine++;
  for (const p of pairs) histogram[Math.min(10, Math.max(1, Math.round(p.community))) - 1]!.community++;

  const sd = standardDeviation(scores);
  const enough = pairs.length >= MIN_PAIRS;
  const bias = enough ? mean(pairs.map((p) => p.score - p.community)) : null;
  const correlation = enough
    ? pearson(
        pairs.map((p) => p.score),
        pairs.map((p) => p.community),
      )
    : null;
  const mine = sharesOf(pairs.map((p) => p.score));
  const community = sharesOf(pairs.map((p) => Math.round(p.community)));

  return {
    rated: scores.length,
    unrated: rows.length - scores.length,
    mean: mean(scores),
    median: median(scores),
    sd,
    min: scores.length ? Math.min(...scores) : null,
    max: scores.length ? Math.max(...scores) : null,
    p10: quantile(scores, 0.1),
    p90: quantile(scores, 0.9),
    distinct: new Set(scores).size,
    histogram,
    pairs: pairs.length,
    bias,
    correlation,
    shares: enough && mine && community ? { mine, community } : null,
    generosity: bias !== null ? generosityLevel(bias) : null,
    generosityIndex: bias !== null ? Math.round(clamp(50 + bias * 25)) : null,
    spread: sd !== null && scores.length >= MIN_PAIRS ? spreadLevel(sd) : null,
    agreement: correlation !== null ? agreementLevel(correlation) : null,
  };
}

/** Titles I rated furthest above (over) and below (under) the community. */
export function disagreements(
  rows: readonly StatsRow[],
  limit = 5,
): { over: (StatsRow & { gap: number })[]; under: (StatsRow & { gap: number })[] } {
  const gaps = compared(rows).map((r) => ({ ...r, gap: Math.round((r.score - r.community) * 10) / 10 }));
  return {
    over: gaps
      .filter((r) => r.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, limit),
    under: gaps
      .filter((r) => r.gap < 0)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, limit),
  };
}

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

export const DROP_BUCKETS = [
  { label: "< 10 %", max: 0.1 },
  { label: "10-25 %", max: 0.25 },
  { label: "25-50 %", max: 0.5 },
  { label: "50-75 %", max: 0.75 },
  { label: "≥ 75 %", max: Infinity },
] as const;

export interface DropStats {
  count: number;
  /** By share of the episodes seen before dropping (episode count known) */
  buckets: { label: string; count: number }[];
  /** Dropped within the first 3 episodes */
  early: number;
  medianEpisode: number | null;
  /** Rows of dropped titles, latest first */
  rows: StatsRow[];
}

export function drops(rows: readonly StatsRow[]): DropStats {
  const dropped = rows.filter((r) => r.status === "dropped");
  const buckets = DROP_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const r of dropped) {
    if (r.episodes === null || r.episodes === 0) continue;
    const ratio = r.progress / r.episodes;
    const index = DROP_BUCKETS.findIndex((b) => ratio < b.max);
    buckets[index === -1 ? buckets.length - 1 : index]!.count++;
  }
  return {
    count: dropped.length,
    buckets,
    early: dropped.filter((r) => r.progress <= 3).length,
    medianEpisode: median(dropped.map((r) => r.progress)),
    rows: [...dropped].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
  };
}

// ---------------------------------------------------------------------------
// Popularity
// ---------------------------------------------------------------------------

export const POPULARITY_BUCKETS = [
  { label: "< 10 k", max: 10_000 },
  { label: "10-50 k", max: 50_000 },
  { label: "50-150 k", max: 150_000 },
  { label: "150-400 k", max: 400_000 },
  { label: "≥ 400 k", max: Infinity },
] as const;

/** Titles by AniList member count: from hidden gems to blockbusters. */
export function popularityBuckets(rows: readonly StatsRow[]): { label: string; rows: StatsRow[] }[] {
  const buckets = POPULARITY_BUCKETS.map((b) => ({ label: b.label, rows: [] as StatsRow[] }));
  for (const r of rows) {
    if (r.popularity === null) continue;
    buckets[POPULARITY_BUCKETS.findIndex((b) => r.popularity! < b.max)]!.rows.push(r);
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Titles finished per year (from the finish date), every year in between included. */
export function completionsByYear(rows: readonly StatsRow[]): { year: number; count: number; minutes: number }[] {
  const byYear = new Map<number, { count: number; minutes: number }>();
  for (const r of rows) {
    if (r.completedAt === null) continue;
    const year = new Date(r.completedAt).getUTCFullYear();
    const bucket = byYear.get(year) ?? { count: 0, minutes: 0 };
    bucket.count++;
    bucket.minutes += r.minutesWatched;
    byYear.set(year, bucket);
  }
  if (byYear.size === 0) return [];
  const years = [...byYear.keys()];
  const out = [];
  for (let y = Math.min(...years); y <= Math.max(...years); y++) out.push({ year: y, ...(byYear.get(y) ?? { count: 0, minutes: 0 }) });
  return out;
}

/** Episodes per day between the start and finish dates of completed titles. */
export function watchPace(rows: readonly StatsRow[]): { titles: number; medianEpisodesPerDay: number | null } {
  const paces = rows
    .filter((r) => r.status === "completed" && r.startedAt !== null && r.completedAt !== null && r.episodes)
    .map((r) => {
      const days = Math.max(1, Math.round((r.completedAt! - r.startedAt!) / 86_400_000) + 1);
      return r.episodes! / days;
    });
  return { titles: paces.length, medianEpisodesPerDay: median(paces) };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

function maxBy(rows: readonly StatsRow[], value: (r: StatsRow) => number | null): StatsRow | null {
  let best: StatsRow | null = null;
  let bestValue = -Infinity;
  for (const r of rows) {
    const v = value(r);
    if (v !== null && v > bestValue) {
      best = r;
      bestValue = v;
    }
  }
  return best;
}

export interface Records {
  longest: StatsRow | null;
  oldest: StatsRow | null;
  newest: StatsRow | null;
  /** Rated 8+ with the fewest AniList members */
  hiddenGem: StatsRow | null;
  mostPopular: StatsRow | null;
  timeSink: StatsRow | null;
  mostRewatched: StatsRow | null;
}

export function records(rows: readonly StatsRow[]): Records {
  return {
    longest: maxBy(rows, (r) => r.episodes),
    oldest: maxBy(rows, (r) => (r.year !== null ? -r.year : null)),
    newest: maxBy(rows, (r) => r.year),
    hiddenGem: maxBy(rows, (r) => (r.score !== null && r.score >= 8 && r.popularity ? -r.popularity : null)),
    mostPopular: maxBy(rows, (r) => r.popularity),
    timeSink: maxBy(rows, (r) => (r.minutesWatched > 0 ? r.minutesWatched : null)),
    mostRewatched: maxBy(rows, (r) => (r.repeat > 0 ? r.repeat : null)),
  };
}

// ---------------------------------------------------------------------------
// Viewer profile: traits with a bronze / silver / gold medal
// ---------------------------------------------------------------------------

export type Medal = "bronze" | "silver" | "gold";

export function medalOf(score: number): Medal | null {
  if (score >= 85) return "gold";
  if (score >= 60) return "silver";
  if (score >= 35) return "bronze";
  return null;
}

export interface Trait {
  id: "volume" | "finisher" | "curiosity" | "gems" | "retro" | "pace" | "generosity";
  /** The axis */
  name: string;
  /** Where I stand on it */
  label: string;
  /** 0-100 along the axis */
  score: number;
  medal: Medal | null;
  detail: string;
  /** The two ends of the axis */
  poles: [string, string];
}

const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const log10 = Math.log10;

/** Number of AniList genres outside Hentai: the most a curious viewer can spread over. */
const GENRE_COUNT = 18;

export function traits(rows: readonly StatsRow[], now = Date.now()): Trait[] {
  const out: Trait[] = [];
  const watched = rows.filter((r) => r.status !== "plan_to_watch");

  const hours = watched.reduce((sum, r) => sum + r.minutesWatched, 0) / 60;
  if (watched.length > 0) {
    const score = Math.round(clamp((100 * log10(1 + hours)) / log10(1 + 2000)));
    out.push({
      id: "volume",
      name: "Assiduité",
      label: hours < 50 ? "Occasionnel" : hours < 250 ? "Régulier" : hours < 1000 ? "Assidu" : "Légende",
      score,
      medal: medalOf(score),
      detail: `${fmt.format(Math.round(hours))} h de visionnage`,
      poles: ["Occasionnel", "Légende"],
    });
  }

  const completed = watched.filter((r) => r.status === "completed").length;
  const dropped = watched.filter((r) => r.status === "dropped").length;
  if (completed + dropped >= MIN_SAMPLE) {
    const rate = completed / (completed + dropped);
    const score = Math.round(rate * 100);
    out.push({
      id: "finisher",
      name: "Persévérance",
      label: rate < 0.6 ? "Zappeur" : rate < 0.85 ? "Sélectif" : "Finisseur",
      score,
      medal: medalOf(score),
      detail: `${completed} terminés pour ${dropped} abandonnés`,
      poles: ["Zappeur", "Finisseur"],
    });
  }

  const genreCounts = new Map<string, number>();
  for (const r of watched) for (const g of r.genres) if (g !== "Hentai") genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  const total = [...genreCounts.values()].reduce((a, b) => a + b, 0);
  if (genreCounts.size >= 2 && watched.length >= MIN_SAMPLE) {
    let entropy = 0;
    for (const c of genreCounts.values()) entropy -= (c / total) * Math.log(c / total);
    const score = Math.round(clamp((100 * entropy) / Math.log(GENRE_COUNT)));
    const top = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    out.push({
      id: "curiosity",
      name: "Curiosité",
      label: score < 70 ? "Spécialiste" : score < 85 ? "Curieux" : "Explorateur",
      score,
      medal: medalOf(score),
      detail: `${genreCounts.size} genres, surtout ${genreLabel(top)}`,
      poles: ["Spécialiste", "Explorateur"],
    });
  }

  const popularity = median(watched.map((r) => r.popularity).filter((p): p is number => p !== null && p > 0));
  if (popularity !== null) {
    const score = Math.round(clamp((100 * (log10(400_000) - log10(popularity))) / (log10(400_000) - log10(4_000))));
    out.push({
      id: "gems",
      name: "Flair",
      label: score < 35 ? "Mainstream" : score < 65 ? "Équilibré" : "Défricheur",
      score,
      medal: medalOf(score),
      detail: `Popularité médiane : ${fmt.format(Math.round(popularity))} membres AniList`,
      poles: ["Mainstream", "Défricheur"],
    });
  }

  const year = median(watched.map((r) => r.year).filter((y): y is number => y !== null));
  if (year !== null) {
    const age = new Date(now).getUTCFullYear() - year;
    const score = Math.round(clamp((100 * age) / 25));
    out.push({
      id: "retro",
      name: "Époque",
      label: age < 5 ? "Chasseur de nouveautés" : age < 12 ? "Éclectique" : "Archéologue",
      score,
      medal: medalOf(score),
      detail: `Année médiane de sortie : ${Math.round(year)}`,
      poles: ["Nouveautés", "Archéologue"],
    });
  }

  const pace = watchPace(watched);
  if (pace.medianEpisodesPerDay !== null && pace.titles >= MIN_PAIRS) {
    const epd = pace.medianEpisodesPerDay;
    // 0.25 episode a day (one a month… almost) -> 0, 6 a day -> 100, on a log scale.
    const score = Math.round(clamp((100 * (log10(epd) - log10(0.25))) / (log10(6) - log10(0.25))));
    out.push({
      id: "pace",
      name: "Rythme",
      label: score < 35 ? "Contemplatif" : score < 65 ? "Régulier" : "Binge-watcher",
      score,
      medal: medalOf(score),
      detail: `${fmt.format(Math.round(epd * 10) / 10)} épisodes par jour en médiane (${pace.titles} titres datés)`,
      poles: ["Contemplatif", "Binge-watcher"],
    });
  }

  const rater = raterProfile(watched);
  if (rater.bias !== null && rater.generosityIndex !== null && rater.generosity) {
    out.push({
      id: "generosity",
      name: "Générosité",
      label: GENEROSITY_LABELS[rater.generosity],
      score: rater.generosityIndex,
      medal: medalOf(Math.abs(rater.generosityIndex - 50) * 2),
      detail: `${rater.bias >= 0 ? "+" : "−"}${fmt.format(Math.abs(Math.round(rater.bias * 10) / 10))} pt en moyenne par rapport à la communauté`,
      poles: ["Sévère", "Généreux"],
    });
  }

  return out;
}
