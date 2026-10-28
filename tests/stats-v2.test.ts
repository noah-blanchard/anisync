import { describe, expect, it } from "vitest";
import { backlogStats, forgotten, nextUp } from "@/lib/stats/backlog";
import { achievement, achievements, traits } from "@/lib/stats/profile";
import {
  byMonthOfYear,
  byWeekday,
  completionsByDay,
  completionYears,
  monthIndex,
  monthlyActivity,
  paceStats,
  simulcast,
  spreadMinutes,
  startedWhileAiring,
  streaks,
} from "@/lib/stats/time";
import type { StatsRow } from "@/lib/stats/types";

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
    season: "SPRING",
    length: "short",
    genres: ["Action"],
    tags: [],
    studios: [],
    source: "MANGA",
    country: "JP",
    community: 7.5,
    popularity: 50_000,
    isAdult: false,
    isSequel: false,
    airing: "FINISHED",
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

describe("time: calendar", () => {
  const rows = [
    row({ completedAt: d(2024, 3, 4) }), // Monday
    row({ completedAt: d(2024, 3, 4) }),
    row({ completedAt: d(2025, 12, 28) }), // Sunday
    row({ completedAt: null }),
  ];

  it("lists years and days with finished titles", () => {
    expect(completionYears(rows)).toEqual([2025, 2024]);
    expect(completionsByDay(rows).get("2024-03-04")).toHaveLength(2);
  });

  it("counts by calendar month and weekday", () => {
    expect(byMonthOfYear(rows)[2]).toBe(2);
    expect(byMonthOfYear(rows)[11]).toBe(1);
    expect(byWeekday(rows)[0]).toBe(2);
    expect(byWeekday(rows)[6]).toBe(1);
  });
});

describe("time: activity", () => {
  it("spreads a title's minutes over its dates", () => {
    // 10 days, 5 in January and 5 in February.
    const spread = spreadMinutes(row({ startedAt: d(2024, 1, 27), completedAt: d(2024, 2, 5), minutesWatched: 100 }));
    expect(spread.get(monthIndex(d(2024, 1)))).toBeCloseTo(50);
    expect(spread.get(monthIndex(d(2024, 2)))).toBeCloseTo(50);
    // Unknown start: all on the finish month.
    expect([...spreadMinutes(row({ completedAt: d(2024, 2, 5), minutesWatched: 100 }))]).toEqual([[monthIndex(d(2024, 2)), 100]]);
    expect(spreadMinutes(row({ completedAt: null })).size).toBe(0);
  });

  it("returns the last months, the current one included", () => {
    const months = monthlyActivity([row({ completedAt: d(2024, 6, 10), minutesWatched: 60 })], d(2024, 6, 20), 3);
    expect(months.map((m) => m.month)).toEqual([monthIndex(d(2024, 4)), monthIndex(d(2024, 5)), monthIndex(d(2024, 6))]);
    expect(months[2]).toMatchObject({ count: 1, minutes: 60 });
  });

  it("finds streaks of active months and the record month", () => {
    const s = streaks(
      [
        row({ completedAt: d(2023, 1, 5) }),
        row({ completedAt: d(2023, 2, 5) }),
        row({ completedAt: d(2023, 3, 5) }),
        row({ completedAt: d(2023, 3, 9) }),
        row({ completedAt: d(2024, 5, 5) }),
        row({ completedAt: d(2024, 6, 5) }),
      ],
      d(2024, 7, 2),
    );
    expect(s.longest).toBe(3);
    expect(s.longestFrom).toBe(monthIndex(d(2023, 1)));
    // July has nothing yet, but the run through June still counts.
    expect(s.current).toBe(2);
    expect(s.record).toEqual({ month: monthIndex(d(2023, 3)), count: 2 });
    expect(s.activeMonths).toBe(5);
  });
});

describe("time: pace and simulcast", () => {
  it("buckets completed titles by episodes a day", () => {
    const p = paceStats([
      row({ title: "Binge", startedAt: d(2024, 1, 1), completedAt: d(2024, 1, 2) }), // 6 a day
      row({ title: "Slow", startedAt: d(2024, 1, 1), completedAt: d(2024, 3, 1) }), // 12 over 61 days
      row({ title: "Undated" }),
      // 500 episodes in a day: wrong dates, left out.
      row({ title: "Impossible", episodes: 500, startedAt: d(2024, 1, 1), completedAt: d(2024, 1, 1) }),
    ]);
    expect(p.titles).toBe(2);
    expect(p.buckets[4]!.rows.map((r) => r.title)).toEqual(["Binge"]);
    expect(p.buckets[0]!.rows.map((r) => r.title)).toEqual(["Slow"]);
    expect(p.fastest[0]!.title).toBe("Binge");
    expect(p.slowest[0]).toMatchObject({ title: "Slow", days: 61 });
  });

  it("tells titles followed while airing from the ones caught up later", () => {
    const live = row({ airedFrom: d(2024, 1, 5), airedTo: d(2024, 3, 25), startedAt: d(2024, 1, 10) });
    const late = row({ airedFrom: d(2010, 4, 1), airedTo: d(2010, 9, 20), startedAt: d(2024, 1, 10) });
    const airing = row({ airedFrom: d(2024, 1, 5), airedTo: null, airing: "RELEASING", startedAt: d(2024, 2, 1) });
    expect(startedWhileAiring(live)).toBe(true);
    expect(startedWhileAiring(late)).toBe(false);
    expect(startedWhileAiring(airing)).toBe(true);
    expect(startedWhileAiring(row({ startedAt: d(2024, 1, 1) }))).toBeNull();
    const s = simulcast([live, late, airing, row()]);
    expect(s.dated).toBe(3);
    expect(s.share).toBeCloseTo(2 / 3);
    expect(s.buckets[0]!.rows).toHaveLength(2);
    expect(s.buckets[4]!.rows).toHaveLength(1);
  });
});

