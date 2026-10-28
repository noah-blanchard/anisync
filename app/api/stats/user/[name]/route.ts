import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { ServiceError, userMessage } from "@/lib/errors";
import { getUserStats } from "@/lib/stats/service";

export const dynamic = "force-dynamic";

/** AniList user names: letters, digits, "_" and "-". */
const NAME = /^[A-Za-z0-9_-]{1,30}$/;

/** The stats of a public AniList profile. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  if (!(await isAuthenticated())) return unauthorized();
  const { name } = await params;
  if (!NAME.test(name)) return jsonError(400, "Nom de profil invalide");
  try {
    const payload = await getUserStats(name, { force: req.nextUrl.searchParams.get("refresh") === "1" });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceError && /private/i.test(error.message)) {
      return jsonError(403, "Ce profil AniList est privé : sa liste n'est pas visible.");
    }
    if (error instanceof ServiceError && error.status === 404) return jsonError(404, "Profil AniList introuvable");
    return jsonError(502, userMessage(error));
  }
}
