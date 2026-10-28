import { NextResponse, type NextRequest } from "next/server";
import { searchUsers } from "@/lib/anilist";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { userMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** AniList profiles matching ?q= (2 characters at least). */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorized();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 50);
  if (q.length < 2) return NextResponse.json({ users: [] });
  try {
    const users = await searchUsers(q);
    return NextResponse.json(
      { users: users.map((u) => ({ id: u.id, name: u.name, avatar: u.avatar?.medium ?? null })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(502, userMessage(error));
  }
}
