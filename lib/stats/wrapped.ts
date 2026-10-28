/**
 * Gold, Wrapped side: one year of watching, in a handful of numbers and titles.
 * Pure functions (no I/O), unit-tested in tests/stats-v3.test.ts.
 */
import { median } from "./gold";
import { achievements, traits, type Achievement, type Medal, type Trait } from "./profile";
import { mean } from "./silver";
import { daysToFinish, paceOf, simulcast, spreadMinutes } from "./time";
import type { StatsRow } from "./types";

const yearOf = (ms: number) => new Date(ms).getUTCFullYear();
const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };
const rank = (a: Achievement) => (a.medal ? MEDAL_RANK[a.medal] : 0);

/** Minutes watched during a year: every finished title spread over its dates. */
export function minutesIn(rows: readonly StatsRow[], year: number): number {
  let total = 0;
  for (const r of rows) {
    for (const [month, minutes] of spreadMinutes(r)) if (Math.floor(month / 12) === year) total += minutes;
  }
  return total;
}

export interface Wrapped {
  year: number;
  /** Titles finished during the year */
  completed: StatsRow[];
  minutes: number;
  episodes: number;
  /** Titles started during the year */
  started: number;
  /** Month (0-11) with the most titles finished */
  topMonth: { month: number; count: number } | null;
  topGenres: { genre: string; count: number }[];
  topStudio: { studio: string; count: number } | null;
  /** Best rated finished title */
  favourite: StatsRow | null;
  /** Rated 8+ with the fewest AniList members */
  gem: StatsRow | null;
  /** Rated furthest above / below the community */
  generous: { row: StatsRow; gap: number } | null;
  harsh: { row: StatsRow; gap: number } | null;
  /** Most episodes a day */
  fastest: { row: StatsRow; pace: number; days: number } | null;
  meanScore: number | null;
  medianDays: number | null;
  simulcastShare: number | null;
  /** Achievements that reached a higher tier during the year */
  newMedals: Achievement[];
  /** The profile of the year (titles finished that year) */
  traits: Trait[];
  previous: { completed: number; minutes: number; meanScore: number | null } | null;
}

function countBy(values: Iterable<string>): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Finished titles as they stood at the end of `year` (the rest of the list did not exist yet, or is unknown). */
function asOfEndOf(rows: readonly StatsRow[], year: number): StatsRow[] {
  return rows.filter((r) => r.completedAt !== null && yearOf(r.completedAt) <= year);
}

export function wrapped(rows: readonly StatsRow[], year: number): Wrapped {
  const completed = rows.filter((r) => r.completedAt !== null && yearOf(r.completedAt) === year);
  const lastYear = rows.filter((r) => r.completedAt !== null && yearOf(r.completedAt) === year - 1);
  const rated = completed.filter((r): r is StatsRow & { score: number } => r.score !== null);
  const compared = rated.filter((r): r is StatsRow & { score: number; community: number } => r.community !== null);

  const months = Array.from({ length: 12 }, () => 0);
  for (const r of completed) months[new Date(r.completedAt!).getUTCMonth()]!++;
  const best = months.reduce((top, count, month) => (count > months[top]! ? month : top), 0);

  const byGap = compared.map((r) => ({ row: r as StatsRow, gap: Math.round((r.score - r.community) * 10) / 10 }));
  const paces = completed.flatMap((r) => {
    const pace = paceOf(r);
    const days = daysToFinish(r);
    return pace !== null && days !== null && (r.episodes ?? 0) > 1 ? [{ row: r, pace, days }] : [];
  });

  const before = achievements(asOfEndOf(rows, year - 1));
  const after = achievements(asOfEndOf(rows, year));
  const previousMinutes = minutesIn(rows, year - 1);

  return {
    year,
    completed,
    minutes: minutesIn(rows, year),
    episodes: completed.reduce((sum, r) => sum + (r.episodes ?? r.progress), 0),
    started: rows.filter((r) => r.startedAt !== null && yearOf(r.startedAt) === year).length,
    topMonth: completed.length > 0 ? { month: best, count: months[best]! } : null,
    topGenres: countBy(completed.flatMap((r) => r.genres))
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count })),
    topStudio: (() => {
      const top = countBy(completed.flatMap((r) => r.studios))[0];
      return top ? { studio: top[0], count: top[1] } : null;
    })(),
    favourite:
      [...rated].sort((a, b) => b.score - a.score || (b.community ?? 0) - (a.community ?? 0) || a.title.localeCompare(b.title))[0] ??
      null,
    gem:
      rated
        .filter((r) => r.score >= 8 && r.popularity !== null)
        .sort((a, b) => a.popularity! - b.popularity!)[0] ?? null,
    generous: byGap.filter((g) => g.gap > 0).sort((a, b) => b.gap - a.gap)[0] ?? null,
    harsh: byGap.filter((g) => g.gap < 0).sort((a, b) => a.gap - b.gap)[0] ?? null,
    fastest: paces.sort((a, b) => b.pace - a.pace)[0] ?? null,
    meanScore: mean(rated.map((r) => r.score)),
    medianDays: median(completed.map(daysToFinish).filter((d): d is number => d !== null)),
    simulcastShare: simulcast(rows.filter((r) => r.startedAt !== null && yearOf(r.startedAt) === year)).share,
    newMedals: after.filter((a, i) => rank(a) > rank(before[i]!)),
    // The backlog axis needs the titles to watch, which a year of finished titles does not have.
    traits: traits(completed).filter((t) => t.id !== "backlog"),
    previous:
      lastYear.length > 0 || previousMinutes > 0
        ? {
            completed: lastYear.length,
            minutes: previousMinutes,
            meanScore: mean(lastYear.map((r) => r.score).filter((s): s is number => s !== null)),
          }
        : null,
  };
}
