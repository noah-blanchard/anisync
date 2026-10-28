import type { NextRequest } from "next/server";
import { exchangeAniListCode, fetchViewer } from "@/lib/anilist";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { saveConnection } from "@/lib/connections";
import { userMessage } from "@/lib/errors";
import { consumeOAuthState, settingsRedirect } from "@/lib/oauth-routes";
import { invalidateList } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  const params = req.nextUrl.searchParams;
  const saved = await consumeOAuthState("anilist");

  const providerError = params.get("error");
  if (providerError) {
    return settingsRedirect({ error: "anilist", reason: params.get("error_description") ?? providerError });
  }

  const code = params.get("code");
  const returnedState = params.get("state");
  // The cookie proves this browser started the flow; the state must match when AniList echoes it.
  if (!code || !saved || (returnedState !== null && returnedState !== saved.state)) {
    return settingsRedirect({ error: "anilist", reason: "État OAuth invalide ou expiré, recommence la connexion" });
  }

  try {
    const tokens = await exchangeAniListCode(code);
    const viewer = await fetchViewer(tokens.accessToken);
    saveConnection({
      service: "anilist",
      accessToken: tokens.accessToken,
      refreshToken: null,
      expiresAt: tokens.expiresAt,
      userId: String(viewer.id),
      username: viewer.name,
      avatarUrl: viewer.avatarUrl,
      extra: viewer.scoreFormat ? { scoreFormat: viewer.scoreFormat } : {},
    });
    invalidateList();
    return settingsRedirect({ connected: "anilist" });
  } catch (error) {
    return settingsRedirect({ error: "anilist", reason: error instanceof Error ? error.message : userMessage(error) });
  }
}
