import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getEnv } from "./env";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/** Defence in depth: every protected route handler re-checks the session (middleware does it first). */
export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value, getEnv().APP_SECRET);
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export const unauthorized = () => jsonError(401, "Non authentifié");

/** Parses a JSON request body with a zod schema. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { ok: false, response: jsonError(400, "Corps JSON invalide") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: jsonError(400, "Requête invalide", { issues: parsed.error.issues.map((i) => i.message) }) };
  }
  return { ok: true, data: parsed.data };
}
