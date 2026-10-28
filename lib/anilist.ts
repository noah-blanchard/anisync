import "server-only";
import { z } from "zod";
import { cleanSynopsis, type PoolItem } from "./booster";
import { getConnection, readAccessToken, updateExtra } from "./connections";
import { getEnv, redirectUris } from "./env";
import { notConnected, ServiceError } from "./errors";
import { fetchWithRetry, readJson } from "./http";
import {
  ANILIST_STATUSES,
  clampScore,
  fromAniListScore,
  fromAniListStatus,
  normalizeTotal,
  toAniListScoreRaw,
  toAniListStatus,
  type EntryPatch,
  type EntryState,
} from "./mapping";
import type { AniListListItem } from "./merge";

const OAUTH_BASE = "https://anilist.co/api/v2/oauth";
const GRAPHQL_URL = "https://graphql.anilist.co";
const RESOLVE_BATCH = 50;

// ---------------------------------------------------------------------------
// GraphQL transport
// ---------------------------------------------------------------------------

const gqlErrorSchema = z.object({
  errors: z.array(z.object({ message: z.string(), status: z.number().optional() })).optional(),
});

interface GqlOptions {
  label: string;
  /** "auth" requires a connection, "optional" uses it when available, "none" never sends it */
  auth?: "auth" | "optional" | "none";
  token?: string;
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  schema: z.ZodType<T>,
  options: GqlOptions,
): Promise<T> {
  let token = options.token;
  const mode = options.auth ?? "auth";
  if (!token && mode !== "none") {
    const row = getConnection("anilist");
    if (row) token = readAccessToken(row);
    else if (mode === "auth") throw notConnected("anilist");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchWithRetry("anilist", GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    label: options.label,
  });
  const json = await readJson(res);
  const errors = gqlErrorSchema.safeParse(json);
  const firstError = errors.success ? errors.data.errors?.[0] : undefined;

  if (!res.ok || firstError) {
    const message = firstError?.message ?? `Erreur AniList ${res.status}`;
    let status = firstError?.status ?? res.status;
    if (/invalid token|unauthorized/i.test(message)) status = 401;
    throw new ServiceError("anilist", status >= 400 ? status : 500, message);
  }

  const parsed = z.object({ data: schema }).safeParse(json);
  if (!parsed.success) throw new ServiceError("anilist", 502, "Réponse AniList invalide");
  return parsed.data.data;
}

// ---------------------------------------------------------------------------
// OAuth (authorization code grant)
// ---------------------------------------------------------------------------

