import { describe, expect, it } from "vitest";
import type { CanonicalStatus, EntryState } from "@/lib/mapping";
import type { MergedEntry } from "@/lib/merge";
import {
  activeFilterCount,
  applyFilters,
  combos,
  completionsByYear,
  disagreements,
  drops,
  EMPTY_FILTERS,
  generosityLevel,
  groupBy,
  overview,
  pearson,
  popularityBuckets,
  quantile,
  rankGroups,
  raterProfile,
  records,
  tasteRows,
  untappedGroups,
  type StatsFilters,
} from "@/lib/stats/gold";
import { medalOf, traits } from "@/lib/stats/profile";
import type { RawAniListEntry, RawMalEntry, RawMedia } from "@/lib/stats/raw";
import { filterFor, mergeFilters, parseStatsParams, statsSearch } from "@/lib/stats/url";
import { buildRows, calibrate, fuzzyDate, lengthOf, malDate, REFERENCE_MEAN, tagCategories } from "@/lib/stats/silver";
import type { StatsRow } from "@/lib/stats/types";

function state(status: CanonicalStatus, progress: number, score: number): EntryState {
  return { status, progress, score, updatedAt: 1_700_000_000_000, entryId: 1 };
}

function entry(id: number, s: EntryState, extra: Partial<MergedEntry> = {}): MergedEntry {
  return {
    key: `mal:${id}`,
    malId: id,
    anilistId: id + 1000,
    title: `Anime ${id}`,
    englishTitle: null,
    cover: null,
    color: null,
    totalEpisodes: 12,
    format: "TV",
    nextAiring: null,
    mal: s,
    anilist: s,
    availability: "both",
    missingOn: null,
    inSync: true,
    diff: [],
    updatedAt: s.updatedAt ?? 0,
    ...extra,
  };
}

function media(id: number, extra: Partial<RawMedia> = {}): RawMedia {
  return {
    id,
    format: "TV",
    episodes: 12,
    duration: 24,
    season: "SPRING",
    seasonYear: 2020,
    genres: ["Action"],
    tags: [],
    averageScore: 75,
    popularity: 50_000,
    ...extra,
  };
}

/** A silver row with sensible defaults. */
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

describe("silver: dates and buckets", () => {
  it("parses AniList fuzzy dates and MAL dates", () => {
    expect(fuzzyDate({ year: 2021, month: 3, day: 14 })).toBe(Date.UTC(2021, 2, 14));
    expect(fuzzyDate({ year: 2021 })).toBe(Date.UTC(2021, 0, 1));
    expect(fuzzyDate({ year: null, month: 3 })).toBeNull();
    expect(malDate("2019-07-02")).toBe(Date.UTC(2019, 6, 2));
    expect(malDate("2019-07")).toBe(Date.UTC(2019, 6, 1));
    expect(malDate("0000-00-00")).toBeNull();
    expect(malDate("")).toBeNull();
  });

  it("puts a title in its length band", () => {
    expect(lengthOf("MOVIE", 1)).toBe("film");
    expect(lengthOf("TV", 12)).toBe("short");
    expect(lengthOf("TV", 24)).toBe("standard");
    expect(lengthOf("TV", 50)).toBe("long");
    expect(lengthOf("TV", 500)).toBe("saga");
    expect(lengthOf("TV", null)).toBeNull();
  });
});

