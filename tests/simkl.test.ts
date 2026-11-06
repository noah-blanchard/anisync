import { describe, expect, it } from "vitest";
import {
  diffWithSimkl,
  fromSimklStatus,
  maxState,
  statusesForKind,
  toSimklStatus,
  CANONICAL_STATUSES,
  SIMKL_STATUSES,
  type EntryState,
} from "@/lib/mapping";
import {
  computeSync,
  displayState,
  mergeLists,
  simklKey,
  type AniListListItem,
  type MalListItem,
  type SimklListItem,
} from "@/lib/merge";
import { parseSimklActivitiesAll, parseSimklAllItems, parseEpisodeCode } from "@/lib/simkl-parse";
import {
  planSimklRemove,
  planSimklWrite,
  simklIds,
  SimklPlanError,
  type SimklWriteTarget,
} from "@/lib/simkl-payloads";
import { episodeCode, simklUrl } from "@/lib/labels";

function state(partial: Partial<EntryState> = {}): EntryState {
  return { status: "watching", progress: 0, score: 0, updatedAt: 1000, entryId: null, ...partial };
}

function mal(malId: number, partial: Partial<EntryState> = {}): MalListItem {
  return {
    malId,
    title: `MAL ${malId}`,
    englishTitle: null,
    cover: null,
    totalEpisodes: 12,
    mediaType: "tv",
    state: state(partial),
  };
}

function al(anilistId: number, malId: number | null, partial: Partial<EntryState> = {}): AniListListItem {
  return {
    anilistId,
    malId,
    title: `AL ${anilistId}`,
    englishTitle: null,
    cover: "https://s4.anilist.co/x.jpg",
    color: null,
    totalEpisodes: 12,
    format: "TV",
    nextAiring: null,
    state: state({ entryId: anilistId * 10, ...partial }),
  };
}

function sk(simklId: number, extra: Partial<SimklListItem> = {}, partial: Partial<EntryState> = {}): SimklListItem {
  return {
    simklId,
    kind: "anime",
    malId: null,
    anilistId: null,
    title: `Simkl ${simklId}`,
    cover: "https://wsrv.nl/x",
    year: 2020,
    totalEpisodes: 12,
    animeType: "tv",
    nextEpisode: null,
    lastEpisode: null,
    state: state(partial),
    ...extra,
  };
}

const noMap = new Map<number, number | null>();
const all3 = { mal: true, anilist: true, simkl: true };

describe("simkl status mapping", () => {
  it("maps canonical -> simkl", () => {
    expect(toSimklStatus("rewatching", "anime")).toBe("watching");
    expect(toSimklStatus("on_hold", "show")).toBe("hold");
    expect(toSimklStatus("plan_to_watch", "anime")).toBe("plantowatch");
    expect(toSimklStatus("completed", "show")).toBe("completed");
    expect(toSimklStatus("dropped", "anime")).toBe("dropped");
  });

  it("applies the movie rules", () => {
    expect(toSimklStatus("watching", "movie")).toBe("completed");
    expect(toSimklStatus("rewatching", "movie")).toBe("completed");
    expect(toSimklStatus("on_hold", "movie")).toBe("plantowatch");
    expect(toSimklStatus("dropped", "movie")).toBe("dropped");
  });

  it("maps simkl -> canonical", () => {
    expect(SIMKL_STATUSES.map(fromSimklStatus)).toEqual([
      "watching",
      "plan_to_watch",
      "completed",
      "on_hold",
      "dropped",
    ]);
  });

  it("limits the statuses of a movie", () => {
    expect(statusesForKind("movie")).toEqual(["plan_to_watch", "completed", "dropped"]);
    expect([...statusesForKind("show")].sort()).toEqual([...CANONICAL_STATUSES].sort());
    expect(statusesForKind("anime")).toHaveLength(6);
  });

  it("treats rewatching like watching when diffing", () => {
    expect(diffWithSimkl(state({ status: "rewatching" }), state({ status: "watching" }))).toEqual([]);
    expect(diffWithSimkl(state({ status: "completed", progress: 3, score: 5 }), state({ progress: 2 }))).toEqual([
      "status",
      "progress",
      "score",
    ]);
  });
});

