import { randomUnreserved } from "@/lib/crypto";
import { malAuthorizeUrl } from "@/lib/mal";
import { startOAuth } from "@/lib/oauth-routes";

export const dynamic = "force-dynamic";

export function GET() {
  const state = randomUnreserved(32);
  // MAL only supports PKCE "plain": the challenge is the verifier itself (43-128 chars).
  const verifier = randomUnreserved(128);
  return startOAuth("mal", { state, verifier, createdAt: Date.now() }, malAuthorizeUrl(state, verifier));
}