describe("silver: buildRows", () => {
  it("joins the merged list, the metadata and the raw list details", () => {
    const entries = [
      entry(1, state("completed", 0, 8)),
      entry(2, state("watching", 5, 0), { anilistId: null, availability: "mal_only" }),
    ];
    const meta = new Map([
      [
        1001,
        media(1001, {
          genres: ["Action", null],
          tags: [
            { name: "Shounen", rank: 90, category: "Demographic" },
            { name: "Twist", rank: 95, category: "Theme-Other", isMediaSpoiler: true },
            { name: "Loose", rank: 30, category: "Theme-Other" },
          ],
          studios: { nodes: [{ name: "MAPPA" }] },
          relations: { edges: [{ relationType: "PREQUEL" }] },
        }),
      ],
    ]);
    const anilist: RawAniListEntry[] = [
      { mediaId: 1001, repeat: 1, startedAt: { year: 2022, month: 1, day: 1 }, completedAt: { year: 2022, month: 1, day: 6 }, createdAt: 1_600_000_000 },
    ];
    const mal: RawMalEntry[] = [{ node: { id: 2 }, list_status: { start_date: "2023-05-01" } }];

    const rows = buildRows({ entries, media: meta, anilist, mal });
    expect(rows).toHaveLength(2);
    const [a, b] = rows;
    // Completed counts in full even with progress 0, plus one rewatch.
    expect(a!.progress).toBe(12);
    expect(a!.minutesWatched).toBe(12 * 24 * 2);
    expect(a!.genres).toEqual(["Action"]);
    expect(a!.tags).toEqual(["Shounen"]);
    expect(a!.studios).toEqual(["MAPPA"]);
    expect(a!.isSequel).toBe(true);
    expect(a!.community).toBe(7.5);
    expect(a!.completedAt).toBe(Date.UTC(2022, 0, 6));
    expect(a!.addedAt).toBe(1_600_000_000_000);
    expect(a!.hasMeta).toBe(true);
    // MAL-only: no metadata, default duration, MAL start date.
    expect(b!.hasMeta).toBe(false);
    expect(b!.score).toBeNull();
    expect(b!.minutesWatched).toBe(5 * 24);
    expect(b!.minutesLeft).toBe(7 * 24);
    expect(b!.startedAt).toBe(Date.UTC(2023, 4, 1));
  });

  it("collects tag categories", () => {
    expect(tagCategories([media(1, { tags: [{ name: "Isekai", rank: 80, category: "Theme-Fantasy" }] })])).toEqual({
      Isekai: "Theme-Fantasy",
    });
  });
});

describe("silver: calibrate", () => {
  it("brings a generous and a harsh rater to the same common base", () => {
    const generous = calibrate([8, 9, 10, 8, 9, 10].map((score) => row({ score })));
    const harsh = calibrate([4, 5, 6, 4, 5, 6].map((score) => row({ score })));
    // Each one's average title lands on the reference mean, their best on the same value.
    expect(generous.rows[1]!.scoreNormalized).toBe(REFERENCE_MEAN);
    expect(harsh.rows[1]!.scoreNormalized).toBe(REFERENCE_MEAN);
    expect(generous.rows[2]!.scoreNormalized).toBe(harsh.rows[2]!.scoreNormalized);
    expect(generous.calibration.mean).toBe(9);
    expect(generous.calibration.translation.map((t) => t.score)).toEqual([8, 9, 10]);
  });

  it("ranks scores with ties counting half", () => {
    const { rows, calibration } = calibrate([6, 8, 8, 10].map((score) => row({ score })));
    expect(rows[0]!.scorePercentile).toBe(12.5);
    expect(rows[1]!.scorePercentile).toBe(50);
    expect(rows[3]!.scorePercentile).toBe(87.5);
    expect(calibration.count).toBe(4);
  });

  it("leaves unrated rows alone and survives a list without scores", () => {
    const { rows, calibration } = calibrate([row({ score: null })]);
    expect(rows[0]!.scoreNormalized).toBeNull();
    expect(calibration).toEqual({ count: 0, mean: null, sd: null, translation: [] });
  });

  it("does not divide by a zero spread", () => {
    const { rows } = calibrate([7, 7, 7].map((score) => row({ score })));
    expect(rows[0]!.scoreNormalized).toBe(REFERENCE_MEAN);
  });
});

