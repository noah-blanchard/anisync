import { describe, expect, it } from "vitest";
import type { EntryState } from "@/lib/mapping";
import {
  computeSync,
  displayState,
  mergeLists,
  unresolvedMalIds,
  type AniListListItem,
  type MalListItem,
} from "@/lib/merge";

function state(partial: Partial<EntryState> = {}): EntryState {
  return { status: "watching", progress: 0, score: 0, updatedAt: 1000, entryId: null, ...partial };
}

function mal(malId: number, partial: Partial<EntryState> = {}, extra: Partial<MalListItem> = {}): MalListItem {
  return {
    malId,
    title: `MAL ${malId}`,
    englishTitle: null,
    cover: `https://cdn.myanimelist.net/${malId}.jpg`,
    totalEpisodes: 12,
    mediaType: "tv",
    state: state(partial),
    ...extra,
  };
}

function al(
  anilistId: number,
  malId: number | null,
  partial: Partial<EntryState> = {},
  extra: Partial<AniListListItem> = {},
): AniListListItem {
  return {
    anilistId,
    malId,
    title: `AL ${anilistId}`,
    englishTitle: null,
    cover: `https://s4.anilist.co/${anilistId}.jpg`,
    color: "#e4a15d",
    totalEpisodes: 12,
    format: "TV",
    nextAiring: null,
    state: state({ entryId: anilistId * 10, ...partial }),
    ...extra,
  };
}

const noMap = new Map<number, number | null>();

describe("mergeLists", () => {
  it("joins entries on idMal and flags them in sync", () => {
    const merged = mergeLists({ mal: [mal(1, { progress: 3 })], anilist: [al(101, 1, { progress: 3 })], idMap: noMap });
    expect(merged).toHaveLength(1);
    const [entry] = merged;
    expect(entry).toMatchObject({
      key: "mal:1",
      malId: 1,
      anilistId: 101,
      title: "AL 101",
      color: "#e4a15d",
      availability: "both",
      inSync: true,
      diff: [],
      missingOn: null,
    });
    expect(entry?.mal?.progress).toBe(3);
    expect(entry?.anilist?.entryId).toBe(1010);
  });

  it("detects diffs on status, progress and score", () => {
    const [entry] = mergeLists({
      mal: [mal(1, { progress: 3, score: 7, status: "watching" })],
      anilist: [al(101, 1, { progress: 4, score: 8, status: "rewatching" })],
      idMap: noMap,
    });
    expect(entry?.inSync).toBe(false);
    expect(entry?.diff).toEqual(["status", "progress", "score"]);
  });

  it("uses id_map when the AniList media has no idMal", () => {
    const [entry, ...rest] = mergeLists({
      mal: [mal(1, { progress: 2 })],
      anilist: [al(101, null, { progress: 2 })],
      idMap: new Map([[1, 101]]),
    });
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ malId: 1, anilistId: 101, availability: "both", inSync: true });
  });

  it("marks AniList entries without idMal as anilist_only, never out of sync", () => {
    const [entry] = mergeLists({ mal: [], anilist: [al(500, null, { progress: 5 })], idMap: noMap });
    expect(entry).toMatchObject({
      key: "al:500",
      malId: null,
      anilistId: 500,
      availability: "anilist_only",
      inSync: true,
      mal: null,
    });
  });

  it("marks MAL entries confirmed missing on AniList as mal_only", () => {
    const [entry] = mergeLists({ mal: [mal(7)], anilist: [], idMap: new Map([[7, null]]) });
    expect(entry).toMatchObject({ malId: 7, anilistId: null, availability: "mal_only", inSync: true });
  });

  it("flags an entry present on one side only when both services are connected", () => {
    const merged = mergeLists({
      mal: [mal(1)],
      anilist: [al(202, 2)],
      idMap: new Map([[1, 101]]),
    });
    const onlyMal = merged.find((e) => e.malId === 1);
    const onlyAl = merged.find((e) => e.malId === 2);
    expect(onlyMal).toMatchObject({ anilistId: 101, inSync: false, missingOn: "anilist", anilist: null });
    expect(onlyAl).toMatchObject({ anilistId: 202, inSync: false, missingOn: "mal", mal: null });
  });

  it("does not flag anything when a service is not connected", () => {
    const merged = mergeLists({ mal: [mal(1), mal(2)], anilist: null, idMap: noMap });
    expect(merged).toHaveLength(2);
    expect(merged.every((e) => e.inSync && e.missingOn === null)).toBe(true);

    const alOnly = mergeLists({ mal: null, anilist: [al(101, 1)], idMap: noMap });
    expect(alOnly[0]).toMatchObject({ malId: 1, inSync: true, missingOn: null });
  });

  it("falls back to the MAL total when AniList has none", () => {
    const [entry] = mergeLists({
      mal: [mal(1, {}, { totalEpisodes: 24 })],
      anilist: [al(101, 1, {}, { totalEpisodes: null })],
      idMap: noMap,
    });
    expect(entry?.totalEpisodes).toBe(24);
  });

  it("treats MAL total 0 as unknown", () => {
    const [entry] = mergeLists({ mal: [mal(1, {}, { totalEpisodes: 0 })], anilist: null, idMap: noMap });
    expect(entry?.totalEpisodes).toBeNull();
  });

  it("sorts by most recent update", () => {
    const merged = mergeLists({
      mal: [mal(1, { updatedAt: 10 }), mal(2, { updatedAt: 30 })],
      anilist: [al(103, 3, { updatedAt: 20 })],
      idMap: noMap,
    });
    expect(merged.map((e) => e.malId)).toEqual([2, 3, 1]);
  });
});

describe("unresolvedMalIds", () => {
  it("returns MAL ids with no AniList match and no cache entry", () => {
    const ids = unresolvedMalIds({
      mal: [mal(1), mal(2), mal(3), mal(4)],
      anilist: [al(101, 1)],
      idMap: new Map([
        [2, 102],
        [3, null],
      ]),
    });
    expect(ids).toEqual([4]);
  });
});

describe("computeSync / displayState", () => {
  it("recomputes sync after an optimistic change", () => {
    const sync = computeSync(
      { mal: state({ progress: 4 }), anilist: state({ progress: 4 }), availability: "both" },
      { mal: true, anilist: true },
    );
    expect(sync).toMatchObject({ inSync: true, diff: [] });
  });

  it("shows the most advanced side", () => {
    expect(displayState({ mal: state({ progress: 2 }), anilist: state({ progress: 5 }) })?.progress).toBe(5);
  });
});