describe("mergeLists with Simkl", () => {
  it("attaches Simkl anime by MAL id", () => {
    const [entry, ...rest] = mergeLists({
      mal: [mal(1, { progress: 3 })],
      anilist: [al(101, 1, { progress: 3 })],
      simkl: [sk(900, { malId: 1 }, { progress: 3 })],
      idMap: noMap,
    });
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ key: "mal:1", kind: "anime", simklId: 900, year: 2020, inSync: true, missingOn: null });
    expect(entry?.simkl?.progress).toBe(3);
  });

  it("attaches Simkl anime by AniList id when the MAL id is unknown", () => {
    const [entry, ...rest] = mergeLists({
      mal: null,
      anilist: [al(101, null, { progress: 2 })],
      simkl: [sk(900, { anilistId: 101 }, { progress: 2 })],
      idMap: noMap,
    });
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ key: "al:101", simklId: 900, availability: "anilist_only" });
    expect(entry?.simkl).not.toBeNull();
  });

  it("creates an entry for an unattached Simkl anime with a MAL id", () => {
    const [entry] = mergeLists({ mal: [], anilist: [], simkl: [sk(900, { malId: 5 })], idMap: noMap });
    expect(entry).toMatchObject({
      key: "mal:5",
      kind: "anime",
      malId: 5,
      anilistId: null,
      simklId: 900,
      availability: "both",
      mal: null,
      anilist: null,
      title: "Simkl 900",
    });
  });

  it("creates a simkl_only entry for a Simkl anime without any anime id", () => {
    const [entry] = mergeLists({ mal: [], anilist: [], simkl: [sk(900)], idMap: noMap });
    expect(entry).toMatchObject({ key: "simkl:anime:900", availability: "simkl_only", inSync: true, missingOn: null });
  });

  it("builds show and movie entries", () => {
    const next = { season: 2, episode: 5, title: "Pilot" };
    const merged = mergeLists({
      mal: null,
      anilist: null,
      simkl: [
        sk(10, { kind: "show", totalEpisodes: 24, nextEpisode: next, animeType: null }),
        sk(20, { kind: "movie", totalEpisodes: null, animeType: null }, { status: "completed", progress: 1 }),
      ],
      idMap: noMap,
    });
    const show = merged.find((e) => e.kind === "show");
    const movie = merged.find((e) => e.kind === "movie");
    expect(show).toMatchObject({
      key: "simkl:show:10",
      simklId: 10,
      availability: "simkl_only",
      totalEpisodes: 24,
      nextEpisode: next,
      malId: null,
      inSync: true,
    });
    expect(movie).toMatchObject({ key: simklKey("movie", 20), totalEpisodes: 1, nextEpisode: null, inSync: true });
  });

  it("keeps the AniList cover/title over Simkl", () => {
    const [entry] = mergeLists({
      mal: null,
      anilist: [al(101, 1)],
      simkl: [sk(900, { malId: 1 })],
      idMap: noMap,
    });
    expect(entry).toMatchObject({ title: "AL 101", cover: "https://s4.anilist.co/x.jpg" });
  });
});