describe("gold: filters", () => {
  const rows = [
    row({ key: "a", genres: ["Action", "Comedy"], tags: ["Isekai"], status: "completed", score: 9 }),
    row({ key: "b", genres: ["Romance"], status: "plan_to_watch", score: null, year: 1995 }),
    row({ key: "c", genres: ["Action"], status: "dropped", score: 4, format: "MOVIE", studios: ["Ghibli"] }),
  ];
  const f = (extra: Partial<StatsFilters>) => ({ ...EMPTY_FILTERS, ...extra });

  it("filters on genres with any / all", () => {
    expect(applyFilters(rows, f({ genres: ["Action", "Comedy"] })).map((r) => r.key)).toEqual(["a", "c"]);
    expect(applyFilters(rows, f({ genres: ["Action", "Comedy"], genreMode: "all" })).map((r) => r.key)).toEqual(["a"]);
  });

  it("filters on decades, formats, studios, tags and score range", () => {
    expect(applyFilters(rows, f({ decades: [1990] })).map((r) => r.key)).toEqual(["b"]);
    expect(applyFilters(rows, f({ formats: ["MOVIE"] })).map((r) => r.key)).toEqual(["c"]);
    expect(applyFilters(rows, f({ studios: ["Ghibli"] })).map((r) => r.key)).toEqual(["c"]);
    expect(applyFilters(rows, f({ tags: ["Isekai"] })).map((r) => r.key)).toEqual(["a"]);
    expect(applyFilters(rows, f({ scoreMin: 5 })).map((r) => r.key)).toEqual(["a"]);
    expect(applyFilters(rows, f({ completedYears: [2024] }))).toEqual([]);
    expect(activeFilterCount(f({ genres: ["A", "B"], scoreMin: 5, scoreMax: 9 }))).toBe(3);
  });

  it("leaves titles to watch out of taste stats unless the status filter asks for them", () => {
    expect(tasteRows(rows, EMPTY_FILTERS).map((r) => r.key)).toEqual(["a", "c"]);
    expect(tasteRows(rows, f({ statuses: ["plan_to_watch"] }))).toHaveLength(3);
  });
});

describe("gold: overview", () => {
  it("adds up titles, time, statuses and the backlog", () => {
    const o = overview([
      row({ status: "completed", score: 8, repeat: 1 }),
      row({ status: "dropped", score: 4, progress: 2, minutesWatched: 48, minutesLeft: 240 }),
      row({ status: "plan_to_watch", score: null, progress: 0, minutesWatched: 0, minutesLeft: 288 }),
      row({ status: "watching", score: null, progress: 6, minutesWatched: 144, minutesLeft: 144, isSequel: true }),
    ]);
    expect(o.titles).toBe(4);
    expect(o.episodes).toBe(12 + 12 + 2 + 6);
    expect(o.meanScore).toBe(6);
    expect(o.completionRate).toBe(0.5);
    expect(o.plannedMinutes).toBe(288);
    expect(o.minutesLeftInProgress).toBe(144);
    expect(o.byStatus.dropped).toBe(1);
    expect(o.sequelShare).toBe(0.25);
  });
});

describe("gold: groups", () => {
  const rows = calibrate([
    row({ genres: ["Action", "Comedy"], score: 9, community: 7 }),
    row({ genres: ["Action"], score: 8, community: 7 }),
    row({ genres: ["Action"], score: 7, community: 8, status: "dropped" }),
    row({ genres: ["Comedy"], score: 5, community: 7 }),
    row({ genres: ["Romance"], score: 9, community: 8 }),
  ]).rows;

  it("groups multi-valued dimensions and computes their metrics", () => {
    const groups = groupBy(rows, "genre");
    const action = groups.find((g) => g.value === "Action")!;
    expect(groups[0]!.value).toBe("Action");
    expect(action.count).toBe(3);
    expect(action.share).toBeCloseTo(0.6);
    expect(action.meanScore).toBe(8);
    expect(action.delta).toBeCloseTo((2 + 1 - 1) / 3);
    expect(action.dropRate).toBeCloseTo(1 / 3);
    expect(action.affinity).toBeGreaterThan(0);
  });

  it("ranks by a metric, skipping groups too small for a mean", () => {
    const groups = groupBy(rows, "genre");
    expect(rankGroups(groups, "count").map((r) => r.group.value)).toEqual(["Action", "Comedy", "Romance"]);
    expect(rankGroups(groups, "score").map((r) => r.group.value)).toEqual(["Action"]);
    const years = groupBy([row({ year: 2001 }), row({ year: 1999 })], "decade");
    expect(rankGroups(years, "count", (a, b) => Number(a) - Number(b)).map((r) => r.group.value)).toEqual(["1990", "2000"]);
  });

  it("finds genre combos and untapped genres", () => {
    expect(combos(rows, "genre")[0]).toMatchObject({ a: "Action", b: "Comedy", count: 1 });
    const many = calibrate([
      ...Array.from({ length: 10 }, () => row({ genres: ["Action"], score: 6 })),
      ...Array.from({ length: 3 }, () => row({ genres: ["Mystery"], score: 9 })),
    ]).rows;
    expect(untappedGroups(groupBy(many, "genre")).map((g) => g.value)).toEqual(["Mystery"]);
  });
});

