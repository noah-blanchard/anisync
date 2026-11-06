import { NextResponse, type NextRequest } from "next/server";
import { searchKindSchema, searchQuerySchema } from "@/lib/api-schemas";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { ServiceError, userMessage } from "@/lib/errors";
import { search } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  const q = searchQuerySchema.safeParse(req.nextUrl.searchParams.get("q") ?? "");
  if (!q.success) return jsonError(400, q.error.issues[0]?.message ?? "Recherche invalide");
  const kind = searchKindSchema.safeParse(req.nextUrl.searchParams.get("kind") ?? undefined);
  if (!kind.success) return jsonError(400, "Type de recherche invalide");
  try {
    return NextResponse.json({ results: await search(q.data, kind.data) });
  } catch (error) {
    if (error instanceof ServiceError && error.status === 400) return jsonError(400, error.message);
    return jsonError(502, userMessage(error));
  }
}
