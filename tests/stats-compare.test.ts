import { describe, expect, it } from "vitest";
import { compare, compatibilityLevel } from "@/lib/stats/compare";
import type { RawUserEntry } from "@/lib/stats/raw";
import { buildRows, calibrate, entriesFromUserList } from "@/lib/stats/silver";
import type { StatsRow } from "@/lib/stats/types";

function row(id: number, score: number | null, extra: Partial<StatsRow> = {}): StatsRow {
  return {
    key: `al:${id}`,
    malId: null,
    anilistId: id,
    title: `Anime ${id}`,
    cover: null,
    status: "completed",
    progress: 12,
    score,
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
    genres: [],
    tags: [],
    studios: [],
    source: null,
    country: null,
    community: 7.5,
    popularity: 1000,
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

describe("entriesFromUserList", () => {
  it("shapes a public AniList list like my merged list", () => {
    const raw: RawUserEntry[] = [
      {
        mediaId: 21,
        status: "COMPLETED",
        score: 85,
        progress: 1000,
        repeat: 1,
        updatedAt: 1_700_000_000,
        completedAt: { year: 2023, month: 5, day: 2 },
        media: { id: 21, idMal: 21, episodes: 1000, format: "TV", title: { userPreferred: "One Piece" }, coverImage: { large: "c.jpg" } },
      },
      { mediaId: 99, status: "WEIRD", score: 0, progress: 0, media: { id: 99, idMal: null } },
    ];
    const entries = entriesFromUserList(raw);
    expect(entries[0]).toMatchObject({
      key: "mal:21",
      anilistId: 21,
      title: "One Piece",
      cover: "c.jpg",
      totalEpisodes: 1000,
      mal: null,
      anilist: { status: "completed", progress: 1000, score: 9, updatedAt: 1_700_000_000_000 },
      availability: "both",
    });
    // Unknown statuses fall back to "to watch".
    expect(entries[1]).toMatchObject({ key: "al:99", availability: "anilist_only", anilist: { status: "plan_to_watch" } });

    // The raw entries double as the AniList details: dates and rewatches reach the silver rows.
    const rows = buildRows({ entries, media: new Map(), anilist: raw, mal: null });
    expect(rows[0]).toMatchObject({ repeat: 1, completedAt: Date.UTC(2023, 4, 2), score: 9 });
  });
});

describe("compare", () => {
  const mine = calibrate([
    row(1, 9),
    row(2, 8),
    row(3, 6),
    row(4, 5),
    row(5, 7),
    row(6, 4),
    row(7, null, { status: "plan_to_watch" }),
  ]).rows;

  it("finds a perfect match between a generous and a harsh rater", () => {
    // Same order, shifted down by 3: identical on the common base.
    const theirs = calibrate([row(1, 6), row(2, 5), row(3, 3), row(4, 2), row(5, 4), row(6, 1)]).rows;
    const c = compare(mine, theirs);
    expect(c.shared).toBe(6);
    expect(c.bothRated).toBe(6);
    expect(c.correlation).toBeCloseTo(1);
    expect(c.compatibility).toBe(100);
    expect(c.meanGap).toBeCloseTo(0);
    expect(c.agreements[0]!.theirs.anilistId).toBe(1);
  });

  it("spots opposite tastes, disagreements and their favourites I have not seen", () => {
    const theirs = calibrate([
      row(1, 4),
      row(2, 5),
      row(3, 7),
      row(4, 8),
      row(5, 6),
      row(6, 9),
      row(7, 10),
      row(42, 9),
      row(43, 5),
    ]).rows;
    const c = compare(mine, theirs);
    expect(c.correlation).toBeLessThan(-0.9);
    expect(compatibilityLevel(c.compatibility!)).toBe("opposite");
    expect([1, 6]).toContain(c.disagreements[0]!.mine.anilistId);
    // 7 is in my list (to watch): not a discovery. 43 is not a favourite.
    expect(c.theirFavourites.map((r) => r.anilistId)).toEqual([42]);
    // A title I only plan to watch is not shared.
    expect(c.shared).toBe(6);
  });

  it("does not judge on too few shared ratings", () => {
    const c = compare(mine, calibrate([row(1, 9), row(2, 8)]).rows);
    expect(c.compatibility).toBeNull();
    expect(c.bothRated).toBe(2);
  });

  it("labels compatibility levels", () => {
    expect(compatibilityLevel(80)).toBe("soulmates");
    expect(compatibilityLevel(65)).toBe("close");
    expect(compatibilityLevel(50)).toBe("some");
    expect(compatibilityLevel(20)).toBe("opposite");
  });
});
