import { NextResponse, type NextRequest } from "next/server";
import { searchQuerySchema } from "@/lib/api-schemas";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { userMessage } from "@/lib/errors";
import { search } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  const q = searchQuerySchema.safeParse(req.nextUrl.searchParams.get("q") ?? "");
  if (!q.success) return jsonError(400, q.error.issues[0]?.message ?? "Recherche invalide");
  try {
    return NextResponse.json({ results: await search(q.data) });
  } catch (error) {
    return jsonError(502, userMessage(error));
  }
}