describe("backlog", () => {
  const now = d(2025, 1, 1);

  it("finds forgotten titles", () => {
    const rows = [
      row({ title: "Old", status: "on_hold", updatedAt: d(2024, 1, 1) }),
      row({ title: "Fresh", status: "watching", updatedAt: d(2024, 12, 20) }),
      row({ title: "Done", status: "completed", updatedAt: d(2020, 1, 1) }),
    ];
    expect(forgotten(rows, now).map((r) => r.title)).toEqual(["Old"]);
  });

  it("sizes the backlog and the time to clear it", () => {
    const b = backlogStats(
      [
        row({ status: "plan_to_watch", minutesLeft: 600, addedAt: d(2024, 1, 1) }),
        row({ status: "plan_to_watch", minutesLeft: null, addedAt: d(2024, 7, 1) }),
        // 1 200 minutes watched in the last 12 months: 100 min a month.
        row({ completedAt: d(2024, 6, 1), minutesWatched: 1_200 }),
      ],
      now,
    );
    expect(b.count).toBe(2);
    expect(b.minutes).toBe(600);
    expect(b.unknownLength).toBe(1);
    expect(b.monthlyHours).toBeCloseTo(100 / 60);
    expect(b.monthsToClear).toBeCloseTo(6);
    expect(b.oldest[0]!.addedAt).toBe(d(2024, 1, 1));
  });

  it("suggests what to watch next from my genre affinities", () => {
    const watched = [
      ...Array.from({ length: 3 }, () => row({ genres: ["Mystery"], scoreNormalized: 9 })),
      ...Array.from({ length: 3 }, () => row({ genres: ["Sports"], scoreNormalized: 5 })),
    ];
    const planned = [
      row({ title: "Sport", status: "plan_to_watch", genres: ["Sports"], community: 8 }),
      row({ title: "Mystère", status: "plan_to_watch", genres: ["Mystery"], community: 7.5 }),
    ];
    const next = nextUp([...watched, ...planned]);
    expect(next.map((s) => s.row.title)).toEqual(["Mystère", "Sport"]);
    expect(next[0]).toMatchObject({ predicted: 9.5, because: { genre: "Mystery", affinity: 2 } });
  });
});

describe("profile v2", () => {
  it("computes achievement tiers and progress", () => {
    expect(achievement("x", "X", "", 0, [10, 20, 30])).toMatchObject({ medal: null, next: 10, progress: 0 });
    expect(achievement("x", "X", "", 15, [10, 20, 30])).toMatchObject({ medal: "bronze", next: 20, progress: 0.5 });
    expect(achievement("x", "X", "", 40, [10, 20, 30])).toMatchObject({ medal: "gold", next: null, progress: 1 });
  });

  it("counts achievements from the list", () => {
    const list = achievements([
      row({ format: "MOVIE", episodes: 1, progress: 1, year: 1985, genres: ["Drama"] }),
      row({ episodes: 120, progress: 120, length: "saga", score: 9, popularity: 5_000, repeat: 1 }),
      row({ status: "plan_to_watch", progress: 0 }),
    ]);
    const byId = Object.fromEntries(list.map((a) => [a.id, a]));
    expect(byId.completed!.value).toBe(2);
    expect(byId.movies!.value).toBe(1);
    expect(byId.retro!.medal).toBe("bronze");
    expect(byId.sagas!.value).toBe(1);
    expect(byId.gems!.value).toBe(1);
    expect(byId.rewatch!.value).toBe(1);
    expect(byId.episodes!.value).toBe(1 + 120 + 120);
    expect(byId.decades!.value).toBe(2);
  });

  it("adds the simulcast, format, franchise and backlog axes", () => {
    const rows = [
      ...Array.from({ length: 6 }, () =>
        row({ airedFrom: d(2024, 1, 1), airedTo: d(2024, 3, 1), startedAt: d(2024, 1, 10), length: "saga", isSequel: true }),
      ),
      ...Array.from({ length: 6 }, () => row({ status: "plan_to_watch" })),
    ];
    const byId = Object.fromEntries(traits(rows).map((t) => [t.id, t]));
    expect(byId.simulcast!.label).toBe("Simulcast");
    expect(byId.marathon!.label).toBe("Marathonien");
    expect(byId.franchise!.label).toBe("Fidèle aux sagas");
    expect(byId.backlog).toMatchObject({ label: "Accumulateur", score: 100 });
  });

  it("measures the generosity medal from the neutral middle", () => {
    const rows = Array.from({ length: 6 }, () => row({ score: 7, community: 7 }));
    const generosity = traits(rows).find((t) => t.id === "generosity")!;
    expect(generosity.score).toBe(50);
    expect(generosity.medal).toBeNull();
    expect(generosity.centered).toBe(true);
  });
});

