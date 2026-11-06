import type { NextRequest } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { saveConnection } from "@/lib/connections";
import { userMessage } from "@/lib/errors";
import { consumeOAuthState, settingsRedirect } from "@/lib/oauth-routes";
import { exchangeSimklCode, fetchSimklUser, invalidateSimklCache } from "@/lib/simkl";
import { invalidateList } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  const params = req.nextUrl.searchParams;
  const saved = await consumeOAuthState("simkl");

  const providerError = params.get("error");
  if (providerError) {
    return settingsRedirect({ error: "simkl", reason: params.get("error_description") ?? providerError });
  }

  const code = params.get("code");
  if (!code || !saved?.verifier || saved.state !== params.get("state")) {
    return settingsRedirect({ error: "simkl", reason: "État OAuth invalide ou expiré, recommence la connexion" });
  }

  try {
    const tokens = await exchangeSimklCode(code, saved.verifier);
    const user = await fetchSimklUser(tokens.accessToken);
    saveConnection({
      service: "simkl",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      userId: user.id,
      username: user.name,
      avatarUrl: user.avatar,
    });
    invalidateSimklCache();
    invalidateList();
    return settingsRedirect({ connected: "simkl" });
  } catch (error) {
    return settingsRedirect({ error: "simkl", reason: error instanceof Error ? error.message : userMessage(error) });
  }
}
