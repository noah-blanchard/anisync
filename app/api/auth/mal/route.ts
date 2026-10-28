import { disconnect } from "@/lib/oauth-routes";

export const dynamic = "force-dynamic";

export function DELETE() {
  return disconnect("mal");
}
