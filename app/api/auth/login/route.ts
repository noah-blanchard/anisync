import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseBody } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";
import { getEnv, isSecureUrl } from "@/lib/env";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter(5, 60_000);
const bodySchema = z.object({ password: z.string().min(1).max(1024) });

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const limit = limiter.check(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives, réessaie dans ${limit.retryAfter} s` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const env = getEnv();
  if (!safeEqual(body.data.password, env.APP_PASSWORD)) {
    return jsonError(401, "Mot de passe incorrect");
  }
  limiter.reset(ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(env.APP_SECRET), sessionCookieOptions(isSecureUrl(env)));
  return res;
}
