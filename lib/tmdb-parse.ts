/**
 * Pure parsing of TMDB responses (search, TV and movie details) and image URLs.
 * Malformed rows are ignored and missing fields tolerated. Unit-tested in tests/tmdb.test.ts.
 */
import { z } from "zod";
import type { LocalKind } from "./mapping";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

/** Full poster URL for a TMDB `poster_path` ("/abc.jpg"), null when there is none. */
export function tmdbPosterUrl(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/")) return null;
  return `${IMAGE_BASE}${path}`;
}

/** Release year from a TMDB date ("2011-04-17"), null when absent or malformed. */
export function yearOf(date: string | null | undefined): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(date ?? "");
  return match ? Number(match[1]) : null;
}

/** Midnight UTC of a TMDB air date, null when absent or malformed. */
export function airDateToMs(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

const text = z.string().nullish().transform((v) => (v && v.trim().length > 0 ? v.trim() : null));
const date = z.string().nullish().transform((v) => (v && v.length > 0 ? v : null));

export interface TmdbSearchHit {
  kind: LocalKind;
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  posterPath: string | null;
  year: number | null;
  overview: string | null;
}

export interface TmdbEpisodeInfo {
  season: number;
  episode: number;
  /** YYYY-MM-DD */
  airDate: string | null;
}

export interface TmdbSeasonInfo {
  season: number;
  episodes: number;
  airDate: string | null;
}

export interface TmdbShowDetails {
  kind: "show";
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  posterPath: string | null;
  year: number | null;
  /** "Returning Series", "Ended", "Canceled", "In Production", "Planned"... */
  status: string | null;
  numberOfEpisodes: number | null;
  /** All seasons, specials (season 0) included */
  seasons: TmdbSeasonInfo[];
  lastEpisode: TmdbEpisodeInfo | null;
  nextEpisode: TmdbEpisodeInfo | null;
}

export interface TmdbMovieDetails {
  kind: "movie";
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  posterPath: string | null;
  year: number | null;
  runtime: number | null;
}

export type TmdbDetails = TmdbShowDetails | TmdbMovieDetails;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const searchRowSchema = z.object({
  id: z.number().int().positive(),
  name: text,
  title: text,
  original_name: text,
  original_title: text,
  poster_path: text,
  first_air_date: date,
  release_date: date,
  overview: text,
});

const searchSchema = z.object({ results: z.array(z.unknown()) });

export function parseTmdbSearch(json: unknown, kind: LocalKind): TmdbSearchHit[] {
  const page = searchSchema.safeParse(json);
  if (!page.success) return [];
  const hits: TmdbSearchHit[] = [];
  for (const raw of page.data.results) {
    const row = searchRowSchema.safeParse(raw);
    if (!row.success) continue;
    const r = row.data;
    const title = kind === "show" ? (r.name ?? r.title) : (r.title ?? r.name);
    if (!title) continue;
    const original = kind === "show" ? (r.original_name ?? r.original_title) : (r.original_title ?? r.original_name);
    hits.push({
      kind,
      tmdbId: r.id,
      title,
      originalTitle: original && original !== title ? original : null,
      posterPath: r.poster_path,
      year: yearOf(kind === "show" ? r.first_air_date : r.release_date),
      overview: r.overview,
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

const episodeSchema = z.object({
  season_number: z.number().int().min(0),
  episode_number: z.number().int().min(1),
  air_date: date,
});

function episodeOf(value: unknown): TmdbEpisodeInfo | null {
  const parsed = episodeSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    season: parsed.data.season_number,
    episode: parsed.data.episode_number,
    airDate: parsed.data.air_date,
  };
}

const seasonSchema = z.object({
  season_number: z.number().int().min(0),
  episode_count: z.number().int().min(0).catch(0),
  air_date: date,
});

const tvSchema = z.object({
  id: z.number().int().positive(),
  name: text,
  original_name: text,
  poster_path: text,
  first_air_date: date,
  status: text,
  number_of_episodes: z.number().int().min(0).nullish(),
  seasons: z.array(z.unknown()).nullish(),
  last_episode_to_air: z.unknown().nullish(),
  next_episode_to_air: z.unknown().nullish(),
});

/** null when the payload is not a usable TV show (no id or no name). */
export function parseTvDetails(json: unknown): TmdbShowDetails | null {
  const parsed = tvSchema.safeParse(json);
  if (!parsed.success || !parsed.data.name) return null;
  const tv = parsed.data;
  const name = parsed.data.name;
  const seasons: TmdbSeasonInfo[] = [];
  for (const raw of tv.seasons ?? []) {
    const season = seasonSchema.safeParse(raw);
    if (season.success) {
      seasons.push({
        season: season.data.season_number,
        episodes: season.data.episode_count,
        airDate: season.data.air_date,
      });
    }
  }
  return {
    kind: "show",
    tmdbId: tv.id,
    title: name,
    originalTitle: tv.original_name && tv.original_name !== name ? tv.original_name : null,
    posterPath: tv.poster_path,
    year: yearOf(tv.first_air_date),
    status: tv.status,
    numberOfEpisodes: tv.number_of_episodes ?? null,
    seasons,
    lastEpisode: episodeOf(tv.last_episode_to_air),
    nextEpisode: episodeOf(tv.next_episode_to_air),
  };
}

const movieSchema = z.object({
  id: z.number().int().positive(),
  title: text,
  original_title: text,
  poster_path: text,
  release_date: date,
  runtime: z.number().int().min(0).nullish(),
});

/** null when the payload is not a usable movie (no id or no title). */
export function parseMovieDetails(json: unknown): TmdbMovieDetails | null {
  const parsed = movieSchema.safeParse(json);
  if (!parsed.success || !parsed.data.title) return null;
  const m = parsed.data;
  const title = parsed.data.title;
  return {
    kind: "movie",
    tmdbId: m.id,
    title,
    originalTitle: m.original_title && m.original_title !== title ? m.original_title : null,
    posterPath: m.poster_path,
    year: yearOf(m.release_date),
    runtime: m.runtime || null,
  };
}

/** Parses a cached raw payload according to its kind. */
export function parseTmdbDetails(json: unknown, kind: LocalKind): TmdbDetails | null {
  return kind === "show" ? parseTvDetails(json) : parseMovieDetails(json);
}

// ---------------------------------------------------------------------------
// Requests and cache policy
// ---------------------------------------------------------------------------

const API_BASE = "https://api.themoviedb.org/3";

/** v4 read access tokens are JWTs ("eyJ..."), v3 keys are 32 hex characters. */
export function isTmdbReadToken(key: string): boolean {
  return key.startsWith("eyJ");
}

/** URL and headers of a TMDB call: v4 token as Bearer header, v3 key as `api_key` parameter. Always French. */
export function buildTmdbRequest(
  path: string,
  params: Record<string, string | number | boolean>,
  key: string,
): { url: string; headers: Record<string, string> } {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("language", "fr-FR");
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (isTmdbReadToken(key)) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  return { url: url.toString(), headers };
}

const ONGOING_STATUSES = new Set(["Returning Series", "In Production", "Planned"]);

/** How long cached details stay fresh: ongoing shows 12 h, finished shows 7 days, movies 30 days. */
export function detailsTtlMs(kind: LocalKind, showStatus: string | null): number {
  const hour = 60 * 60_000;
  if (kind === "movie") return 30 * 24 * hour;
  return showStatus !== null && ONGOING_STATUSES.has(showStatus) ? 12 * hour : 7 * 24 * hour;
}
