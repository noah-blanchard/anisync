/**
 * Me versus another AniList profile: shared titles, how alike we rate, and their favourites I have not seen.
 * Pure (no I/O), unit-tested in tests/stats-compare.test.ts. Scores are compared on the common base,
 * so a generous rater and a harsh one can still be a perfect match.
 */
import { pearson } from "./gold";
import { mean } from "./silver";
import type { StatsRow } from "./types";

/** Below this many titles rated by both, the compatibility is not shown. */
export const MIN_SHARED_RATINGS = 5;

export interface Pair {
  mine: StatsRow;
  theirs: StatsRow;
  /** Their normalized score minus mine */
  gap: number;
}

export interface Comparison {
  /** Titles both of us have seen (or started) */
  shared: number;
  /** Titles both of us rated */
  bothRated: number;
  /** Pearson correlation of our normalized scores */
  correlation: number | null;
  /** 0-100, from the correlation */
  compatibility: number | null;
  /** Mean of (their normalized score - mine) */
  meanGap: number | null;
  /** Titles we rate furthest apart */
  disagreements: Pair[];
  /** Titles we rate the same, best first */
  agreements: Pair[];
  /** Their best-rated titles absent from my list */
  theirFavourites: StatsRow[];
}

export type CompatibilityLevel = "soulmates" | "close" | "some" | "opposite";

export const COMPATIBILITY_LABELS: Record<CompatibilityLevel, string> = {
  soulmates: "Âmes sœurs",
  close: "Goûts proches",
  some: "Quelques points communs",
  opposite: "Goûts opposés",
};

export function compatibilityLevel(score: number): CompatibilityLevel {
  if (score >= 75) return "soulmates";
  if (score >= 60) return "close";
  if (score >= 45) return "some";
  return "opposite";
}

const seen = (r: StatsRow) => r.status !== "plan_to_watch";

export function compare(mine: readonly StatsRow[], theirs: readonly StatsRow[], limit = 6): Comparison {
  const myById = new Map<number, StatsRow>();
  for (const r of mine) if (r.anilistId !== null) myById.set(r.anilistId, r);

  const pairs: Pair[] = [];
  let shared = 0;
  for (const t of theirs) {
    const m = t.anilistId !== null ? myById.get(t.anilistId) : undefined;
    if (!m || !seen(m) || !seen(t)) continue;
    shared++;
    if (m.scoreNormalized !== null && t.scoreNormalized !== null) {
      pairs.push({ mine: m, theirs: t, gap: Math.round((t.scoreNormalized - m.scoreNormalized) * 10) / 10 });
    }
  }

  const correlation =
    pairs.length >= MIN_SHARED_RATINGS
      ? pearson(
          pairs.map((p) => p.mine.scoreNormalized!),
          pairs.map((p) => p.theirs.scoreNormalized!),
        )
      : null;

  return {
    shared,
    bothRated: pairs.length,
    correlation,
    compatibility: correlation !== null ? Math.round(((correlation + 1) / 2) * 100) : null,
    meanGap: mean(pairs.map((p) => p.gap)),
    disagreements: [...pairs].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, limit),
    agreements: pairs
      .filter((p) => Math.abs(p.gap) <= 0.5)
      .sort((a, b) => b.theirs.scoreNormalized! + b.mine.scoreNormalized! - (a.theirs.scoreNormalized! + a.mine.scoreNormalized!))
      .slice(0, limit),
    theirFavourites: theirs
      .filter((t) => t.score !== null && t.score >= 8 && t.anilistId !== null && !myById.has(t.anilistId))
      .sort((a, b) => (b.scoreNormalized ?? 0) - (a.scoreNormalized ?? 0) || (b.community ?? 0) - (a.community ?? 0))
      .slice(0, limit),
  };
}
