/**
 * Gold, backlog side: what is left to watch, what was forgotten, and what to watch next.
 * Pure functions (no I/O), unit-tested in tests/stats-v2.test.ts.
 */
import { groupBy, median, MIN_SAMPLE } from "./gold";
import { mean, REFERENCE_MEAN } from "./silver";
import { DAY_MS, monthlyActivity } from "./time";
import type { StatsRow } from "./types";

/** A title in progress without any update for this long is considered forgotten. */
export const FORGOTTEN_DAYS = 90;

/** In progress or paused, untouched for FORGOTTEN_DAYS: oldest first. */
export function forgotten(rows: readonly StatsRow[], now = Date.now()): StatsRow[] {
  return rows
    .filter(
      (r) =>
        (r.status === "watching" || r.status === "rewatching" || r.status === "on_hold") &&
        r.updatedAt !== null &&
        now - r.updatedAt > FORGOTTEN_DAYS * DAY_MS,
    )
    .sort((a, b) => a.updatedAt! - b.updatedAt!);
}

export interface BacklogStats {
  count: number;
  minutes: number;
  /** Titles whose length is unknown (not in `minutes`) */
  unknownLength: number;
  /** Days since titles were added (AniList only) */
  medianAgeDays: number | null;
  /** Added longest ago */
  oldest: StatsRow[];
  /** Average estimated hours a month over the last 12 months */
  monthlyHours: number;
  /** At that pace, months to watch the whole backlog */
  monthsToClear: number | null;
}

export function backlogStats(rows: readonly StatsRow[], now = Date.now()): BacklogStats {
  const planned = rows.filter((r) => r.status === "plan_to_watch");
  const minutes = planned.reduce((sum, r) => sum + (r.minutesLeft ?? 0), 0);
  const ages = planned.filter((r) => r.addedAt !== null).map((r) => (now - r.addedAt!) / DAY_MS);
  const monthlyHours = monthlyActivity(rows, now, 12).reduce((sum, m) => sum + m.minutes, 0) / 60 / 12;
  return {
    count: planned.length,
    minutes,
    unknownLength: planned.filter((r) => r.minutesLeft === null).length,
    medianAgeDays: median(ages),
    oldest: planned
      .filter((r) => r.addedAt !== null)
      .sort((a, b) => a.addedAt! - b.addedAt!)
      .slice(0, 5),
    monthlyHours,
    monthsToClear: monthlyHours > 0 && minutes > 0 ? minutes / 60 / monthlyHours : null,
  };
}

export interface Suggestion {
  row: StatsRow;
  /** Expected score: community score, moved by how much I like its genres */
  predicted: number;
  /** The genre I like most among its genres, with my affinity for it */
  because: { genre: string; affinity: number } | null;
}

/**
 * What to watch next from the backlog: AniList's score, corrected by my affinity for its genres
 * (from my ratings on the titles I watched). A first, explainable recommendation.
 */
export function nextUp(rows: readonly StatsRow[], limit = 8): Suggestion[] {
  const watched = rows.filter((r) => r.status !== "plan_to_watch");
  const affinity = new Map<string, number>();
  for (const g of groupBy(watched, "genre")) {
    if (g.affinity !== null && g.rated >= MIN_SAMPLE) affinity.set(g.value, g.affinity);
  }
  return rows
    .filter((r) => r.status === "plan_to_watch")
    .map((row) => {
      const known = row.genres.filter((g) => affinity.has(g)).map((g) => ({ genre: g, affinity: affinity.get(g)! }));
      const bonus = mean(known.map((k) => k.affinity)) ?? 0;
      const best = known.sort((a, b) => b.affinity - a.affinity)[0] ?? null;
      return { row, predicted: Math.round(((row.community ?? REFERENCE_MEAN) + bonus) * 10) / 10, because: best };
    })
    .sort((a, b) => b.predicted - a.predicted || (b.row.popularity ?? 0) - (a.row.popularity ?? 0))
    .slice(0, limit);
}
