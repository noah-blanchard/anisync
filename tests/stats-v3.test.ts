import { describe, expect, it } from "vitest";
import {
  backlogTrend,
  buildHistory,
  cumulativeByMonth,
  diffSnapshots,
  historyPoint,
  scoresByYear,
  type HistoryPoint,
  type SnapshotEntry,
} from "@/lib/stats/history";
import { normalizeAniListSnapshot, normalizeMalSnapshot } from "@/lib/stats/snapshots";
import { genreShares, scoreShares, summarize } from "@/lib/stats/segments";
import { calibrate } from "@/lib/stats/silver";
import { monthIndex } from "@/lib/stats/time";
import type { StatsRow } from "@/lib/stats/types";
import { minutesIn, wrapped } from "@/lib/stats/wrapped";

function row(extra: Partial<StatsRow> = {}): StatsRow {
  return {
    key: "k",
    malId: 1,
    anilistId: 1,
    title: "T",
    cover: null,
    status: "completed",
    progress: 12,
    score: 7,
    scoreZ: null,
    scorePercentile: null,
    scoreNormalized: null,
    episodes: 12,
    duration: 24,
    minutesWatched: 288,
    minutesLeft: 0,
    repeat: 0,
    format: "TV",
    year: 2020,
    season: null,
    length: "short",
    genres: ["Action"],
    tags: [],
    studios: [],
    source: null,
    country: null,
    community: 7.5,
    popularity: 50_000,
    isAdult: false,
    isSequel: false,
    airing: null,
    airedFrom: null,
    airedTo: null,
    startedAt: null,
    completedAt: null,
    addedAt: null,
    updatedAt: null,
    hasMeta: true,
    ...extra,
  };
}

const d = (y: number, m: number, day = 1) => Date.UTC(y, m - 1, day);
const entry = (id: number, status: SnapshotEntry["status"], score = 0, progress = 0): SnapshotEntry => ({ id, status, score, progress });

