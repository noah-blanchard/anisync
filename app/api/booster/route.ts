import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { getBoosterCards } from "@/lib/booster-source";
import { DEFAULT_BOOSTER, getBooster } from "@/lib/boosters";
import { userMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  const params = req.nextUrl.searchParams;
  const booster = getBooster(params.get("pack") ?? DEFAULT_BOOSTER);
  if (!booster) return jsonError(404, "Booster inconnu");
  if (booster.adult && params.get("adult") !== "1") {
    return jsonError(403, "Active le contenu adulte dans les paramètres pour ouvrir ce booster");
  }
  try {
    const cards = await getBoosterCards({ booster });
    if (cards.length === 0) {
      return jsonError(404, "Plus aucun anime à découvrir dans ce booster pour l'instant, reviens demain !");
    }
    return NextResponse.json({ cards }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(502, userMessage(error));
  }
}
