import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated, jsonError, unauthorized } from "@/lib/auth";
import { userMessage } from "@/lib/errors";
import { buildRestorePlan, listSnapshotDays } from "@/lib/restore-source";

export const dynamic = "force-dynamic";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Jour invalide (AAAA-MM-JJ)");
const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/restore -> { days }; GET /api/restore?day=YYYY-MM-DD -> the restore plan. Read-only. */
export async function GET(req: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const raw = new URL(req.url).searchParams.get("day");
  try {
    if (raw === null) return NextResponse.json({ days: listSnapshotDays() }, { headers: NO_STORE });
    const day = daySchema.safeParse(raw);
    if (!day.success) return jsonError(400, day.error.issues[0]?.message ?? "Jour invalide");
    return NextResponse.json(await buildRestorePlan(day.data), { headers: NO_STORE });
  } catch (error) {
    return jsonError(502, userMessage(error));
  }
}
