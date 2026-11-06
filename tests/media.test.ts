import { describe, expect, it } from "vitest";
import type { EntryState } from "@/lib/mapping";
import {
  absoluteIndex,
  airedCount,
  episodeAt,
  nextLocalState,
  regularSeasons,
  showPointers,
} from "@/lib/media-core";
import { parseTvDetails } from "@/lib/tmdb-parse";
import { tvEnded, tvReturning } from "./fixtures/tmdb";

const returning = parseTvDetails(tvReturning)!;
const ended = parseTvDetails(tvEnded)!;
const NOW = 1_800_000_000_000;

function state(partial: Partial<EntryState> = {}): EntryState {
  return { status: "plan_to_watch", progress: 0, score: 0, updatedAt: 1, entryId: null, ...partial };
}

describe("regularSeasons", () => {
  it("skips specials (season 0) and empty seasons, sorted", () => {
    expect(regularSeasons(returning)).toEqual([
      { season: 1, episodes: 6 },
      { season: 2, episodes: 4 },
    ]);
    expect(
      regularSeasons({
        seasons: [
          { season: 3, episodes: 2, airDate: null },
          { season: 2, episodes: 0, airDate: null },
          { season: 1, episodes: 5, airDate: null },
        ],
      }),
    ).toEqual([
      { season: 1, episodes: 5 },
      { season: 3, episodes: 2 },
    ]);
  });
});

describe("episodeAt / absoluteIndex", () => {
  const seasons = regularSeasons(returning);

  it("walks across seasons in broadcast order", () => {
    expect(episodeAt(seasons, 1)).toEqual({ season: 1, episode: 1 });
    expect(episodeAt(seasons, 6)).toEqual({ season: 1, episode: 6 });
    expect(episodeAt(seasons, 7)).toEqual({ season: 2, episode: 1 });
    expect(episodeAt(seasons, 10)).toEqual({ season: 2, episode: 4 });
  });

  it("returns null out of range", () => {
    expect(episodeAt(seasons, 0)).toBeNull();
    expect(episodeAt(seasons, -2)).toBeNull();
    expect(episodeAt(seasons, 11)).toBeNull();
    expect(episodeAt([], 1)).toBeNull();
  });

  it("is the inverse of episodeAt", () => {
    for (let n = 1; n <= 10; n++) {
      const found = episodeAt(seasons, n)!;
      expect(absoluteIndex(seasons, found.season, found.episode)).toBe(n);
    }
  });

  it("returns null for unknown seasons (specials) and episodes", () => {
    expect(absoluteIndex(seasons, 0, 1)).toBeNull();
    expect(absoluteIndex(seasons, 3, 1)).toBeNull();
    expect(absoluteIndex(seasons, 2, 5)).toBeNull();
    expect(absoluteIndex(seasons, 1, 0)).toBeNull();
  });
});

describe("airedCount", () => {
  it("is the absolute index of the last aired episode", () => {
    expect(airedCount(returning)).toBe(8);
    expect(airedCount(ended)).toBe(15);
  });

  it("is 0 without a last episode or when it is a special", () => {
    expect(airedCount({ seasons: returning.seasons, lastEpisode: null })).toBe(0);
    expect(airedCount({ seasons: returning.seasons, lastEpisode: { season: 0, episode: 2, airDate: null } })).toBe(0);
  });
});

describe("showPointers", () => {
  it("points to the next aired episode across a season boundary", () => {
    const p = showPointers(returning, 6);
    expect(p.totalEpisodes).toBe(10);
    expect(p.nextEpisode).toEqual({ season: 2, episode: 1, title: null });
    expect(p.lastEpisode).toEqual({ season: 1, episode: 6, title: null });
  });

  it("starts at S01E01 with no last episode", () => {
    const p = showPointers(returning, 0);
    expect(p.nextEpisode).toEqual({ season: 1, episode: 1, title: null });
    expect(p.lastEpisode).toBeNull();
  });

  it("is up to date when everything aired has been watched, even if more is announced", () => {
    const p = showPointers(returning, 8);
    expect(p.nextEpisode).toBeNull();
    expect(p.lastEpisode).toEqual({ season: 2, episode: 2, title: null });
    expect(p.nextAiring).toEqual({ episode: 9, airingAt: Date.UTC(2025, 9, 16) });
  });

  it("never points to an episode that has not aired yet", () => {
    expect(showPointers(returning, 7).nextEpisode).toEqual({ season: 2, episode: 2, title: null });
  });

  it("has no next airing for an ended show and none after the finale", () => {
    const p = showPointers(ended, 15);
    expect(p).toMatchObject({ totalEpisodes: 15, nextEpisode: null, nextAiring: null });
    expect(p.lastEpisode).toEqual({ season: 2, episode: 7, title: null });
  });

  it("ignores a next episode that is a special or has no date", () => {
    const special = { ...returning, nextEpisode: { season: 0, episode: 4, airDate: "2025-12-01" } };
    expect(showPointers(special, 0).nextAiring).toBeNull();
    const undated = { ...returning, nextEpisode: { season: 2, episode: 3, airDate: null } };
    expect(showPointers(undated, 0).nextAiring).toBeNull();
  });

  it("has unknown totals for a show without regular seasons", () => {
    const p = showPointers({ ...returning, seasons: [{ season: 0, episodes: 2, airDate: null }], lastEpisode: null }, 0);
    expect(p).toMatchObject({ totalEpisodes: null, nextEpisode: null, lastEpisode: null });
  });
});

