import { describe, expect, it } from "vitest";
import {
  airDateToMs,
  buildTmdbRequest,
  detailsTtlMs,
  isTmdbReadToken,
  parseMovieDetails,
  parseTmdbDetails,
  parseTmdbSearch,
  parseTvDetails,
  tmdbPosterUrl,
  yearOf,
} from "@/lib/tmdb-parse";
import { movieDetails, movieSearch, tvEnded, tvReturning, tvSearch } from "./fixtures/tmdb";

describe("tmdbPosterUrl", () => {
  it("builds a w342 URL", () => {
    expect(tmdbPosterUrl("/abc.jpg")).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
  });
  it("returns null without a usable path", () => {
    expect(tmdbPosterUrl(null)).toBeNull();
    expect(tmdbPosterUrl("")).toBeNull();
    expect(tmdbPosterUrl("abc.jpg")).toBeNull();
  });
});

describe("dates", () => {
  it("extracts the year", () => {
    expect(yearOf("2008-01-20")).toBe(2008);
    expect(yearOf("")).toBeNull();
    expect(yearOf(null)).toBeNull();
    expect(yearOf("soon")).toBeNull();
  });
  it("parses air dates as midnight UTC", () => {
    expect(airDateToMs("2025-10-16")).toBe(Date.UTC(2025, 9, 16));
    expect(airDateToMs("16/10/2025")).toBeNull();
    expect(airDateToMs(null)).toBeNull();
  });
});

describe("parseTmdbSearch", () => {
  it("parses shows and skips malformed rows", () => {
    const hits = parseTmdbSearch(tvSearch, "show");
    expect(hits.map((h) => h.tmdbId)).toEqual([1396, 60625]);
    expect(hits[0]).toMatchObject({
      kind: "show",
      title: "Breaking Bad",
      originalTitle: null,
      year: 2008,
      posterPath: "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
    });
    expect(hits[0]?.overview).toContain("professeur de chimie");
  });

  it("keeps the original title when it differs and tolerates missing fields", () => {
    const rick = parseTmdbSearch(tvSearch, "show")[1];
    expect(rick).toMatchObject({ originalTitle: "Rick and Morty", year: null, posterPath: null, overview: null });
  });

  it("parses movies with their release year", () => {
    expect(parseTmdbSearch(movieSearch, "movie")).toEqual([
      {
        kind: "movie",
        tmdbId: 603,
        title: "Matrix",
        originalTitle: "The Matrix",
        posterPath: "/dXNAPwY7VrqMAo51EKhhCJfaGb5.jpg",
        year: 1999,
        overview: expect.stringContaining("Neo"),
      },
    ]);
  });

  it("returns an empty list for unexpected payloads", () => {
    expect(parseTmdbSearch(null, "show")).toEqual([]);
    expect(parseTmdbSearch({ status_code: 7 }, "movie")).toEqual([]);
  });
});

describe("parseTvDetails", () => {
  it("reads seasons, status and episode pointers", () => {
    const show = parseTvDetails(tvReturning);
    expect(show).toMatchObject({
      kind: "show",
      tmdbId: 9001,
      title: "Les Veilleurs",
      originalTitle: "The Watchers",
      year: 2024,
      status: "Returning Series",
      numberOfEpisodes: 12,
      lastEpisode: { season: 2, episode: 2, airDate: "2025-10-09" },
      nextEpisode: { season: 2, episode: 3, airDate: "2025-10-16" },
    });
    expect(show?.seasons).toEqual([
      { season: 0, episodes: 3, airDate: "2024-08-01" },
      { season: 1, episodes: 6, airDate: "2024-09-05" },
      { season: 2, episodes: 4, airDate: "2025-10-02" },
    ]);
  });

  it("tolerates absent optional fields and drops bad seasons", () => {
    const show = parseTvDetails({ id: 1, name: "Minimal", seasons: [{ season_number: 1 }, { nope: true }] });
    expect(show).toMatchObject({
      title: "Minimal",
      status: null,
      numberOfEpisodes: null,
      lastEpisode: null,
      nextEpisode: null,
      seasons: [{ season: 1, episodes: 0, airDate: null }],
    });
  });

  it("has no next episode for an ended show", () => {
    expect(parseTvDetails(tvEnded)?.nextEpisode).toBeNull();
  });

  it("rejects payloads without id or name", () => {
    expect(parseTvDetails({ id: 1 })).toBeNull();
    expect(parseTvDetails({ success: false, status_code: 34 })).toBeNull();
    expect(parseTvDetails("nope")).toBeNull();
  });
});

describe("parseMovieDetails", () => {
  it("reads title, year and runtime", () => {
    expect(parseMovieDetails(movieDetails)).toEqual({
      kind: "movie",
      tmdbId: 603,
      title: "Matrix",
      originalTitle: "The Matrix",
      posterPath: "/dXNAPwY7VrqMAo51EKhhCJfaGb5.jpg",
      year: 1999,
      runtime: 136,
    });
  });

  it("treats a zero runtime as unknown and rejects unusable payloads", () => {
    expect(parseMovieDetails({ id: 2, title: "Court", runtime: 0 })?.runtime).toBeNull();
    expect(parseMovieDetails({ id: 2 })).toBeNull();
  });

  it("dispatches on the kind", () => {
    expect(parseTmdbDetails(tvEnded, "show")?.kind).toBe("show");
    expect(parseTmdbDetails(movieDetails, "movie")?.kind).toBe("movie");
    expect(parseTmdbDetails(movieDetails, "show")).toBeNull();
  });
});

describe("authentication", () => {
  it("recognises v4 read tokens", () => {
    expect(isTmdbReadToken("eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBe(true);
    expect(isTmdbReadToken("0123456789abcdef0123456789abcdef")).toBe(false);
  });

  it("sends a v3 key as api_key and always asks for French", () => {
    const { url, headers } = buildTmdbRequest("/search/tv", { query: "breaking bad", include_adult: false }, "k3y");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.themoviedb.org/3/search/tv");
    expect(parsed.searchParams.get("api_key")).toBe("k3y");
    expect(parsed.searchParams.get("language")).toBe("fr-FR");
    expect(parsed.searchParams.get("query")).toBe("breaking bad");
    expect(parsed.searchParams.get("include_adult")).toBe("false");
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends a v4 token as a Bearer header and keeps it out of the URL", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
    const { url, headers } = buildTmdbRequest("/tv/1396", {}, token);
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(url).not.toContain(token);
    expect(new URL(url).searchParams.has("api_key")).toBe(false);
  });
});

describe("detailsTtlMs", () => {
  const hour = 3_600_000;
  it("refreshes ongoing shows every 12 hours", () => {
    for (const status of ["Returning Series", "In Production", "Planned"]) {
      expect(detailsTtlMs("show", status)).toBe(12 * hour);
    }
  });
  it("keeps finished shows 7 days and movies 30 days", () => {
    expect(detailsTtlMs("show", "Ended")).toBe(7 * 24 * hour);
    expect(detailsTtlMs("show", null)).toBe(7 * 24 * hour);
    expect(detailsTtlMs("movie", null)).toBe(30 * 24 * hour);
  });
});