describe("computeSync with Simkl", () => {
  it("flags an anime missing on Simkl", () => {
    const [entry] = mergeLists({ mal: [mal(1)], anilist: [al(101, 1)], simkl: [], idMap: noMap });
    expect(entry).toMatchObject({ inSync: false, missingOn: "simkl" });
  });

  it("flags a progress diff with Simkl", () => {
    const [entry] = mergeLists({
      mal: [mal(1, { progress: 4 })],
      anilist: [al(101, 1, { progress: 4 })],
      simkl: [sk(900, { malId: 1 }, { progress: 3 })],
      idMap: noMap,
    });
    expect(entry).toMatchObject({ inSync: false, diff: ["progress"], missingOn: null });
  });

  it("does not duplicate fields already different between MAL and AniList", () => {
    const sync = computeSync(
      { kind: "anime", mal: state({ progress: 1 }), anilist: state({ progress: 2 }), simkl: state({ progress: 3 }), availability: "both" },
      all3,
    );
    expect(sync.diff).toEqual(["progress"]);
  });

  it("ignores rewatching vs watching", () => {
    const sync = computeSync(
      { kind: "anime", mal: state({ status: "rewatching" }), anilist: state({ status: "rewatching" }), simkl: state(), availability: "both" },
      all3,
    );
    expect(sync).toMatchObject({ inSync: true, diff: [] });
  });

  it("is always in sync for shows and movies", () => {
    for (const kind of ["show", "movie"] as const) {
      expect(computeSync({ kind, mal: null, anilist: null, simkl: state(), availability: "simkl_only" }, all3)).toMatchObject({
        inSync: true,
        missingOn: null,
      });
    }
  });

  it("ignores Simkl when it is not connected", () => {
    const sync = computeSync(
      { kind: "anime", mal: state({ progress: 2 }), anilist: state({ progress: 2 }), simkl: null, availability: "both" },
      { mal: true, anilist: true, simkl: false },
    );
    expect(sync).toMatchObject({ inSync: true, missingOn: null });
  });

  it("uses the latest updatedAt of the three", () => {
    const sync = computeSync(
      { kind: "anime", mal: state({ updatedAt: 1 }), anilist: null, simkl: state({ updatedAt: 9 }), availability: "mal_only" },
      all3,
    );
    expect(sync.updatedAt).toBe(9);
  });
});

describe("displayState / maxState", () => {
  it("picks the most advanced of three", () => {
    const entry = { mal: state({ progress: 2 }), anilist: state({ progress: 3 }), simkl: state({ progress: 5 }) };
    expect(displayState(entry)?.progress).toBe(5);
    expect(displayState({ ...entry, simkl: null })?.progress).toBe(3);
  });

  it("breaks ties with the most recent update", () => {
    const entry = {
      mal: state({ progress: 2, updatedAt: 1 }),
      anilist: null,
      simkl: state({ progress: 2, updatedAt: 5, status: "completed" }),
    };
    expect(displayState(entry)?.status).toBe("completed");
  });

  it("keeps the highest score across any number of states", () => {
    const merged = maxState(state({ progress: 1, score: 4 }), state({ progress: 3, score: 0 }), state({ progress: 2, score: 9 }));
    expect(merged).toMatchObject({ progress: 3, score: 9 });
  });
});

