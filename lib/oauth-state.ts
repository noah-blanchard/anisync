import "server-only";
import { z } from "zod";
import { decrypt, encrypt } from "./crypto";
import type { ServiceName } from "./mapping";

export const OAUTH_COOKIE_MAX_AGE = 10 * 60;

export function oauthCookieName(service: ServiceName): string {
  return `anisync_oauth_${service}`;
}

const stateSchema = z.object({ state: z.string(), verifier: z.string().optional(), createdAt: z.number() });
export type OAuthState = z.infer<typeof stateSchema>;

/** The state (and PKCE verifier) is stored encrypted in a short-lived httpOnly cookie. */
export function sealOAuthState(value: OAuthState): string {
  return encrypt(JSON.stringify(value));
}

export function openOAuthState(cookie: string | undefined): OAuthState | null {
  if (!cookie) return null;
  try {
    const parsed = stateSchema.safeParse(JSON.parse(decrypt(cookie)) as unknown);
    if (!parsed.success) return null;
    if (Date.now() - parsed.data.createdAt > OAUTH_COOKIE_MAX_AGE * 1000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
