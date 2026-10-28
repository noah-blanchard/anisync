import type { NextRequest } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { saveConnection } from "@/lib/connections";
import { userMessage } from "@/lib/errors";
import { exchangeMalCode, fetchMalUser } from "@/lib/mal";
import { consumeOAuthState, settingsRedirect } from "@/lib/oauth-routes";
import { invalidateList } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  const params = req.nextUrl.searchParams;
  const saved = await consumeOAuthState("mal");

  const providerError = params.get("error");
  if (providerError) return settingsRedirect({ error: "mal", reason: params.get("message") ?? providerError });

  const code = params.get("code");
  if (!code || !saved?.verifier || saved.state !== params.get("state")) {
    return settingsRedirect({ error: "mal", reason: "État OAuth invalide ou expiré, recommence la connexion" });
  }

  try {
    const tokens = await exchangeMalCode(code, saved.verifier);
    const user = await fetchMalUser(tokens.accessToken);
    saveConnection({
      service: "mal",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      userId: String(user.id),
      username: user.name,
      avatarUrl: user.picture ?? null,
    });
    invalidateList();
    return settingsRedirect({ connected: "mal" });
  } catch (error) {
    return settingsRedirect({ error: "mal", reason: error instanceof Error ? error.message : userMessage(error) });
  }
}
