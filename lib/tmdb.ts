import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { getEnv, isTmdbEnabled } from "./env";
import { ServiceError } from "./errors";
import { fetchWithRetry, readJson } from "./http";
import type { LocalKind } from "./mapping";
import { tmdbMedia } from "./schema";
import {
  buildTmdbRequest,
  detailsTtlMs,
  parseTmdbDetails,
  parseTmdbSearch,
  type TmdbDetails,
  type TmdbSearchHit,
} from "./tmdb-parse";

export { tmdbPosterUrl, type TmdbDetails, type TmdbSearchHit } from "./tmdb-parse";

function apiKey(): string {
  const key = getEnv().TMDB_API_KEY;
  if (!key || !isTmdbEnabled()) {
    throw new ServiceError("tmdb", 400, "TMDB n'est pas configuré", "not_connected");
  }
  return key;
}

/** GET on the TMDB API. Returns null on 404; the key never reaches the logs (labels carry no query string). */
async function tmdbGet(path: string, params: Record<string, string | number | boolean>, label: string) {
  const { url, headers } = buildTmdbRequest(path, params, apiKey());
  const res = await fetchWithRetry("tmdb", url, { label, headers });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new ServiceError("tmdb", res.status, `TMDB a répondu ${res.status}`);
  }
  const json = await readJson(res);
  if (json === null) throw new ServiceError("tmdb", res.status, "Réponse TMDB illisible", "api");
  return json;
}

/** Search shows or movies by title (first page). */
export async function searchTmdb(q: string, kind: LocalKind): Promise<TmdbSearchHit[]> {
  const path = kind === "show" ? "/search/tv" : "/search/movie";
  const json = await tmdbGet(path, { query: q, include_adult: false, page: 1 }, `GET ${path}`);
  return json === null ? [] : parseTmdbSearch(json, kind);
}

interface CachedDetails {
  details: TmdbDetails | null;
  fetchedAt: number;
}

/** Cached details of one id; undefined = never fetched. A row with a null payload is a known 404. */
export function readCachedDetails(kind: LocalKind, id: number): CachedDetails | undefined {
  const row = getDb()
    .select()
    .from(tmdbMedia)
    .where(and(eq(tmdbMedia.kind, kind), eq(tmdbMedia.tmdbId, id)))
    .get();
  if (!row) return undefined;
  return { details: row.payload === null ? null : parseTmdbDetails(row.payload, kind), fetchedAt: row.fetchedAt };
}

/** True when the cached details are missing or older than their TTL. */
export function isStale(cached: CachedDetails | undefined, kind: LocalKind, now = Date.now()): boolean {
  if (!cached) return true;
  const status = cached.details?.kind === "show" ? cached.details.status : null;
  return now - cached.fetchedAt > detailsTtlMs(kind, status);
}

/**
 * Details of a show or movie, from the `tmdb_media` cache when fresh (12 h ongoing shows,
 * 7 days finished shows, 30 days movies), otherwise fetched. null = TMDB does not know this id.
 */
export async function getTmdbDetails(
  kind: LocalKind,
  id: number,
  options: { force?: boolean } = {},
): Promise<TmdbDetails | null> {
  const cached = readCachedDetails(kind, id);
  if (!options.force && cached && !isStale(cached, kind)) return cached.details;

  const path = kind === "show" ? `/tv/${id}` : `/movie/${id}`;
  const payload = await tmdbGet(path, {}, `GET ${kind === "show" ? "/tv/:id" : "/movie/:id"}`);
  const fetchedAt = Date.now();
  getDb()
    .insert(tmdbMedia)
    .values({ kind, tmdbId: id, payload, fetchedAt })
    .onConflictDoUpdate({ target: [tmdbMedia.kind, tmdbMedia.tmdbId], set: { payload, fetchedAt } })
    .run();
  return payload === null ? null : parseTmdbDetails(payload, kind);
}