describe("nextLocalState: movies", () => {
  it("is 1 when completed and 0 otherwise, ignoring the patch progress", () => {
    expect(nextLocalState("movie", null, { status: "completed", progress: 0 }, 1, NOW).state).toMatchObject({
      status: "completed",
      progress: 1,
    });
    expect(nextLocalState("movie", null, { status: "plan_to_watch", progress: 5 }, 1, NOW).state.progress).toBe(0);
    const done = state({ status: "completed", progress: 1 });
    expect(nextLocalState("movie", done, { status: "dropped" }, 1, NOW).state.progress).toBe(0);
  });

  it("keeps the score and sets updatedAt", () => {
    const { state: next } = nextLocalState("movie", state({ score: 8 }), { status: "completed" }, 1, NOW);
    expect(next).toMatchObject({ score: 8, updatedAt: NOW, entryId: null });
  });
});

describe("nextLocalState: shows", () => {
  it("clamps progress to the known total", () => {
    expect(nextLocalState("show", state(), { progress: 99 }, 10, NOW).state.progress).toBe(10);
    expect(nextLocalState("show", state(), { progress: 99 }, null, NOW).state.progress).toBe(99);
  });

  it("jumps to the total when completed without explicit progress", () => {
    const { state: next } = nextLocalState("show", state({ status: "watching", progress: 3 }), { status: "completed" }, 10, NOW);
    expect(next).toMatchObject({ status: "completed", progress: 10 });
  });

  it("keeps the progress when completed with an unknown total or an explicit progress", () => {
    expect(nextLocalState("show", state({ progress: 3 }), { status: "completed" }, null, NOW).state.progress).toBe(3);
    expect(nextLocalState("show", state(), { status: "completed", progress: 4 }, 10, NOW).state.progress).toBe(4);
  });

  it("keeps the current progress for a score-only patch", () => {
    expect(nextLocalState("show", state({ progress: 4 }), { score: 9 }, 10, NOW).state).toMatchObject({
      progress: 4,
      score: 9,
      status: "plan_to_watch",
    });
  });

  it("defaults a new entry to plan_to_watch", () => {
    expect(nextLocalState("show", null, {}, 10, NOW).state).toMatchObject({ status: "plan_to_watch", progress: 0, score: 0 });
  });
});

describe("nextLocalState: timeline", () => {
  it("sets startedAt the first time the entry is watching or has progress", () => {
    expect(nextLocalState("show", null, { status: "watching" }, 10, NOW).startedAt).toBe(NOW);
    expect(nextLocalState("show", state(), { progress: 1 }, 10, NOW).startedAt).toBe(NOW);
    expect(nextLocalState("show", state(), { status: "rewatching" }, 10, NOW).startedAt).toBe(NOW);
  });

  it("does not touch startedAt later, nor for a planned entry", () => {
    expect(nextLocalState("show", { ...state({ status: "watching" }), startedAt: 42 }, { progress: 2 }, 10, NOW).startedAt).toBeUndefined();
    expect(nextLocalState("show", state(), { score: 7 }, 10, NOW).startedAt).toBeUndefined();
  });

  it("sets completedAt when entering completed only", () => {
    expect(nextLocalState("show", state({ status: "watching" }), { status: "completed" }, 10, NOW).completedAt).toBe(NOW);
    expect(nextLocalState("movie", null, { status: "completed" }, 1, NOW).completedAt).toBe(NOW);
    expect(nextLocalState("show", state({ status: "completed", progress: 10 }), { score: 8 }, 10, NOW).completedAt).toBeUndefined();
  });

  it("completing from planned sets both dates (progress jumps to the total)", () => {
    const out = nextLocalState("show", state(), { status: "completed" }, 10, NOW);
    expect(out).toMatchObject({ startedAt: NOW, completedAt: NOW });
  });
});
