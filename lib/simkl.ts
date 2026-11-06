import "server-only";
import { getConnection, readAccessToken, readRefreshToken, updateTokens } from "./connections";
import { getEnv, redirectUris } from "./env";
import { notConnected, ServiceError } from "./errors";
import { fetchWithRetry, readJson, type RequestOptions } from "./http";
import { applyPatch, type EntryPatch, type EntryState } from "./mapping";
import type { SimklListItem } from "./merge";
import { parseSimklActivitiesAll, parseSimklAllItems } from "./simkl-parse";
import { planSimklRemove, planSimklWrite, SimklPlanError, type SimklCall, type SimklWriteTarget } from "./simkl-payloads";
import {
  buildSimklUrl,
  createPostQueue,
  errorDetail,
  hasNotFound,
  parseResolvedStatus,
  parseSimklSearch,
  parseSimklUser,
  SIMKL_API_BASE,
  simklAuthorizeUrl,
  simklUserAgent,
  tokenResponseSchema,
  withResolvedStatus,
  type PostQueueState,
  type SimklSearchHit,
  type SimklUser,
} from "./simkl-core";

export type { SimklSearchHit, SimklUser };

const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shared state (kept on globalThis like the merged list cache in lib/sync.ts)
// ---------------------------------------------------------------------------

interface SimklCache {
  /** `all` timestamp of GET /sync/activities when the items were fetched */
  activitiesAll: string | null;
  items: SimklListItem[];
}

const globalForSimkl = globalThis as unknown as {
  __anisyncSimklPostQueue?: PostQueueState;
  __anisyncSimklCache?: SimklCache;
  __anisyncSimklListInFlight?: Promise<SimklListItem[]> | null;
};

const postQueue = createPostQueue(
  (globalForSimkl.__anisyncSimklPostQueue ??= { chain: Promise.resolve(), lastDoneAt: 0 }),
);

/** Forces the next fetchSimklList() to read the library again. */
export function invalidateSimklCache(): void {
  globalForSimkl.__anisyncSimklCache = undefined;
}

function clientId(): string {
  const id = getEnv().SIMKL_CLIENT_ID;
  if (!id) throw new ServiceError("simkl", 400, "Simkl n'est pas configuré", "not_connected");
  return id;
}

// ---------------------------------------------------------------------------
// OAuth V2 (PKCE S256)
// ---------------------------------------------------------------------------

export function simklAuthUrl(state: string, verifier: string): string {
  return simklAuthorizeUrl({ clientId: clientId(), redirectUri: redirectUris().simkl, state, verifier });
}

interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

function oauthForm(body: Record<string, string>): string {
  const env = getEnv();
  const form = new URLSearchParams({ client_id: clientId(), ...body });
  if (env.SIMKL_CLIENT_SECRET) form.set("client_secret", env.SIMKL_CLIENT_SECRET);
  return form.toString();
}

async function oauthPost(path: string, body: Record<string, string>, label: string): Promise<{ res: Response; json: unknown }> {
  const res = await fetchWithRetry("simkl", `${SIMKL_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": simklUserAgent(),
    },
    body: oauthForm(body),
    label,
  });
  return { res, json: await readJson(res) };
}

async function tokenRequest(body: Record<string, string>, label: string): Promise<TokenSet> {
  const { res, json } = await oauthPost("/oauth2/token", body, label);
  if (!res.ok) {
    throw new ServiceError("simkl", res.status, errorDetail(json) || `Échec de l'échange de jeton (${res.status})`);
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) throw new ServiceError("simkl", 502, "Réponse de jeton Simkl invalide");
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  };
}

export function exchangeSimklCode(code: string, verifier: string): Promise<TokenSet> {
  return tokenRequest(
    { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUris().simkl },
    "POST /oauth2/token (code)",
  );
}

let refreshInFlight: Promise<string> | null = null;