describe("parseSimklAllItems", () => {
  const fixture = {
    shows: [
      {
        added_to_watchlist_at: "2014-11-12T18:42:53Z",
        last_watched_at: "2026-05-04T19:40:59Z",
        user_rated_at: null,
        user_rating: null,
        status: "watching",
        last_watched: "S08E02",
        next_to_watch: "S08E03",
        watched_episodes_count: 126,
        total_episodes_count: 165,
        not_aired_episodes_count: 11,
        show: {
          title: "Futurama",
          poster: "18/18421459bbf0f06beb",
          year: 1999,
          ids: { simkl: 3407, slug: "futurama", imdb: "tt0149460", tvdb: "73871" },
        },
        next_to_watch_info: { title: "How the West Was 1010001", season: 8, episode: 3, date: "2023-08-07T00:00:00-05:00" },
      },
      { status: "nonsense", show: { title: "Broken", ids: { simkl: 1 } } },
      "garbage",
    ],
    anime: [
      {
        added_to_watchlist_at: "2024-01-01T00:00:00Z",
        last_watched_at: "2024-02-01T00:00:00Z",
        user_rated_at: "2024-03-01T00:00:00Z",
        user_rating: 8,
        status: "completed",
        last_watched: null,
        next_to_watch: null,
        watched_episodes_count: 12,
        total_episodes_count: 12,
        anime_type: "tv",
        show: { title: "Frieren", poster: null, year: 2023, ids: { simkl: 2001, mal: "52991", anilist: "154587", anidb: "17617" } },
      },
    ],
    movies: [
      {
        added_to_watchlist_at: "2020-01-01T00:00:00Z",
        status: "completed",
        user_rating: 9,
        total_episodes_count: 0,
        movie: { title: "The Godfather", poster: "10/102447562f6b49ff3a", year: 1972, ids: { simkl: 53434, imdb: "tt0068646", tmdb: "238" } },
      },
    ],
  };

  it("parses shows, anime and movies and skips malformed rows", () => {
    const items = parseSimklAllItems(fixture);
    expect(items.map((i) => [i.kind, i.simklId])).toEqual([
      ["anime", 2001],
      ["show", 3407],
      ["movie", 53434],
    ]);
  });

  it("parses the show details", () => {
    const show = parseSimklAllItems(fixture).find((i) => i.kind === "show");
    expect(show).toMatchObject({
      title: "Futurama",
      year: 1999,
      totalEpisodes: 165,
      cover: "https://wsrv.nl/?url=https://simkl.in/posters/18/18421459bbf0f06beb_m.webp&q=90",
      nextEpisode: { season: 8, episode: 3, title: "How the West Was 1010001" },
      lastEpisode: { season: 8, episode: 2, title: null },
      state: { status: "watching", progress: 126, score: 0 },
    });
    expect(show?.state.updatedAt).toBe(Date.parse("2026-05-04T19:40:59Z"));
  });

  it("parses string ids to numbers and the score", () => {
    const anime = parseSimklAllItems(fixture).find((i) => i.kind === "anime");
    expect(anime).toMatchObject({
      malId: 52991,
      anilistId: 154587,
      cover: null,
      animeType: "tv",
      nextEpisode: null,
      state: { status: "completed", progress: 12, score: 8, updatedAt: Date.parse("2024-03-01T00:00:00Z") },
    });
  });

  it("gives movies a binary progress", () => {
    const movie = parseSimklAllItems(fixture).find((i) => i.kind === "movie");
    expect(movie).toMatchObject({ totalEpisodes: 1, state: { progress: 1, status: "completed", score: 9 } });
  });

  it("handles missing keys and rejects a wrong top-level shape", () => {
    expect(parseSimklAllItems({})).toEqual([]);
    expect(parseSimklAllItems({ anime: [] })).toEqual([]);
    expect(() => parseSimklAllItems("nope")).toThrow();
    expect(() => parseSimklAllItems({ shows: "x" })).toThrow();
  });

  it("parses episode codes and activities", () => {
    expect(parseEpisodeCode("S08E03")).toEqual({ season: 8, episode: 3 });
    expect(parseEpisodeCode("E12")).toEqual({ season: 1, episode: 12 });
    expect(parseEpisodeCode("x")).toBeNull();
    expect(parseSimklActivitiesAll({ all: "2026-05-14T07:12:20Z", settings: { all: "x" } })).toBe("2026-05-14T07:12:20Z");
    expect(parseSimklActivitiesAll({})).toBeNull();
    expect(() => parseSimklActivitiesAll(null)).toThrow();
  });
});