describe("gold: scores", () => {
  it("measures generosity against the community", () => {
    const rows = [9, 9, 10, 8, 9, 10].map((score) => row({ score, community: 7.5 }));
    const p = raterProfile(rows);
    expect(p.bias).toBeCloseTo(1.667, 2);
    expect(p.generosity).toBe("very_generous");
    expect(p.generosityIndex).toBe(92);
    expect(p.histogram[8]!.mine).toBe(3);
    expect(p.histogram[7]!.community).toBe(6);
    expect(p.shares!.mine.high).toBe(1);
    expect(p.distinct).toBe(3);
  });

  it("needs enough titles before judging", () => {
    const p = raterProfile([row({ score: 9 }), row({ score: null })]);
    expect(p.bias).toBeNull();
    expect(p.generosity).toBeNull();
    expect(p.unrated).toBe(1);
  });

  it("labels generosity levels", () => {
    expect(generosityLevel(-1.2)).toBe("very_harsh");
    expect(generosityLevel(-0.5)).toBe("harsh");
    expect(generosityLevel(0)).toBe("fair");
    expect(generosityLevel(0.6)).toBe("generous");
  });

  it("lists the biggest disagreements", () => {
    const d = disagreements([
      row({ title: "Loved", score: 10, community: 6 }),
      row({ title: "Hated", score: 3, community: 8 }),
      row({ title: "Agreed", score: 7, community: 7 }),
    ]);
    expect(d.over.map((r) => r.title)).toEqual(["Loved"]);
    expect(d.under[0]).toMatchObject({ title: "Hated", gap: -5 });
  });

  it("computes quantiles and correlations", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2], 0.5)).toBe(1.5);
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull();
  });
});

describe("gold: drops, time and records", () => {
  it("shows when titles get dropped", () => {
    const d = drops([
      row({ status: "dropped", progress: 1, episodes: 24 }),
      row({ status: "dropped", progress: 20, episodes: 24 }),
      row({ status: "dropped", progress: 3, episodes: null }),
      row({ status: "completed" }),
    ]);
    expect(d.count).toBe(3);
    expect(d.early).toBe(2);
    expect(d.buckets[0]!.count).toBe(1);
    expect(d.buckets[4]!.count).toBe(1);
    expect(d.medianEpisode).toBe(3);
  });

  it("sorts titles by popularity band", () => {
    const buckets = popularityBuckets([row({ popularity: 900 }), row({ popularity: 600_000 }), row({ popularity: null })]);
    expect(buckets.map((b) => b.rows.length)).toEqual([1, 0, 0, 0, 1]);
  });

  it("counts completions per year, gaps included", () => {
    const years = completionsByYear([
      row({ completedAt: Date.UTC(2020, 5, 1) }),
      row({ completedAt: Date.UTC(2022, 5, 1) }),
      row({ completedAt: Date.UTC(2022, 8, 1) }),
    ]);
    expect(years.map((y) => [y.year, y.count])).toEqual([
      [2020, 1],
      [2021, 0],
      [2022, 2],
    ]);
  });

  it("finds records", () => {
    const r = records([
      row({ title: "Long", episodes: 1000, year: 1999, popularity: 900_000 }),
      row({ title: "Gem", score: 9, popularity: 2_000, year: 2023 }),
    ]);
    expect(r.longest?.title).toBe("Long");
    expect(r.oldest?.title).toBe("Long");
    expect(r.newest?.title).toBe("Gem");
    expect(r.hiddenGem?.title).toBe("Gem");
    expect(r.mostPopular?.title).toBe("Long");
    expect(r.mostRewatched).toBeNull();
  });
});

