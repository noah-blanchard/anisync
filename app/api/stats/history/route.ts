import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { userMessage } from "@/lib/errors";
import { loadHistory } from "@/lib/stats/history-source";

export const dynamic = "force-dynamic";

const NAME = /^[A-Za-z0-9_-]{1,30}$/;

/** History of my list, or of a public AniList profile with ?user=. */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  const user = req.nextUrl.searchParams.get("user") ?? undefined;
  if (user !== undefined && !NAME.test(user)) return jsonError(400, "Nom de profil invalide");
  try {
    return NextResponse.json(loadHistory(user), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(500, userMessage(error));
  }
}
