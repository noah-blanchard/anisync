/**
 * Gold, time side: when I watch, at what pace, how long after release.
 * Pure functions (no I/O), unit-tested in tests/stats-v2.test.ts. Dates are calendar dates (UTC).
 */
import { median } from "./gold";
import type { StatsRow } from "./types";

export const DAY_MS = 86_400_000;

/** "2024-03-15" */
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Months since year 0: consecutive months differ by 1 */
export const monthIndex = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
export const monthStart = (index: number) => Date.UTC(Math.floor(index / 12), index % 12, 1);
const dayNumber = (ms: number) => Math.floor(ms / DAY_MS);

const completed = (rows: readonly StatsRow[]) =>
  rows.filter((r): r is StatsRow & { completedAt: number } => r.completedAt !== null);

/** Years with at least one finished title, latest first. */
export function completionYears(rows: readonly StatsRow[]): number[] {
  return [...new Set(completed(rows).map((r) => new Date(r.completedAt).getUTCFullYear()))].sort((a, b) => b - a);
}

/** Titles finished each day ("YYYY-MM-DD" -> rows). */
export function completionsByDay(rows: readonly StatsRow[]): Map<string, StatsRow[]> {
  const days = new Map<string, StatsRow[]>();
  for (const r of completed(rows)) {
    const key = dayKey(r.completedAt);
    const list = days.get(key);
    if (list) list.push(r);
    else days.set(key, [r]);
  }
  return days;
}

/** The longest a title can be spread over: past this, its start date is likely wrong. */
const MAX_SPREAD_DAYS = 3 * 365;

/**
 * Minutes of a finished title per month: spread evenly between its start and finish dates,
 * or all on the finish month when the start is unknown.
 */
export function spreadMinutes(row: StatsRow): Map<number, number> {
  const out = new Map<number, number>();
  if (row.completedAt === null || row.minutesWatched <= 0) return out;
  const end = dayNumber(row.completedAt);
  const start = row.startedAt !== null ? dayNumber(row.startedAt) : end;
  if (start > end || end - start > MAX_SPREAD_DAYS) {
    out.set(monthIndex(row.completedAt), row.minutesWatched);
    return out;
  }
  const perDay = row.minutesWatched / (end - start + 1);
  for (let m = monthIndex(start * DAY_MS); m <= monthIndex(end * DAY_MS); m++) {
    const from = Math.max(start, dayNumber(monthStart(m)));
    const to = Math.min(end, dayNumber(monthStart(m + 1)) - 1);
    if (to >= from) out.set(m, (out.get(m) ?? 0) + perDay * (to - from + 1));
  }
  return out;
}

export interface MonthActivity {
  month: number;
  /** Titles finished that month */
  count: number;
  /** Estimated minutes watched that month (finished titles spread over their dates) */
  minutes: number;
}

/** The last `months` months, the current one included. */
export function monthlyActivity(rows: readonly StatsRow[], now = Date.now(), months = 24): MonthActivity[] {
  const last = monthIndex(now);
  const first = last - months + 1;
  const out: MonthActivity[] = Array.from({ length: months }, (_, i) => ({ month: first + i, count: 0, minutes: 0 }));
  for (const r of completed(rows)) {
    const m = monthIndex(r.completedAt);
    if (m >= first && m <= last) out[m - first]!.count++;
    for (const [month, minutes] of spreadMinutes(r)) {
      if (month >= first && month <= last) out[month - first]!.minutes += minutes;
    }
  }
  return out;
}

/** Titles finished per calendar month, January first. */
export function byMonthOfYear(rows: readonly StatsRow[]): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  for (const r of completed(rows)) out[new Date(r.completedAt).getUTCMonth()]!++;
  return out;
}

/** Titles finished per weekday, Monday first. */
export function byWeekday(rows: readonly StatsRow[]): number[] {
  const out = Array.from({ length: 7 }, () => 0);
  for (const r of completed(rows)) out[(new Date(r.completedAt).getUTCDay() + 6) % 7]!++;
  return out;
}

export interface Streaks {
  /** Most consecutive months with at least one finished title */
  longest: number;
  /** First month of that run */
  longestFrom: number | null;
  /** Run still going: ends this month or last month */
  current: number;
  activeMonths: number;
  record: { month: number; count: number } | null;
}