/** Refreshes the stored token (deduplicated across concurrent callers). */
function refreshStoredToken(): Promise<string> {
  refreshInFlight ??= (async () => {
    try {
      const row = getConnection("simkl");
      if (!row) throw notConnected("simkl");
      const refreshToken = readRefreshToken(row);
      if (!refreshToken) throw new ServiceError("simkl", 401, "Aucun refresh token Simkl", "unauthorized");
      const tokens = await tokenRequest(
        { grant_type: "refresh_token", refresh_token: refreshToken },
        "POST /oauth2/token (refresh)",
      );
      // The refresh token is not rotated, but store whatever comes back.
      updateTokens("simkl", { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken });
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof ServiceError && (error.status === 400 || error.status === 401)) {
        throw new ServiceError("simkl", 401, "Connexion Simkl expirée, reconnecte le service", "unauthorized");
      }
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function validAccessToken(): Promise<string> {
  const row = getConnection("simkl");
  if (!row) throw notConnected("simkl");
  if (row.expiresAt - Date.now() < REFRESH_MARGIN_MS) return refreshStoredToken();
  return readAccessToken(row);
}

/** Invalidates the grant on Simkl (best effort: never throws). */
export async function revokeSimkl(): Promise<void> {
  try {
    const row = getConnection("simkl");
    if (!row) return;
    const { res } = await oauthPost("/oauth2/revoke", { token: readAccessToken(row) }, "POST /oauth2/revoke");
    await res.body?.cancel();
  } catch (error) {
    console.warn(`[anisync] simkl revoke skipped: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

interface SimklRequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string>;
  /** JSON body (POST) */
  body?: unknown;
  label: string;
}

function send(token: string, path: string, options: SimklRequestOptions): Promise<Response> {
  const init: RequestOptions = {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": simklUserAgent(),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    label: options.label,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  };
  return fetchWithRetry("simkl", buildSimklUrl(path, clientId(), options.query), init);
}

async function authorizedRequest(path: string, options: SimklRequestOptions): Promise<unknown> {
  let res = await send(await validAccessToken(), path, options);
  if (res.status === 401) {
    await res.body?.cancel();
    res = await send(await refreshStoredToken(), path, options);
  }
  const json = await readJson(res);
  if (!res.ok) {
    throw new ServiceError("simkl", res.status, errorDetail(json) || `Erreur Simkl ${res.status}`);
  }
  return json;
}

/**
 * Authenticated Simkl call: always carries client_id / app-name / app-version and the User-Agent,
 * refreshes the token on a 401, and sends POSTs one at a time (>= 1100 ms apart).
 */
export function simklRequest(path: string, options: SimklRequestOptions): Promise<unknown> {
  if (options.method === "POST") return postQueue.run(() => authorizedRequest(path, options));
  return authorizedRequest(path, options);
}

export async function fetchSimklUser(accessToken: string): Promise<SimklUser> {
  const res = await send(accessToken, "/users/settings", { label: "GET /users/settings" });
  const json = await readJson(res);
  if (!res.ok) throw new ServiceError("simkl", res.status, "Impossible de lire le profil Simkl");
  const user = parseSimklUser(json);
  if (!user) throw new ServiceError("simkl", 502, "Profil Simkl invalide");
  return user;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

async function loadSimklList(): Promise<SimklListItem[]> {
  const activities = await simklRequest("/sync/activities", { label: "GET /sync/activities" });
  let all: string | null;
  try {
    all = parseSimklActivitiesAll(activities);
  } catch {
    throw new ServiceError("simkl", 502, "Activités Simkl invalides");
  }
  const cached = globalForSimkl.__anisyncSimklCache;
  if (cached && cached.activitiesAll === all) return cached.items;

  const json = await simklRequest("/sync/all-items", {
    query: { next_watch_info: "yes" },
    label: "GET /sync/all-items",
  });
  let items: SimklListItem[];
  try {
    items = parseSimklAllItems(json);
  } catch {
    throw new ServiceError("simkl", 502, "Liste Simkl invalide");
  }
  globalForSimkl.__anisyncSimklCache = { activitiesAll: all, items };
  return items;
}

/** The whole Simkl library; the full list is only re-read when /sync/activities moved. */
export function fetchSimklList(): Promise<SimklListItem[]> {
  globalForSimkl.__anisyncSimklListInFlight ??= loadSimklList().finally(() => {
    globalForSimkl.__anisyncSimklListInFlight = null;
  });
  return globalForSimkl.__anisyncSimklListInFlight;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function runCalls(calls: SimklCall[]): Promise<ReturnType<typeof parseResolvedStatus>> {
  let resolved: ReturnType<typeof parseResolvedStatus> = null;
  try {
    for (const call of calls) {
      const json = await simklRequest(call.endpoint, {
        method: "POST",
        body: call.body,
        label: `POST ${call.endpoint}`,
      });
      if (!call.endpoint.endsWith("/remove") && hasNotFound(json)) {
        throw new ServiceError("simkl", 404, "Titre introuvable sur Simkl");
      }
      if (call.endpoint === "/sync/history") resolved = parseResolvedStatus(json) ?? resolved;
    }
  } finally {
    if (calls.length > 0) invalidateSimklCache();
  }
  return resolved;
}

/**
 * Applies a patch on Simkl. The calls run one by one through the POST queue; the returned state
 * is what the entry should look like, with the status Simkl resolved when it reports one.
 */
export async function saveSimklEntry(
  target: SimklWriteTarget,
  current: EntryState | null,
  patch: EntryPatch,
  total: number | null,
): Promise<EntryState> {
  let plan: ReturnType<typeof planSimklWrite>;
  try {
    plan = planSimklWrite(target, current, patch, total);
  } catch (error) {
    if (error instanceof SimklPlanError) throw new ServiceError("simkl", 400, error.message);
    throw error;
  }
  if (plan.calls.length === 0) return current ? applyPatch(current, patch, total) : plan.expected;
  const resolved = await runCalls(plan.calls);
  return withResolvedStatus(plan.expected, resolved);
}

/** Removes the title (and its history) from the Simkl library. */
export async function removeSimklEntry(target: SimklWriteTarget): Promise<void> {
  let calls: SimklCall[];
  try {
    calls = planSimklRemove(target);
  } catch (error) {
    if (error instanceof SimklPlanError) throw new ServiceError("simkl", 400, error.message);
    throw error;
  }
  await runCalls(calls);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Text search in the Simkl catalog (AUTH V2 requires the user token, even for search). */
export async function searchSimkl(q: string, kind: "show" | "movie"): Promise<SimklSearchHit[]> {
  const json = await simklRequest(kind === "movie" ? "/search/movie" : "/search/tv", {
    query: { q, limit: "20", extended: "full" },
    label: `GET /search/${kind === "movie" ? "movie" : "tv"}`,
  });
  return parseSimklSearch(json, kind);
}
