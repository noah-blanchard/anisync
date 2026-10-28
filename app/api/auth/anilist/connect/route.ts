import { anilistAuthorizeUrl } from "@/lib/anilist";
import { randomUnreserved } from "@/lib/crypto";
import { startOAuth } from "@/lib/oauth-routes";

export const dynamic = "force-dynamic";

export function GET() {
  const state = randomUnreserved(32);
  return startOAuth("anilist", { state, createdAt: Date.now() }, anilistAuthorizeUrl(state));
}
