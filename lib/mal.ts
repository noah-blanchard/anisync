import "server-only";
import { z } from "zod";
import { getConnection, readAccessToken, readRefreshToken, updateTokens } from "./connections";
import { getEnv, redirectUris } from "./env";
import { notConnected, ServiceError } from "./errors";
import { fetchWithRetry, readJson } from "./http";
import {
  clampScore,
  fromMalStatus,
  MAL_STATUSES,
  normalizeTotal,
  toMalStatus,
  type EntryPatch,
  type EntryState,
} from "./mapping";
import type { MalListItem } from "./merge";

const OAUTH_BASE = "https://myanimelist.net/v1/oauth2";
const API_BASE = "https://api.myanimelist.net/v2";
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
const LIST_FIELDS = "list_status,num_episodes,main_picture,alternative_titles,media_type,status";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const errorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  hint: z.string().optional(),
});

const listStatusSchema = z.object({
  status: z.enum(MAL_STATUSES).catch("plan_to_watch"),
  score: z.number().catch(0),
  num_episodes_watched: z.number().catch(0),
  is_rewatching: z.boolean().catch(false),
  updated_at: z.string().optional(),
});

const nodeSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  main_picture: z.object({ medium: z.string().optional(), large: z.string().optional() }).nullish(),
  alternative_titles: z.object({ en: z.string().nullish() }).nullish(),
  num_episodes: z.number().nullish(),
  media_type: z.string().nullish(),
});

const listPageSchema = z.object({
  data: z.array(z.object({ node: nodeSchema, list_status: listStatusSchema })),
  paging: z.object({ next: z.string().optional() }).nullish(),
});

const userSchema = z.object({ id: z.number(), name: z.string(), picture: z.string().nullish() });

// ---------------------------------------------------------------------------
// OAuth (PKCE "plain": MAL does not support S256)
// ---------------------------------------------------------------------------

export function malAuthorizeUrl(state: string, verifier: string): string {
  const env = getEnv();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.MAL_CLIENT_ID,
    code_challenge: verifier,
    code_challenge_method: "plain",
    state,
    redirect_uri: redirectUris(env).mal,
  });
  return `${OAUTH_BASE}/authorize?${params.toString()}`;
}

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function tokenRequest(body: Record<string, string>, label: string): Promise<TokenSet> {
  const env = getEnv();
  const form = new URLSearchParams({ client_id: env.MAL_CLIENT_ID, ...body });
  if (env.MAL_CLIENT_SECRET) form.set("client_secret", env.MAL_CLIENT_SECRET);
  const res = await fetchWithRetry("mal", `${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
    label,
  });
  const json = await readJson(res);
  if (!res.ok) {
    const err = errorSchema.safeParse(json);
    const detail = err.success ? [err.data.error, err.data.message ?? err.data.hint].filter(Boolean).join(": ") : "";
    throw new ServiceError("mal", res.status, detail || `Échec de l'échange de jeton (${res.status})`);
  }
  const parsed = tokenSchema.safeParse(json);
  if (!parsed.success) throw new ServiceError("mal", 502, "Réponse de jeton MAL invalide");
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  };
}

export function exchangeMalCode(code: string, verifier: string): Promise<TokenSet> {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUris().mal,
    },
    "POST /oauth2/token (code)",
  );
}

let refreshInFlight: Promise<string> | null = null;

