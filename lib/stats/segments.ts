/**
 * Gold, compare side: two selections of the same list (segments A and B) side by side.
 * Pure functions (no I/O), unit-tested in tests/stats-v3.test.ts.
 */
import { groupBy, median, overview, raterProfile } from "./gold";
import { mean } from "./silver";
import type { StatsRow } from "./types";

export interface SegmentSummary {
  titles: number;
  hours: number;
  rated: number;
  meanScore: number | null;
  /** On the common base: comparable whatever my generosity */
  meanNormalized: number | null;
  completionRate: number | null;
  /** Mean gap with the community on the same titles */
  bias: number | null;
  medianPopularity: number | null;
  medianYear: number | null;
  sequelShare: number | null;
  /** Mean episodes of the titles */
  meanEpisodes: number | null;
}

export function summarize(rows: readonly StatsRow[]): SegmentSummary {
  const o = overview(rows);
  const rater = raterProfile(rows);
  return {
    titles: o.titles,
    hours: o.minutes / 60,
    rated: o.rated,
    meanScore: o.meanScore,
    meanNormalized: mean(rows.map((r) => r.scoreNormalized).filter((n): n is number => n !== null)),
    completionRate: o.completionRate,
    bias: rater.bias,
    medianPopularity: median(rows.map((r) => r.popularity).filter((p): p is number => p !== null)),
    medianYear: median(rows.map((r) => r.year).filter((y): y is number => y !== null)),
    sequelShare: o.sequelShare,
    meanEpisodes: mean(rows.map((r) => r.episodes).filter((e): e is number => e !== null)),
  };
}

/** Share of the rated titles at each score 1-10, so segments of different sizes compare. */
export function scoreShares(rows: readonly StatsRow[]): number[] {
  const counts = Array.from({ length: 10 }, () => 0);
  let total = 0;
  for (const r of rows) {
    if (r.score === null) continue;
    counts[r.score - 1]!++;
    total++;
  }
  return counts.map((c) => (total > 0 ? c / total : 0));
}

/** The genres that matter in either segment, with their share of titles in each. */
export function genreShares(
  a: readonly StatsRow[],
  b: readonly StatsRow[],
  limit = 10,
): { genre: string; a: number; b: number }[] {
  const ga = new Map(groupBy(a, "genre").map((g) => [g.value, g.share]));
  const gb = new Map(groupBy(b, "genre").map((g) => [g.value, g.share]));
  return [...new Set([...ga.keys(), ...gb.keys()])]
    .map((genre) => ({ genre, a: ga.get(genre) ?? 0, b: gb.get(genre) ?? 0 }))
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || x.genre.localeCompare(y.genre))
    .slice(0, limit);
}