describe("planSimklWrite", () => {
  const anime: SimklWriteTarget = { kind: "anime", simklId: 900, malId: 1, anilistId: 101, nextEpisode: null, lastEpisode: null };
  const show: SimklWriteTarget = {
    kind: "show",
    simklId: 10,
    malId: null,
    anilistId: null,
    nextEpisode: { season: 2, episode: 5, title: null },
    lastEpisode: { season: 2, episode: 4, title: null },
  };
  const movie: SimklWriteTarget = { kind: "movie", simklId: 20, malId: null, anilistId: null, nextEpisode: null, lastEpisode: null };
  const ids = { mal: 1, anilist: 101, simkl: 900 };

  it("adds one episode to an anime", () => {
    const { calls, expected } = planSimklWrite(anime, state({ progress: 3 }), { progress: 4 }, 12);
    expect(calls).toEqual([{ endpoint: "/sync/history", body: { anime: [{ ids, episodes: [{ number: 4 }] }] } }]);
    expect(expected.progress).toBe(4);
  });

  it("jumps an anime from 3 to 7 in one call, folding the status", () => {
    const { calls } = planSimklWrite(anime, state({ progress: 3 }), { progress: 7, status: "on_hold" }, 12);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.anime?.[0]).toMatchObject({ status: "hold", episodes: [4, 5, 6, 7].map((number) => ({ number })) });
  });

  it("removes episodes then sets the score when going back", () => {
    const { calls, expected } = planSimklWrite(anime, state({ progress: 7 }), { progress: 5, score: 8 }, 12);
    expect(calls.map((c) => c.endpoint)).toEqual(["/sync/history/remove", "/sync/ratings"]);
    expect(calls[0]?.body.anime?.[0]?.episodes).toEqual([{ number: 6 }, { number: 7 }]);
    expect(calls[1]?.body.anime?.[0]).toMatchObject({ rating: 8 });
    expect(expected).toMatchObject({ progress: 5, score: 8 });
  });

  it("folds the score into the history item", () => {
    const { calls } = planSimklWrite(anime, state({ progress: 3 }), { progress: 4, score: 9 }, 12);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.anime?.[0]).toMatchObject({ rating: 9 });
  });

  it("chunks very long ranges", () => {
    const { calls } = planSimklWrite(anime, state({ progress: 0 }), { progress: 1200, status: "completed" }, null);
    expect(calls.map((c) => c.body.anime?.[0]?.episodes?.length)).toEqual([500, 500, 200]);
    expect(calls[0]?.body.anime?.[0]?.status).toBeUndefined();
    expect(calls[2]?.body.anime?.[0]?.status).toBe("completed");
  });

  it("uses add-to-list for a status change alone", () => {
    const { calls, expected } = planSimklWrite(anime, state({ progress: 3 }), { status: "on_hold" }, 12);
    expect(calls).toEqual([{ endpoint: "/sync/add-to-list", body: { anime: [{ ids, to: "hold" }] } }]);
    expect(expected.status).toBe("on_hold");
  });

  it("uses history for status completed alone", () => {
    const { calls } = planSimklWrite(anime, state({ progress: 12 }), { status: "completed" }, 12);
    expect(calls).toEqual([{ endpoint: "/sync/history", body: { anime: [{ ids, status: "completed" }] } }]);
  });

  it("uses ratings for a score alone and ratings/remove for 0", () => {
    const set = planSimklWrite(anime, state({ score: 2 }), { score: 7 }, 12);
    expect(set.calls).toEqual([{ endpoint: "/sync/ratings", body: { anime: [{ ids, rating: 7 }] } }]);
    const clear = planSimklWrite(anime, state({ score: 7 }), { score: 0 }, 12);
    expect(clear.calls).toEqual([{ endpoint: "/sync/ratings/remove", body: { anime: [{ ids }] } }]);
    expect(clear.expected.score).toBe(0);
  });

  it("adds a new anime as plan to watch", () => {
    const { calls, expected } = planSimklWrite(anime, null, { status: "plan_to_watch", progress: 0, score: 0 }, 12);
    expect(calls.map((c) => c.endpoint)).toEqual(["/sync/add-to-list"]);
    expect(expected.status).toBe("plan_to_watch");
  });

  it("steps a show forward with +1 using the next episode", () => {
    const { calls, expected } = planSimklWrite(show, state({ progress: 10 }), { progress: 11 }, 24);
    expect(calls).toEqual([
      { endpoint: "/sync/history", body: { shows: [{ ids: { simkl: 10 }, seasons: [{ number: 2, episodes: [{ number: 5 }] }] }] } },
    ]);
    expect(expected.progress).toBe(11);
  });

  it("steps a show back with -1 using the last episode", () => {
    const { calls } = planSimklWrite(show, state({ progress: 10 }), { progress: 9 }, 24);
    expect(calls).toEqual([
      {
        endpoint: "/sync/history/remove",
        body: { shows: [{ ids: { simkl: 10 }, seasons: [{ number: 2, episodes: [{ number: 4 }] }] }] },
      },
    ]);
  });

  it("rejects other jumps and missing episode refs on a show", () => {
    expect(() => planSimklWrite(show, state({ progress: 10 }), { progress: 15 }, 24)).toThrow(SimklPlanError);
    expect(() => planSimklWrite(show, state({ progress: 10 }), { progress: 15 }, 24)).toThrow("Utilise +1 / -1");
    expect(() => planSimklWrite({ ...show, nextEpisode: null }, state({ progress: 1 }), { progress: 2 }, 24)).toThrow(SimklPlanError);
  });

  it("completes a whole show in one call", () => {
    const { calls, expected } = planSimklWrite(show, state({ progress: 10 }), { status: "completed", progress: 24, score: 9 }, 24);
    expect(calls).toEqual([
      { endpoint: "/sync/history", body: { shows: [{ ids: { simkl: 10 }, status: "completed", rating: 9 }] } },
    ]);
    expect(expected).toMatchObject({ status: "completed", progress: 24 });
  });

  it("uses add-to-list for a show status", () => {
    const { calls } = planSimklWrite(show, state(), { status: "dropped" }, 24);
    expect(calls).toEqual([{ endpoint: "/sync/add-to-list", body: { shows: [{ ids: { simkl: 10 }, to: "dropped" }] } }]);
  });

  it("handles movies", () => {
    const done = planSimklWrite(movie, state({ status: "plan_to_watch" }), { status: "completed", score: 8 }, 1);
    expect(done.calls).toEqual([{ endpoint: "/sync/history", body: { movies: [{ ids: { simkl: 20 }, rating: 8 }] } }]);
    expect(done.expected).toMatchObject({ status: "completed", progress: 1, score: 8 });

    const plan = planSimklWrite(movie, state({ status: "completed", progress: 1 }), { status: "plan_to_watch" }, 1);
    expect(plan.calls).toEqual([{ endpoint: "/sync/add-to-list", body: { movies: [{ ids: { simkl: 20 }, to: "plantowatch" }] } }]);
    expect(plan.expected).toMatchObject({ status: "plan_to_watch", progress: 0 });

    const dropped = planSimklWrite(movie, null, { status: "dropped" }, 1);
    expect(dropped.calls[0]).toEqual({ endpoint: "/sync/add-to-list", body: { movies: [{ ids: { simkl: 20 }, to: "dropped" }] } });
    expect(dropped.expected.status).toBe("dropped");

    const watching = planSimklWrite(movie, null, { status: "watching" }, 1);
    expect(watching.calls[0]?.endpoint).toBe("/sync/history");
    expect(watching.expected.status).toBe("completed");
  });

  it("plans a removal and builds ids", () => {
    expect(planSimklRemove(anime)).toEqual([{ endpoint: "/sync/history/remove", body: { anime: [{ ids }] } }]);
    expect(planSimklRemove(movie)).toEqual([{ endpoint: "/sync/history/remove", body: { movies: [{ ids: { simkl: 20 } }] } }]);
    expect(simklIds({ kind: "anime", simklId: null, malId: 4, anilistId: null })).toEqual({ mal: 4 });
    expect(simklIds({ kind: "show", simklId: 3, malId: 4, anilistId: 5 })).toEqual({ simkl: 3 });
    expect(() => planSimklRemove({ ...movie, simklId: null })).toThrow(SimklPlanError);
  });
});

describe("labels", () => {
  it("builds episode codes and Simkl urls", () => {
    expect(episodeCode({ season: 2, episode: 5 })).toBe("S02E05");
    expect(simklUrl("anime", 1)).toBe("https://simkl.com/anime/1");
    expect(simklUrl("show", 2)).toBe("https://simkl.com/tv/2");
    expect(simklUrl("movie", 3)).toBe("https://simkl.com/movies/3");
  });
});