/** Refreshes the stored token (deduplicated across concurrent callers). */
function refreshStoredToken(): Promise<string> {
  refreshInFlight ??= (async () => {
    try {
      const row = getConnection("mal");
      if (!row) throw notConnected("mal");
      const refreshToken = readRefreshToken(row);
      if (!refreshToken) throw new ServiceError("mal", 401, "Aucun refresh token MAL", "unauthorized");
      const tokens = await tokenRequest(
        { grant_type: "refresh_token", refresh_token: refreshToken },
        "POST /oauth2/token (refresh)",
      );
      updateTokens("mal", tokens);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof ServiceError && (error.status === 400 || error.status === 401)) {
        throw new ServiceError("mal", 401, "Connexion MAL expirée, reconnecte le service", "unauthorized");
      }
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function validAccessToken(): Promise<string> {
  const row = getConnection("mal");
  if (!row) throw notConnected("mal");
  if (row.expiresAt - Date.now() < REFRESH_MARGIN_MS) return refreshStoredToken();
  return readAccessToken(row);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function malRequest(url: string, init: RequestInit & { label: string }): Promise<unknown> {
  const send = (token: string) =>
    fetchWithRetry("mal", url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });

  let res = await send(await validAccessToken());
  if (res.status === 401) {
    await res.body?.cancel();
    res = await send(await refreshStoredToken());
  }
  const json = await readJson(res);
  if (!res.ok) {
    const err = errorSchema.safeParse(json);
    const message = err.success ? (err.data.message ?? err.data.error) : undefined;
    throw new ServiceError("mal", res.status, message || `Erreur MAL ${res.status}`);
  }
  return json;
}

export async function fetchMalUser(accessToken: string): Promise<z.infer<typeof userSchema>> {
  const res = await fetchWithRetry("mal", `${API_BASE}/users/@me?fields=picture`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    label: "GET /users/@me",
  });
  const json = await readJson(res);
  if (!res.ok) throw new ServiceError("mal", res.status, "Impossible de lire le profil MAL");
  const parsed = userSchema.safeParse(json);
  if (!parsed.success) throw new ServiceError("mal", 502, "Profil MAL invalide");
  return parsed.data;
}

function toState(status: z.infer<typeof listStatusSchema>): EntryState {
  const updatedAt = status.updated_at ? Date.parse(status.updated_at) : Number.NaN;
  return {
    status: fromMalStatus(status.status, status.is_rewatching),
    progress: Math.max(0, status.num_episodes_watched),
    score: clampScore(status.score),
    updatedAt: Number.isNaN(updatedAt) ? null : updatedAt,
    entryId: null,
  };
}

export async function fetchMalList(): Promise<MalListItem[]> {
  const items: MalListItem[] = [];
  let url: string | undefined =
    `${API_BASE}/users/@me/animelist?fields=${LIST_FIELDS}&limit=1000&nsfw=true`;
  for (let page = 0; url && page < 50; page++) {
    const json = await malRequest(url, { label: "GET /users/@me/animelist" });
    const parsed = listPageSchema.safeParse(json);
    if (!parsed.success) throw new ServiceError("mal", 502, "Liste MAL invalide");
    for (const { node, list_status } of parsed.data.data) {
      items.push({
        malId: node.id,
        title: node.title,
        englishTitle: node.alternative_titles?.en || null,
        cover: node.main_picture?.large ?? node.main_picture?.medium ?? null,
        totalEpisodes: normalizeTotal(node.num_episodes),
        mediaType: node.media_type ?? null,
        state: toState(list_status),
      });
    }
    const next = parsed.data.paging?.next;
    url = next && next.startsWith(API_BASE) ? next : undefined;
  }
  return items;
}

/** PATCH only the given fields. Creates the entry if it does not exist yet. */
export async function updateMalEntry(malId: number, patch: EntryPatch): Promise<EntryState> {
  const body = new URLSearchParams();
  if (patch.status !== undefined) {
    const mapped = toMalStatus(patch.status);
    body.set("status", mapped.status);
    body.set("is_rewatching", String(mapped.is_rewatching));
  }
  if (patch.progress !== undefined) body.set("num_watched_episodes", String(patch.progress));
  if (patch.score !== undefined) body.set("score", String(clampScore(patch.score)));

  const json = await malRequest(`${API_BASE}/anime/${malId}/my_list_status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    label: "PATCH /anime/:id/my_list_status",
  });
  const parsed = listStatusSchema.safeParse(json);
  if (!parsed.success) throw new ServiceError("mal", 502, "Réponse MAL invalide");
  return toState(parsed.data);
}

export async function deleteMalEntry(malId: number): Promise<void> {
  try {
    await malRequest(`${API_BASE}/anime/${malId}/my_list_status`, {
      method: "DELETE",
      label: "DELETE /anime/:id/my_list_status",
    });
  } catch (error) {
    // Already absent from the list: nothing to do.
    if (error instanceof ServiceError && error.status === 404) return;
    throw error;
  }
}