export function streaks(rows: readonly StatsRow[], now = Date.now()): Streaks {
  const counts = new Map<number, number>();
  for (const r of completed(rows)) {
    const m = monthIndex(r.completedAt);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const months = [...counts.keys()].sort((a, b) => a - b);
  let longest = 0;
  let longestFrom: number | null = null;
  let run = 0;
  for (let i = 0; i < months.length; i++) {
    run = i > 0 && months[i] === months[i - 1]! + 1 ? run + 1 : 1;
    if (run > longest) {
      longest = run;
      longestFrom = months[i]! - run + 1;
    }
  }
  const thisMonth = monthIndex(now);
  let current = 0;
  let m = counts.has(thisMonth) ? thisMonth : thisMonth - 1;
  while (counts.has(m)) {
    current++;
    m--;
  }
  let record: Streaks["record"] = null;
  for (const [month, count] of counts) if (!record || count > record.count) record = { month, count };
  return { longest, longestFrom, current, activeMonths: months.length, record };
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

/** Days from start to finish, both included. */
export function daysToFinish(row: StatsRow): number | null {
  if (row.startedAt === null || row.completedAt === null || row.completedAt < row.startedAt) return null;
  return dayNumber(row.completedAt) - dayNumber(row.startedAt) + 1;
}

/** More than this much watching a day means the dates are wrong, not that I binged. */
const MAX_MINUTES_A_DAY = 16 * 60;

/** Episodes a day between the start and finish dates of a completed title (null when the dates are implausible). */
export function paceOf(row: StatsRow): number | null {
  const days = daysToFinish(row);
  if (row.status !== "completed" || days === null || !row.episodes) return null;
  const pace = row.episodes / days;
  return pace * row.duration > MAX_MINUTES_A_DAY ? null : pace;
}

export const PACE_BUCKETS = [
  { label: "< 0,5", max: 0.5 },
  { label: "0,5-1", max: 1 },
  { label: "1-3", max: 3 },
  { label: "3-6", max: 6 },
  { label: "≥ 6", max: Infinity },
] as const;

export interface PaceStats {
  titles: number;
  /** By episodes a day */
  buckets: { label: string; rows: StatsRow[] }[];
  medianDays: number | null;
  /** Most episodes a day (several episodes only) */
  fastest: (StatsRow & { pace: number; days: number })[];
  /** Most days to finish */
  slowest: (StatsRow & { pace: number; days: number })[];
}

export function paceStats(rows: readonly StatsRow[], limit = 5): PaceStats {
  const dated = rows.flatMap((r) => {
    const pace = paceOf(r);
    const days = daysToFinish(r);
    return pace !== null && days !== null ? [{ ...r, pace, days }] : [];
  });
  const buckets = PACE_BUCKETS.map((b) => ({ label: b.label, rows: [] as StatsRow[] }));
  for (const r of dated) buckets[PACE_BUCKETS.findIndex((b) => r.pace < b.max)]!.rows.push(r);
  return {
    titles: dated.length,
    buckets,
    medianDays: median(dated.map((r) => r.days)),
    fastest: dated
      .filter((r) => (r.episodes ?? 0) > 1)
      .sort((a, b) => b.pace - a.pace)
      .slice(0, limit),
    slowest: [...dated].sort((a, b) => b.days - a.days).slice(0, limit),
  };
}

// ---------------------------------------------------------------------------
// Simulcast: watching while it airs, or long after
// ---------------------------------------------------------------------------

/** Slack around airing dates (a show started a few days late still counts as followed live). */
const AIRING_SLACK_MS = 14 * DAY_MS;

export const DELAY_BUCKETS = [
  { label: "À la sortie", maxDays: 92 },
  { label: "< 1 an", maxDays: 365 },
  { label: "1-3 ans", maxDays: 3 * 365 },
  { label: "3-10 ans", maxDays: 3652 },
  { label: "10 ans et +", maxDays: Infinity },
] as const;

/** Started while the show was airing (null when the dates are unknown). */
export function startedWhileAiring(row: StatsRow): boolean | null {
  if (row.startedAt === null || row.airedFrom === null) return null;
  const end = row.airedTo ?? (row.airing === "RELEASING" ? Infinity : row.format === "MOVIE" ? row.airedFrom : null);
  if (end === null) return null;
  return row.startedAt >= row.airedFrom - AIRING_SLACK_MS && row.startedAt <= end + AIRING_SLACK_MS;
}

export interface SimulcastStats {
  /** Titles with both a start date and airing dates */
  dated: number;
  during: StatsRow[];
  after: StatsRow[];
  share: number | null;
  /** By time between release and my start */
  buckets: { label: string; rows: StatsRow[] }[];
  medianDelayDays: number | null;
}

export function simulcast(rows: readonly StatsRow[]): SimulcastStats {
  const during: StatsRow[] = [];
  const after: StatsRow[] = [];
  const buckets = DELAY_BUCKETS.map((b) => ({ label: b.label, rows: [] as StatsRow[] }));
  const delays: number[] = [];
  for (const r of rows) {
    const live = startedWhileAiring(r);
    if (live === null) continue;
    (live ? during : after).push(r);
    const delay = Math.max(0, (r.startedAt! - r.airedFrom!) / DAY_MS);
    delays.push(delay);
    buckets[DELAY_BUCKETS.findIndex((b) => delay < b.maxDays)]!.rows.push(r);
  }
  const dated = during.length + after.length;
  return {
    dated,
    during,
    after,
    share: dated > 0 ? during.length / dated : null,
    buckets,
    medianDelayDays: median(delays),
  };
}
