import { isAuthenticated, unauthorized } from "@/lib/auth";
import { disconnect } from "@/lib/oauth-routes";
import { invalidateSimklCache, revokeSimkl } from "@/lib/simkl";

export const dynamic = "force-dynamic";

export async function DELETE() {
  if (!(await isAuthenticated())) return unauthorized();
  // Best effort: the connection is removed even when Simkl cannot be reached.
  await revokeSimkl();
  invalidateSimklCache();
  return disconnect("simkl");
}
