import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "./auth";
import { deleteConnection } from "./connections";
import { getEnv, isSecureUrl } from "./env";
import type { ServiceName } from "./mapping";
import { OAUTH_COOKIE_MAX_AGE, oauthCookieName, openOAuthState, sealOAuthState, type OAuthState } from "./oauth-state";
import { invalidateList } from "./sync";

export function settingsRedirect(params: Record<string, string>): NextResponse {
  const url = new URL("/settings", getEnv().APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** Redirects to the provider and stores the state (and verifier) in an encrypted cookie. */
export async function startOAuth(service: ServiceName, state: OAuthState, authorizeUrl: string) {
  if (!(await isAuthenticated())) return unauthorized();
  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(oauthCookieName(service), sealOAuthState(state), {
    httpOnly: true,
    secure: isSecureUrl(),
    sameSite: "lax",
    path: `/api/auth/${service}`,
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return res;
}

/** Reads and clears the OAuth cookie. */
export async function consumeOAuthState(service: ServiceName): Promise<OAuthState | null> {
  const store = await cookies();
  const name = oauthCookieName(service);
  const value = openOAuthState(store.get(name)?.value);
  store.set(name, "", { path: `/api/auth/${service}`, maxAge: 0 });
  return value;
}

export async function disconnect(service: ServiceName) {
  if (!(await isAuthenticated())) return unauthorized();
  deleteConnection(service);
  invalidateList();
  return NextResponse.json({ ok: true });
}
