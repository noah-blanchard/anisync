import { NextResponse } from "next/server";
import { boosterSwipeSchema, boosterUndoSchema } from "@/lib/api-schemas";
import { isAuthenticated, parseBody, unauthorized } from "@/lib/auth";
import { forgetSwipe, recordSwipe } from "@/lib/booster-source";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const body = await parseBody(req, boosterSwipeSchema);
  if (!body.ok) return body.response;
  recordSwipe(body.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const body = await parseBody(req, boosterUndoSchema);
  if (!body.ok) return body.response;
  forgetSwipe(body.data.anilistId);
  return NextResponse.json({ ok: true });
}
