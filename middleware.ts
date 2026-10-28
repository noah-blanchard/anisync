import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/health",
  "/api/auth/login",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/sw.js",
  "/offline.html",
]);
const PUBLIC_PREFIXES = ["/icons/", "/_next/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const authenticated = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, process.env.APP_SECRET);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  // Build from APP_URL: behind a reverse proxy req.url may carry the internal host.
  const url = new URL("/login", process.env.APP_URL || req.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|icons/|favicon.ico|manifest.webmanifest|sw.js|offline.html|robots.txt).*)"],
};