describe("gold: viewer profile", () => {
  it("gives medals by level", () => {
    expect(medalOf(90)).toBe("gold");
    expect(medalOf(60)).toBe("silver");
    expect(medalOf(40)).toBe("bronze");
    expect(medalOf(10)).toBeNull();
  });

  it("describes the viewer on each axis it can measure", () => {
    const now = Date.UTC(2026, 0, 1);
    const rows = [
      ...Array.from({ length: 8 }, (_, i) =>
        row({
          genres: [["Action", "Comedy", "Drama", "Mystery"][i % 4]!],
          score: 9,
          community: 7.5,
          year: 2024,
          popularity: 300_000,
          minutesWatched: 60 * 60,
          startedAt: Date.UTC(2025, 0, 1),
          completedAt: Date.UTC(2025, 0, 2),
        }),
      ),
      row({ status: "dropped" }),
    ];
    const byId = Object.fromEntries(traits(rows, now).map((t) => [t.id, t]));
    expect(byId.volume!.label).toBe("Assidu");
    expect(byId.finisher!.label).toBe("Finisseur");
    expect(byId.gems!.label).toBe("Mainstream");
    expect(byId.retro!.label).toBe("Chasseur de nouveautés");
    expect(byId.pace!.label).toBe("Binge-watcher");
    expect(byId.generosity!.label).toBe("Très généreux");
    expect(byId.curiosity!.detail).toContain("genres");
  });

  it("skips axes without data", () => {
    expect(traits([])).toEqual([]);
  });
});

describe("url state", () => {
  it("round-trips filters and tab through the query string", () => {
    const filters: StatsFilters = {
      ...EMPTY_FILTERS,
      statuses: ["completed"],
      genres: ["Action", "Sci-Fi"],
      genreMode: "all",
      studios: ["Studio, Inc."],
      decades: [1990],
      lengths: ["film"],
      completedYears: [2024],
      scoreMin: 7,
    };
    const compare: StatsFilters = { ...EMPTY_FILTERS, completedYears: [2025], genres: ["Drama"] };
    const search = statsSearch({ filters, compare, tab: "compare" });
    expect(search).toContain("b.done=2025");
    expect(parseStatsParams(new URLSearchParams(search))).toEqual({ filters, compare, tab: "compare" });
    expect(statsSearch({ filters: EMPTY_FILTERS, compare: EMPTY_FILTERS, tab: "overview" })).toBe("");
  });

  it("ignores invalid values", () => {
    const { filters, tab } = parseStatsParams(new URLSearchParams("status=nope&decade=1995&smin=42&tab=x&length=huge"));
    expect(filters).toEqual(EMPTY_FILTERS);
    expect(tab).toBe("overview");
  });

  it("builds and merges drill-down filters", () => {
    expect(filterFor("decade", "1990")).toEqual({ decades: [1990] });
    expect(filterFor("score", "8")).toEqual({ scoreMin: 8, scoreMax: 8 });
    expect(filterFor("year", "2001")).toBeNull();
    const merged = mergeFilters({ ...EMPTY_FILTERS, genres: ["Action"] }, { genres: ["Action", "Drama"], scoreMin: 5 });
    expect(merged.genres).toEqual(["Action", "Drama"]);
    expect(merged.scoreMin).toBe(5);
  });
});
