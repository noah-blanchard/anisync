/**
 * Gold, history side: how the list changed over time.
 * - From the daily bronze snapshots (read by snapshots.ts): list size and statuses per day, and a journal of changes.
 * - From the dates in the rows themselves (available at once): cumulative titles per month, scores per year.
 * Pure functions (no I/O), unit-tested in tests/stats-v3.test.ts.
 */
import { CANONICAL_STATUSES, type CanonicalStatus } from "../mapping";
import { mean } from "./silver";
import { DAY_MS, monthIndex } from "./time";
import type { StatsRow } from "./types";

/** One title in a snapshot, in the canonical model. */
export interface SnapshotEntry {
  /** AniList media id or MAL id, depending on the snapshot's service */
  id: number;
  status: CanonicalStatus;
  /** 0-10, 0 = not rated */
  score: number;
  progress: number;
}

export interface HistoryPoint {
  /** YYYY-MM-DD */
  day: string;
  total: number;
  byStatus: Record<CanonicalStatus, number>;
  meanScore: number | null;
  /** Episodes seen, all titles together */
  episodes: number;
}

export function historyPoint(day: string, entries: readonly SnapshotEntry[]): HistoryPoint {
  const byStatus = Object.fromEntries(CANONICAL_STATUSES.map((s) => [s, 0])) as Record<CanonicalStatus, number>;
  for (const e of entries) byStatus[e.status]++;
  const scores = entries.filter((e) => e.score > 0).map((e) => e.score);
  const m = mean(scores);
  return {
    day,
    total: entries.length,
    byStatus,
    meanScore: m !== null ? Math.round(m * 100) / 100 : null,
    episodes: entries.reduce((sum, e) => sum + e.progress, 0),
  };
}

export type HistoryEventKind =
  | "added"
  | "removed"
  | "started"
  | "completed"
  | "dropped"
  | "paused"
  | "status"
  | "rated"
  | "progressed";

export interface HistoryEvent {
  day: string;
  id: number;
  kind: HistoryEventKind;
  from?: number | CanonicalStatus;
  to?: number | CanonicalStatus;
}

const STATUS_EVENTS: Partial<Record<CanonicalStatus, HistoryEventKind>> = {
  completed: "completed",
  dropped: "dropped",
  on_hold: "paused",
  watching: "started",
  rewatching: "started",
};

/** What changed between two snapshots, one or more events per title. */
export function diffSnapshots(day: string, previous: readonly SnapshotEntry[], next: readonly SnapshotEntry[]): HistoryEvent[] {
  const before = new Map(previous.map((e) => [e.id, e]));
  const after = new Map(next.map((e) => [e.id, e]));
  const events: HistoryEvent[] = [];
  for (const e of next) {
    const old = before.get(e.id);
    if (!old) {
      events.push({ day, id: e.id, kind: "added", to: e.status });
      continue;
    }
    if (old.status !== e.status) {
      events.push({ day, id: e.id, kind: STATUS_EVENTS[e.status] ?? "status", from: old.status, to: e.status });
    } else if (e.progress > old.progress) {
      events.push({ day, id: e.id, kind: "progressed", from: old.progress, to: e.progress });
    }
    if (old.score !== e.score && e.score > 0) events.push({ day, id: e.id, kind: "rated", from: old.score, to: e.score });
  }
  for (const e of previous) if (!after.has(e.id)) events.push({ day, id: e.id, kind: "removed", from: e.status });
  return events;
}

export interface HistoryPayload {
  /** Which list the snapshots are of: ids in the events are this service's ids */
  service: "anilist" | "mal" | null;
  points: HistoryPoint[];
  /** Latest first */
  events: HistoryEvent[];
}

/** Points for every snapshot and the most recent events, from snapshots in day order. */
export function buildHistory(
  service: HistoryPayload["service"],
  snapshots: readonly { day: string; entries: SnapshotEntry[] }[],
  maxEvents = 300,
): HistoryPayload {
  const points = snapshots.map((s) => historyPoint(s.day, s.entries));
  const events: HistoryEvent[] = [];
  for (let i = snapshots.length - 1; i > 0 && events.length < maxEvents; i--) {
    events.push(...diffSnapshots(snapshots[i]!.day, snapshots[i - 1]!.entries, snapshots[i]!.entries));
  }
  return { service, points, events: events.slice(0, maxEvents) };
}

/**
 * Backlog trend over the last `days` days of snapshots: titles to watch gained per month (least squares),
 * and when it would be empty at that pace (null when it grows or stays flat).
 */
export function backlogTrend(
  points: readonly HistoryPoint[],
  days = 60,
): { perMonth: number | null; emptyAt: number | null } {
  if (points.length < 2) return { perMonth: null, emptyAt: null };
  const lastDay = Date.parse(points.at(-1)!.day);
  const recent = points.filter((p) => lastDay - Date.parse(p.day) <= days * DAY_MS);
  if (recent.length < 2 || lastDay - Date.parse(recent[0]!.day) < 7 * DAY_MS) return { perMonth: null, emptyAt: null };
  const xs = recent.map((p) => (Date.parse(p.day) - lastDay) / DAY_MS);
  const ys = recent.map((p) => p.byStatus.plan_to_watch);
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const perDay = den > 0 ? num / den : 0;
  const current = ys.at(-1)!;
  return {
    perMonth: Math.round(perDay * 30.4 * 10) / 10,
    emptyAt: perDay < 0 && current > 0 ? lastDay + (current / -perDay) * DAY_MS : null,
  };
}

// ---------------------------------------------------------------------------
// From the rows' own dates (no snapshot needed)
// ---------------------------------------------------------------------------

/** Titles finished and added so far, month by month, from the first dated month to `now`. */
export function cumulativeByMonth(
  rows: readonly StatsRow[],
  now = Date.now(),
): { month: number; completed: number; added: number }[] {
  const done = new Map<number, number>();
  const added = new Map<number, number>();
  for (const r of rows) {
    if (r.completedAt !== null) done.set(monthIndex(r.completedAt), (done.get(monthIndex(r.completedAt)) ?? 0) + 1);
    if (r.addedAt !== null) added.set(monthIndex(r.addedAt), (added.get(monthIndex(r.addedAt)) ?? 0) + 1);
  }
  const months = [...done.keys(), ...added.keys()];
  if (months.length === 0) return [];
  const out = [];
  let c = 0;
  let a = 0;
  for (let m = Math.min(...months); m <= monthIndex(now); m++) {
    c += done.get(m) ?? 0;
    a += added.get(m) ?? 0;
    out.push({ month: m, completed: c, added: a });
  }
  return out;
}

/** My mean score and the community's on the titles I finished each year: do I get harsher? */
export function scoresByYear(
  rows: readonly StatsRow[],
): { year: number; rated: number; mine: number; community: number | null; bias: number | null }[] {
  const byYear = new Map<number, StatsRow[]>();
  for (const r of rows) {
    if (r.completedAt === null || r.score === null) continue;
    const y = new Date(r.completedAt).getUTCFullYear();
    const list = byYear.get(y);
    if (list) list.push(r);
    else byYear.set(y, [r]);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, list]) => {
      const pairs = list.filter((r) => r.community !== null);
      const community = mean(pairs.map((r) => r.community!));
      const bias = mean(pairs.map((r) => r.score! - r.community!));
      return {
        year,
        rated: list.length,
        mine: Math.round(mean(list.map((r) => r.score!))! * 10) / 10,
        community: community !== null ? Math.round(community * 10) / 10 : null,
        bias: bias !== null ? Math.round(bias * 10) / 10 : null,
      };
    });
}