export function anilistAuthorizeUrl(state: string): string {
  const env = getEnv();
  const params = new URLSearchParams({
    client_id: env.ANILIST_CLIENT_ID,
    redirect_uri: redirectUris(env).anilist,
    response_type: "code",
    state,
  });
  return `${OAUTH_BASE}/authorize?${params.toString()}`;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

export async function exchangeAniListCode(code: string): Promise<{ accessToken: string; expiresAt: number }> {
  const env = getEnv();
  const res = await fetchWithRetry("anilist", `${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: env.ANILIST_CLIENT_ID,
      client_secret: env.ANILIST_CLIENT_SECRET,
      redirect_uri: redirectUris(env).anilist,
      code,
    }),
    label: "POST /oauth/token",
  });
  const json = await readJson(res);
  if (!res.ok) {
    const err = z.object({ error: z.string().optional(), message: z.string().optional() }).safeParse(json);
    const detail = err.success ? [err.data.error, err.data.message].filter(Boolean).join(": ") : "";
    throw new ServiceError("anilist", res.status, detail || `Échec de l'échange de jeton (${res.status})`);
  }
  const parsed = tokenSchema.safeParse(json);
  if (!parsed.success) throw new ServiceError("anilist", 502, "Réponse de jeton AniList invalide");
  // AniList tokens last one year and cannot be refreshed.
  const expiresIn = parsed.data.expires_in ?? 365 * 24 * 60 * 60;
  return { accessToken: parsed.data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

const viewerSchema = z.object({
  Viewer: z.object({
    id: z.number(),
    name: z.string(),
    avatar: z.object({ medium: z.string().nullish() }).nullish(),
    mediaListOptions: z.object({ scoreFormat: z.string().nullish() }).nullish(),
  }),
});

export async function fetchViewer(token: string) {
  const data = await gql(
    `query { Viewer { id name avatar { medium } mediaListOptions { scoreFormat } } }`,
    {},
    viewerSchema,
    { label: "query Viewer", token },
  );
  return {
    id: data.Viewer.id,
    name: data.Viewer.name,
    avatarUrl: data.Viewer.avatar?.medium ?? null,
    scoreFormat: data.Viewer.mediaListOptions?.scoreFormat ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const titleSchema = z.object({
  romaji: z.string().nullish(),
  english: z.string().nullish(),
  native: z.string().nullish(),
  userPreferred: z.string().nullish(),
});

const listEntrySchema = z.object({
  id: z.number(),
  status: z.enum(ANILIST_STATUSES).nullish(),
  progress: z.number().nullish(),
  repeat: z.number().nullish(),
  score: z.number().nullish(),
  updatedAt: z.number().nullish(),
  media: z.object({
    id: z.number(),
    idMal: z.number().nullish(),
    episodes: z.number().nullish(),
    status: z.string().nullish(),
    format: z.string().nullish(),
    coverImage: z.object({ large: z.string().nullish(), color: z.string().nullish() }).nullish(),
    title: titleSchema.nullish(),
    nextAiringEpisode: z.object({ episode: z.number(), airingAt: z.number() }).nullish(),
  }),
});

const listSchema = z.object({
  Viewer: z.object({ mediaListOptions: z.object({ scoreFormat: z.string().nullish() }).nullish() }).nullish(),
  MediaListCollection: z
    .object({ lists: z.array(z.object({ entries: z.array(listEntrySchema).nullish() }).nullish()).nullish() })
    .nullish(),
});

const LIST_QUERY = `
query ($uid: Int) {
  Viewer { mediaListOptions { scoreFormat } }
  MediaListCollection(userId: $uid, type: ANIME, forceSingleCompletedList: true) {
    lists {
      entries {
        id status progress repeat score(format: POINT_100) updatedAt
        media {
          id idMal episodes status format
          coverImage { large color }
          title { romaji english native userPreferred }
          nextAiringEpisode { episode airingAt }
        }
      }
    }
  }
}`;

function entryState(entry: {
  id: number;
  status?: z.infer<typeof listEntrySchema>["status"];
  progress?: number | null;
  score?: number | null;
  updatedAt?: number | null;
}): EntryState {
  return {
    status: fromAniListStatus(entry.status ?? "PLANNING"),
    progress: Math.max(0, entry.progress ?? 0),
    score: fromAniListScore(entry.score),
    updatedAt: entry.updatedAt ? entry.updatedAt * 1000 : null,
    entryId: entry.id,
  };
}

export async function fetchAniListList(): Promise<AniListListItem[]> {
  const row = getConnection("anilist");
  if (!row) throw notConnected("anilist");
  const data = await gql(LIST_QUERY, { uid: Number(row.userId) }, listSchema, { label: "query MediaListCollection" });

  const scoreFormat = data.Viewer?.mediaListOptions?.scoreFormat ?? undefined;
  if (scoreFormat && scoreFormat !== row.extra.scoreFormat) updateExtra("anilist", { ...row.extra, scoreFormat });

  // An entry appears once per custom list it belongs to: dedupe by media id.
  const byMedia = new Map<number, AniListListItem>();
  for (const list of data.MediaListCollection?.lists ?? []) {
    for (const entry of list?.entries ?? []) {
      if (byMedia.has(entry.media.id)) continue;
      const m = entry.media;
      byMedia.set(m.id, {
        anilistId: m.id,
        malId: m.idMal ?? null,
        title: m.title?.userPreferred ?? m.title?.romaji ?? m.title?.english ?? m.title?.native ?? "Sans titre",
        englishTitle: m.title?.english ?? null,
        cover: m.coverImage?.large ?? null,
        color: m.coverImage?.color ?? null,
        totalEpisodes: normalizeTotal(m.episodes),
        format: m.format ?? null,
        nextAiring: m.nextAiringEpisode
          ? { episode: m.nextAiringEpisode.episode, airingAt: m.nextAiringEpisode.airingAt * 1000 }
          : null,
        state: entryState(entry),
      });
    }
  }
  return [...byMedia.values()];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const saveSchema = z.object({
  SaveMediaListEntry: z.object({
    id: z.number(),
    status: z.enum(ANILIST_STATUSES).nullish(),
    progress: z.number().nullish(),
    score: z.number().nullish(),
    updatedAt: z.number().nullish(),
  }),
});

const SAVE_MUTATION = `
mutation SaveMediaListEntry($mediaId: Int, $status: MediaListStatus, $progress: Int, $scoreRaw: Int) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, scoreRaw: $scoreRaw) {
    id status progress score(format: POINT_100) updatedAt
  }
}`;

/** Creates or updates; only the given fields are sent. */
export async function saveAniListEntry(mediaId: number, patch: EntryPatch): Promise<EntryState> {
  const variables: Record<string, unknown> = { mediaId };
  if (patch.status !== undefined) variables.status = toAniListStatus(patch.status);
  if (patch.progress !== undefined) variables.progress = Math.max(0, Math.floor(patch.progress));
  if (patch.score !== undefined) variables.scoreRaw = toAniListScoreRaw(clampScore(patch.score));
  const data = await gql(SAVE_MUTATION, variables, saveSchema, { label: "mutation SaveMediaListEntry" });
  return entryState(data.SaveMediaListEntry);
}

export async function deleteAniListEntry(listEntryId: number): Promise<void> {
  await gql(
    `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`,
    { id: listEntryId },
    z.object({ DeleteMediaListEntry: z.object({ deleted: z.boolean().nullish() }).nullish() }),
    { label: "mutation DeleteMediaListEntry" },
  );
}

/** Finds my list entry id for a media (null when not in my list). */
export async function findAniListEntryId(mediaId: number): Promise<number | null> {
  const row = getConnection("anilist");
  if (!row) throw notConnected("anilist");
  try {
    const data = await gql(
      `query ($uid: Int, $mid: Int) { MediaList(userId: $uid, mediaId: $mid) { id } }`,
      { uid: Number(row.userId), mid: mediaId },
      z.object({ MediaList: z.object({ id: z.number() }).nullish() }),
      { label: "query MediaList" },
    );
    return data.MediaList?.id ?? null;
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Id resolution
// ---------------------------------------------------------------------------

/** AniList id for a MAL id, null when AniList has no such media. */
export async function resolveAniListId(malId: number): Promise<number | null> {
  try {
    const data = await gql(
      `query ($id: Int) { Media(idMal: $id, type: ANIME) { id idMal } }`,
      { id: malId },
      z.object({ Media: z.object({ id: z.number(), idMal: z.number().nullish() }).nullish() }),
      { label: "query Media(idMal)", auth: "optional" },
    );
    return data.Media?.id ?? null;
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) return null;
    throw error;
  }
}

/** MAL id of an AniList media, null when it has none. */
export async function resolveMalId(anilistId: number): Promise<number | null> {
  try {
    const data = await gql(
      `query ($id: Int) { Media(id: $id, type: ANIME) { id idMal } }`,
      { id: anilistId },
      z.object({ Media: z.object({ id: z.number(), idMal: z.number().nullish() }).nullish() }),
      { label: "query Media(id)", auth: "optional" },
    );
    return data.Media?.idMal ?? null;
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) return null;
    throw error;
  }
}

/** Batch resolution (50 per query). Every requested id gets an answer, null = no match. */
export async function resolveAniListIds(malIds: number[]): Promise<Array<{ malId: number; anilistId: number | null }>> {
  const result: Array<{ malId: number; anilistId: number | null }> = [];
  for (let i = 0; i < malIds.length; i += RESOLVE_BATCH) {
    const batch = malIds.slice(i, i + RESOLVE_BATCH);
    const data = await gql(
      `query ($ids: [Int]) { Page(perPage: ${RESOLVE_BATCH}) { media(idMal_in: $ids, type: ANIME) { id idMal } } }`,
      { ids: batch },
      z.object({
        Page: z.object({ media: z.array(z.object({ id: z.number(), idMal: z.number().nullish() }).nullish()) }),
      }),
      { label: "query Page(idMal_in)", auth: "optional" },
    );
    const found = new Map<number, number>();
    for (const media of data.Page.media) {
      if (media?.idMal != null) found.set(media.idMal, media.id);
    }
    for (const malId of batch) result.push({ malId, anilistId: found.get(malId) ?? null });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  Page: z.object({
    media: z.array(
      z.object({
        id: z.number(),
        idMal: z.number().nullish(),
        episodes: z.number().nullish(),
        format: z.string().nullish(),
        seasonYear: z.number().nullish(),
        coverImage: z.object({ large: z.string().nullish(), color: z.string().nullish() }).nullish(),
        title: z
          .object({ userPreferred: z.string().nullish(), romaji: z.string().nullish(), english: z.string().nullish() })
          .nullish(),
      }),
    ),
  }),
});

export interface SearchResult {
  anilistId: number;
  malId: number | null;
  title: string;
  englishTitle: string | null;
  cover: string | null;
  color: string | null;
  totalEpisodes: number | null;
  format: string | null;
  year: number | null;
}

export async function searchAnime(q: string): Promise<SearchResult[]> {
  const data = await gql(
    `query ($q: String) {
      Page(perPage: 20) {
        media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
          id idMal episodes format seasonYear
          coverImage { large color }
          title { userPreferred romaji english }
        }
      }
    }`,
    { q },
    searchSchema,
    { label: "query Page(search)", auth: "optional" },
  );
  return data.Page.media.map((m) => ({
    anilistId: m.id,
    malId: m.idMal ?? null,
    title: m.title?.userPreferred ?? m.title?.romaji ?? m.title?.english ?? "Sans titre",
    englishTitle: m.title?.english ?? null,
    cover: m.coverImage?.large ?? null,
    color: m.coverImage?.color ?? null,
    totalEpisodes: normalizeTotal(m.episodes),
    format: m.format ?? null,
    year: m.seasonYear ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Booster pool
// ---------------------------------------------------------------------------

const boosterSchema = z.object({
  Page: z.object({
    media: z.array(
      z.object({
        id: z.number(),
        idMal: z.number().nullish(),
        episodes: z.number().nullish(),
        format: z.string().nullish(),
        seasonYear: z.number().nullish(),
        averageScore: z.number().nullish(),
        popularity: z.number().nullish(),
        isAdult: z.boolean().nullish(),
        genres: z.array(z.string().nullish()).nullish(),
        description: z.string().nullish(),
        coverImage: z
          .object({ extraLarge: z.string().nullish(), large: z.string().nullish(), color: z.string().nullish() })
          .nullish(),
        title: z
          .object({ userPreferred: z.string().nullish(), romaji: z.string().nullish(), english: z.string().nullish() })
          .nullish(),
        relations: z.object({ edges: z.array(z.object({ relationType: z.string().nullish() }).nullish()).nullish() }).nullish(),
      }),
    ),
  }),
});

export interface BoosterPageQuery {
  page: number;
  sort: "POPULARITY_DESC" | "SCORE_DESC";
  isAdult: boolean;
  minScore: number;
  minPopularity?: number;
  maxPopularity?: number;
}

/** A sequel or spin-off makes a poor discovery: only keep entry points into a franchise. */
const FOLLOW_UP_RELATIONS = new Set(["PREQUEL", "PARENT"]);

/** One page of booster candidates (first seasons with a MAL id, so both lists can be written). */
export async function fetchBoosterPage(q: BoosterPageQuery): Promise<PoolItem[]> {
  const data = await gql(
    `query ($page: Int, $sort: [MediaSort], $adult: Boolean, $score: Int, $popMin: Int, $popMax: Int) {
      Page(page: $page, perPage: 50) {
        media(type: ANIME, sort: $sort, isAdult: $adult, averageScore_greater: $score,
          popularity_greater: $popMin, popularity_lesser: $popMax,
          format_in: [TV, TV_SHORT, MOVIE, ONA], status_in: [FINISHED, RELEASING]) {
          id idMal episodes format seasonYear averageScore popularity isAdult genres
          description(asHtml: false)
          coverImage { extraLarge large color }
          title { userPreferred romaji english }
          relations { edges { relationType } }
        }
      }
    }`,
    {
      page: q.page,
      sort: [q.sort],
      adult: q.isAdult,
      score: q.minScore,
      popMin: q.minPopularity ?? null,
      popMax: q.maxPopularity ?? null,
    },
    boosterSchema,
    { label: "query Page(booster)", auth: "none" },
  );
  const items: PoolItem[] = [];
  for (const m of data.Page.media) {
    const cover = m.coverImage?.extraLarge ?? m.coverImage?.large;
    if (m.idMal == null || !cover) continue;
    if (m.relations?.edges?.some((e) => e?.relationType && FOLLOW_UP_RELATIONS.has(e.relationType))) continue;
    items.push({
      anilistId: m.id,
      malId: m.idMal,
      title: m.title?.userPreferred ?? m.title?.romaji ?? m.title?.english ?? "Sans titre",
      englishTitle: m.title?.english ?? null,
      cover,
      color: m.coverImage?.color ?? null,
      year: m.seasonYear ?? null,
      format: m.format ?? null,
      episodes: normalizeTotal(m.episodes),
      genres: (m.genres ?? []).filter((g): g is string => Boolean(g)),
      score: m.averageScore ?? null,
      popularity: m.popularity ?? 0,
      synopsis: cleanSynopsis(m.description),
      isAdult: m.isAdult ?? false,
    });
  }
  return items;
}
