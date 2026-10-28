import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { userMessage } from "@/lib/errors";
import { getMergedList } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  try {
    const payload = await getMergedList({ force: req.nextUrl.searchParams.get("refresh") === "1" });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(500, userMessage(error));
  }
}
