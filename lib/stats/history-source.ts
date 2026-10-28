import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { listSnapshots, userSnapshots } from "../schema";
import { buildHistory, type HistoryPayload } from "./history";
import { normalizeAniListSnapshot, normalizeMalSnapshot } from "./snapshots";

/**
 * The history of a list from its daily bronze snapshots: mine (AniList when I have its snapshots, MAL otherwise)
 * or a public AniList profile's, looked up by name.
 */
export function loadHistory(user?: string): HistoryPayload {
  const db = getDb();
  if (user) {
    const rows = db
      .select({ day: userSnapshots.day, payload: userSnapshots.payload })
      .from(userSnapshots)
      .where(sql`lower(${userSnapshots.userName}) = ${user.toLowerCase()}`)
      .orderBy(asc(userSnapshots.day))
      .all();
    return buildHistory(
      rows.length > 0 ? "anilist" : null,
      rows.map((r) => ({ day: r.day, entries: normalizeAniListSnapshot(r.payload) })),
    );
  }

  for (const service of ["anilist", "mal"] as const) {
    const rows = db
      .select({ day: listSnapshots.day, payload: listSnapshots.payload })
      .from(listSnapshots)
      .where(eq(listSnapshots.service, service))
      .orderBy(asc(listSnapshots.day))
      .all();
    if (rows.length === 0) continue;
    const normalize = service === "anilist" ? normalizeAniListSnapshot : normalizeMalSnapshot;
    return buildHistory(
      service,
      rows.map((r) => ({ day: r.day, entries: normalize(r.payload) })),
    );
  }
  return buildHistory(null, []);
}
