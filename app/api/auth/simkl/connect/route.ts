import { randomUnreserved } from "@/lib/crypto";
import { isSimklEnabled } from "@/lib/env";
import { settingsRedirect, startOAuth } from "@/lib/oauth-routes";
import { simklAuthUrl } from "@/lib/simkl";

export const dynamic = "force-dynamic";

export function GET() {
  if (!isSimklEnabled()) {
    return settingsRedirect({
      error: "simkl",
      reason: "Simkl n'est pas configuré (SIMKL_CLIENT_ID manquant)",
    });
  }
  const state = randomUnreserved(32);
  // PKCE S256 is mandatory on Simkl: the cookie keeps the verifier, only its hash goes to the browser.
  const verifier = randomUnreserved(64);
  return startOAuth("simkl", { state, verifier, createdAt: Date.now() }, simklAuthUrl(state, verifier));
}
