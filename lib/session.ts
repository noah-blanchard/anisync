import { jwtVerify, SignJWT } from "jose";

/**
 * Session token helpers. Kept free of Node-only imports so middleware can use them.
 */
export const SESSION_COOKIE = "anisync_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(secret: string): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("anisync")
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key(secret));
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    await jwtVerify(token, key(secret), { algorithms: ["HS256"], issuer: "anisync" });
    return true;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