describe("history: snapshots", () => {
  it("normalizes raw AniList and MAL snapshots, skipping junk", () => {
    expect(
      normalizeAniListSnapshot([{ mediaId: 5, status: "REPEATING", score: 85, progress: 3 }, { nope: true }]),
    ).toEqual([{ id: 5, status: "rewatching", score: 9, progress: 3 }]);
    expect(
      normalizeMalSnapshot([
        { node: { id: 8 }, list_status: { status: "watching", is_rewatching: true, score: 7, num_episodes_watched: 2 } },
        { node: { id: 9 }, list_status: { status: "weird" } },
      ]),
    ).toEqual([
      { id: 8, status: "rewatching", score: 7, progress: 2 },
      { id: 9, status: "plan_to_watch", score: 0, progress: 0 },
    ]);
  });

  it("summarizes a day", () => {
    const p = historyPoint("2026-10-01", [entry(1, "completed", 8, 12), entry(2, "plan_to_watch"), entry(3, "completed", 6, 24)]);
    expect(p).toMatchObject({ total: 3, meanScore: 7, episodes: 36 });
    expect(p.byStatus.completed).toBe(2);
  });

  it("turns two snapshots into events", () => {
    const events = diffSnapshots(
      "2026-10-02",
      [entry(1, "watching", 0, 3), entry(2, "watching", 0, 10), entry(3, "plan_to_watch"), entry(4, "watching", 6, 1)],
      [entry(1, "watching", 0, 7), entry(2, "completed", 9, 12), entry(4, "watching", 8, 1), entry(5, "plan_to_watch")],
    );
    expect(events).toEqual([
      { day: "2026-10-02", id: 1, kind: "progressed", from: 3, to: 7 },
      { day: "2026-10-02", id: 2, kind: "completed", from: "watching", to: "completed" },
      { day: "2026-10-02", id: 2, kind: "rated", from: 0, to: 9 },
      { day: "2026-10-02", id: 4, kind: "rated", from: 6, to: 8 },
      { day: "2026-10-02", id: 5, kind: "added", to: "plan_to_watch" },
      { day: "2026-10-02", id: 3, kind: "removed", from: "plan_to_watch" },
    ]);
  });

  it("builds points and the latest events first", () => {
    const h = buildHistory("anilist", [
      { day: "2026-10-01", entries: [entry(1, "plan_to_watch")] },
      { day: "2026-10-02", entries: [entry(1, "watching")] },
      { day: "2026-10-03", entries: [entry(1, "completed")] },
    ]);
    expect(h.points.map((p) => p.day)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(h.events.map((e) => e.kind)).toEqual(["completed", "started"]);
  });
});

describe("history: backlog trend", () => {
  const point = (day: string, planned: number): HistoryPoint => ({
    ...historyPoint(day, []),
    byStatus: { ...historyPoint(day, []).byStatus, plan_to_watch: planned },
  });

  it("projects when a shrinking backlog empties", () => {
    // 30 titles, one less every day.
    const points = Array.from({ length: 11 }, (_, i) => point(`2026-10-${String(i + 1).padStart(2, "0")}`, 30 - i));
    const t = backlogTrend(points);
    expect(t.perMonth).toBeCloseTo(-30.4, 1);
    expect(t.emptyAt).toBe(Date.UTC(2026, 9, 11) + 20 * 86_400_000);
  });

  it("has nothing to say with too little history or a growing backlog", () => {
    expect(backlogTrend([point("2026-10-01", 5)])).toEqual({ perMonth: null, emptyAt: null });
    expect(backlogTrend([point("2026-10-01", 5), point("2026-10-03", 6)])).toEqual({ perMonth: null, emptyAt: null });
    const growing = backlogTrend([point("2026-10-01", 5), point("2026-10-15", 10)]);
    expect(growing.perMonth).toBeGreaterThan(0);
    expect(growing.emptyAt).toBeNull();
  });
});

describe("history: from the rows' dates", () => {
  it("accumulates titles finished and added per month", () => {
    const months = cumulativeByMonth(
      [row({ completedAt: d(2026, 1, 5), addedAt: d(2025, 12, 1) }), row({ completedAt: d(2026, 3, 1) })],
      d(2026, 3, 20),
    );
    expect(months.map((m) => [m.month - monthIndex(d(2025, 12)), m.completed, m.added])).toEqual([
      [0, 0, 1],
      [1, 1, 1],
      [2, 1, 1],
      [3, 2, 1],
    ]);
  });

  it("compares my scores with the community's year by year", () => {
    const years = scoresByYear([
      row({ completedAt: d(2024, 1, 1), score: 9, community: 7 }),
      row({ completedAt: d(2024, 6, 1), score: 7, community: 7 }),
      row({ completedAt: d(2025, 1, 1), score: 6, community: 8 }),
      row({ completedAt: d(2025, 1, 1), score: null }),
    ]);
    expect(years).toEqual([
      { year: 2024, rated: 2, mine: 8, community: 7, bias: 1 },
      { year: 2025, rated: 1, mine: 6, community: 8, bias: -2 },
    ]);
  });
});

describe("segments", () => {
  const a = calibrate([
    row({ score: 9, genres: ["Action"], popularity: 1000, year: 2000 }),
    row({ score: 7, genres: ["Action", "Drama"], popularity: 3000, year: 2010 }),
    row({ status: "dropped", score: null, genres: ["Drama"] }),
  ]).rows;
  const b = [row({ score: 5, genres: ["Romance"] })];

  it("summarizes a segment", () => {
    const s = summarize(a);
    expect(s).toMatchObject({ titles: 3, rated: 2, meanScore: 8, completionRate: 2 / 3, medianPopularity: 3000 });
    expect(s.hours).toBeCloseTo((288 * 3) / 60);
  });

  it("compares score shares and genre shares", () => {
    expect(scoreShares(a)[8]).toBe(0.5);
    expect(scoreShares([])).toEqual(Array(10).fill(0));
    const genres = genreShares(a, b);
    expect(genres[0]).toEqual({ genre: "Romance", a: 0, b: 1 });
    expect(genres.find((g) => g.genre === "Action")).toEqual({ genre: "Action", a: 2 / 3, b: 0 });
  });
});

describe("wrapped", () => {
  const rows = [
    row({ title: "Fav", score: 10, community: 8, completedAt: d(2025, 3, 10), startedAt: d(2025, 3, 1), genres: ["Drama"], studios: ["A"] }),
    row({ title: "Gem", score: 8, community: 7, popularity: 900, completedAt: d(2025, 3, 20), genres: ["Drama", "Mystery"], studios: ["A"] }),
    row({ title: "Meh", score: 4, community: 8, completedAt: d(2025, 7, 1), startedAt: d(2025, 6, 30), genres: ["Action"], studios: ["B"] }),
    row({ title: "Old", score: 7, completedAt: d(2024, 5, 1) }),
    row({ title: "Planned", status: "plan_to_watch", completedAt: null }),
  ];

  it("sums up a year", () => {
    const w = wrapped(rows, 2025);
    expect(w.completed.map((r) => r.title)).toEqual(["Fav", "Gem", "Meh"]);
    expect(w.topMonth).toEqual({ month: 2, count: 2 });
    expect(w.topGenres[0]).toEqual({ genre: "Drama", count: 2 });
    expect(w.topStudio).toEqual({ studio: "A", count: 2 });
    expect(w.favourite?.title).toBe("Fav");
    expect(w.gem?.title).toBe("Gem");
    expect(w.generous).toMatchObject({ gap: 2 });
    expect(w.harsh).toMatchObject({ gap: -4 });
    expect(w.fastest?.row.title).toBe("Meh");
    expect(w.started).toBe(2);
    expect(w.previous).toMatchObject({ completed: 1 });
    expect(w.minutes).toBeCloseTo(288 * 3);
  });

  it("lists the medals reached during the year", () => {
    const many = Array.from({ length: 25 }, (_, i) => row({ key: `k${i}`, completedAt: d(2025, 1, 1 + i) }));
    const w = wrapped(many, 2025);
    expect(w.newMedals.map((a) => a.id)).toContain("completed");
    expect(wrapped(many, 2026).newMedals).toEqual([]);
  });

  it("counts the minutes watched within the year only", () => {
    // 10 days across the new year: 5 in each.
    expect(minutesIn([row({ startedAt: d(2024, 12, 27), completedAt: d(2025, 1, 5), minutesWatched: 100 })], 2025)).toBeCloseTo(50);
  });
});
