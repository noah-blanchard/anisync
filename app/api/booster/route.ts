import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { getBoosterCards } from "@/lib/booster-source";
import { userMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  try {
    const cards = await getBoosterCards({ adult: req.nextUrl.searchParams.get("adult") === "1" });
    if (cards.length === 0) return jsonError(404, "Plus aucun anime à découvrir pour l'instant, reviens demain !");
    return NextResponse.json({ cards }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(502, userMessage(error));
  }
}
