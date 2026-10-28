import { NextResponse } from "next/server";
import { isSecureUrl } from "@/lib/env";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

export function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(isSecureUrl()), maxAge: 0 });
  return res;
}
