/**
 * Pure helpers of the Simkl client (no server-only import, no network): PKCE, URL building,
 * response parsing and the POST spacing queue. Unit-tested in tests/simkl-server.test.ts.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { fromSimklStatus, SIMKL_STATUSES, type CanonicalStatus, type SimklStatus } from "./mapping";
import { simklPosterUrl } from "./simkl-parse";

export const SIMKL_API_BASE = "https://api.simkl.com";
export const SIMKL_AUTHORIZE_URL = "https://simkl.com/oauth2/authorize";
export const SIMKL_SCOPE = "media:read media:write";
export const SIMKL_APP_NAME = "anisync";
/** Simkl allows 1 POST per second: keep a safety margin between two POSTs. */
export const SIMKL_POST_GAP_MS = 1100;

// ---------------------------------------------------------------------------
// PKCE and URLs
// ---------------------------------------------------------------------------

/** RFC 7636 S256: base64url(sha256(verifier)), no padding. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function simklAppVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
}

export function simklUserAgent(version = simklAppVersion()): string {
  return `${SIMKL_APP_NAME}/${version}`;
}

export function simklAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: SIMKL_SCOPE,
    state: input.state,
    code_challenge: pkceChallenge(input.verifier),
    code_challenge_method: "S256",
  });
  return `${SIMKL_AUTHORIZE_URL}?${params.toString()}`;
}

/** API URL carrying the identification parameters Simkl requires on every request. */
export function buildSimklUrl(
  path: string,
  clientId: string,
  query: Record<string, string> = {},
  version = simklAppVersion(),
): string {
  const params = new URLSearchParams(query);
  params.set("client_id", clientId);
  params.set("app-name", SIMKL_APP_NAME);
  params.set("app-version", version);
  return `${SIMKL_API_BASE}${path}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
});

export const errorBodySchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
  message: z.string().optional(),
});

/** Best human-readable detail of a Simkl error body, "" when there is none. */
export function errorDetail(json: unknown): string {
  const parsed = errorBodySchema.safeParse(json);
  if (!parsed.success) return "";
  const { error, error_description, message } = parsed.data;
  return [error, error_description ?? message].filter(Boolean).join(": ");
}

const userSettingsSchema = z.object({
  user: z.object({ name: z.string().nullish(), avatar: z.string().nullish() }),
  account: z.object({ id: z.union([z.number(), z.string()]) }),
});

export interface SimklUser {
  id: string;
  name: string;
  avatar: string | null;
}

export function parseSimklUser(json: unknown): SimklUser | null {
  const parsed = userSettingsSchema.safeParse(json);
  if (!parsed.success) return null;
  const id = String(parsed.data.account.id);
  return { id, name: parsed.data.user.name || `Simkl ${id}`, avatar: parsed.data.user.avatar || null };
}

const searchItemSchema = z.object({
  title: z.string().nullish(),
  year: z.number().nullish(),
  poster: z.string().nullish(),
  ep_count: z.number().nullish(),
  ids: z.object({ simkl_id: z.number().optional(), simkl: z.number().optional() }),
});

export interface SimklSearchHit {
  simklId: number;
  title: string;
  year: number | null;
  cover: string | null;
  totalEpisodes: number | null;
}

/** Parses `GET /search/{tv|movie}`; malformed items are skipped. */
export function parseSimklSearch(json: unknown, kind: "show" | "movie"): SimklSearchHit[] {
  if (!Array.isArray(json)) return [];
  const hits: SimklSearchHit[] = [];
  for (const row of json as unknown[]) {
    const parsed = searchItemSchema.safeParse(row);
    if (!parsed.success) continue;
    const simklId = parsed.data.ids.simkl_id ?? parsed.data.ids.simkl;
    if (!simklId || !parsed.data.title) continue;
    const episodes = parsed.data.ep_count && parsed.data.ep_count > 0 ? parsed.data.ep_count : null;
    hits.push({
      simklId,
      title: parsed.data.title,
      year: parsed.data.year ?? null,
      cover: simklPosterUrl(parsed.data.poster),
      totalEpisodes: kind === "movie" ? 1 : episodes,
    });
  }
  return hits;
}

const NUMERIC_STATUSES: Record<number, SimklStatus> = {
  1: "watching",
  2: "plantowatch",
  3: "completed",
  4: "dropped",
  5: "hold",
};

const writeResponseSchema = z.object({
  added: z
    .object({
      statuses: z
        .array(z.object({ response: z.object({ status: z.union([z.string(), z.number()]).nullish() }).nullish() }))
        .nullish(),
    })
    .nullish(),
  not_found: z.record(z.string(), z.unknown()).nullish(),
});

/** The watchlist status Simkl resolved for a write (the last one reported), when present. */
export function parseResolvedStatus(json: unknown): CanonicalStatus | null {
  const parsed = writeResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const statuses = parsed.data.added?.statuses ?? [];
  for (let i = statuses.length - 1; i >= 0; i--) {
    const raw = statuses[i]?.response?.status;
    if (raw === null || raw === undefined) continue;
    const status = typeof raw === "number" ? NUMERIC_STATUSES[raw] : SIMKL_STATUSES.find((s) => s === raw);
    if (status) return fromSimklStatus(status);
  }
  return null;
}

/** True when Simkl reports items it could not match (`not_found` with a non-empty list). */
export function hasNotFound(json: unknown): boolean {
  const parsed = writeResponseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.not_found) return false;
  return Object.values(parsed.data.not_found).some((v) => Array.isArray(v) && v.length > 0);
}

/**
 * Applies the status Simkl resolved on top of the expected state. rewatching and watching are the
 * same thing on Simkl, so a "watching" answer never downgrades a requested "rewatching".
 */
export function withResolvedStatus<T extends { status: CanonicalStatus }>(
  expected: T,
  resolved: CanonicalStatus | null,
): T {
  if (!resolved) return expected;
  const same = resolved === expected.status || (resolved === "watching" && expected.status === "rewatching");
  return same ? expected : { ...expected, status: resolved };
}

// ---------------------------------------------------------------------------
// POST queue
// ---------------------------------------------------------------------------

export interface PostQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export interface PostQueueState {
  chain: Promise<unknown>;
  /** timestamp (ms) at which the previous POST finished */
  lastDoneAt: number;
}

/**
 * Serializes tasks and guarantees `gapMs` between the end of one task and the start of the next.
 * The state is passed in so it can live on globalThis (shared across Next.js module instances).
 */
export function createPostQueue(
  state: PostQueueState,
  options: { gapMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): PostQueue {
  const gapMs = options.gapMs ?? SIMKL_POST_GAP_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = state.chain.then(async () => {
        const wait = state.lastDoneAt + gapMs - now();
        if (wait > 0) await sleep(wait);
        try {
          return await task();
        } finally {
          state.lastDoneAt = now();
        }
      });
      // A failed task must not break the chain for the next ones.
      state.chain = result.catch(() => undefined);
      return result;
    },
  };
}
