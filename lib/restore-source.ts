import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { planRestore, type RestoreItem } from "./restore";
import { listSnapshots } from "./schema";
import { normalizeAniListSnapshot, normalizeMalSnapshot } from "./stats/snapshots";
import { getMergedList } from "./sync";

export interface SnapshotDay {
  day: string;
  mal?: { fetchedAt: number; count: number };
  anilist?: { fetchedAt: number; count: number };
}

export interface RestorePlan {
  day: string;
  items: RestoreItem[];
  fetchedAt: { mal?: number; anilist?: number };
}

/** Days with at least one snapshot, newest first. Read-only. */
export function listSnapshotDays(): SnapshotDay[] {
  const rows = getDb()
    .select({ service: listSnapshots.service, day: listSnapshots.day, fetchedAt: listSnapshots.fetchedAt, payload: listSnapshots.payload })
    .from(listSnapshots)
    .orderBy(desc(listSnapshots.day))
    .all();
  const days = new Map<string, SnapshotDay>();
  for (const row of rows) {
    const entry = days.get(row.day) ?? { day: row.day };
    entry[row.service] = { fetchedAt: row.fetchedAt, count: row.payload.length };
    days.set(row.day, entry);
  }
  return [...days.values()];
}

/** Plan to bring MAL / AniList back to the snapshots of `day`, against the freshly fetched live list. */
export async function buildRestorePlan(day: string): Promise<RestorePlan> {
  const rows = getDb().select().from(listSnapshots).where(eq(listSnapshots.day, day)).all();
  const mal = rows.find((r) => r.service === "mal");
  const anilist = rows.find((r) => r.service === "anilist");
  const list = await getMergedList({ force: true });
  return {
    day,
    items: planRestore({
      mal: mal ? normalizeMalSnapshot(mal.payload) : null,
      anilist: anilist ? normalizeAniListSnapshot(anilist.payload) : null,
      entries: list.entries,
    }),
    fetchedAt: { ...(mal ? { mal: mal.fetchedAt } : {}), ...(anilist ? { anilist: anilist.fetchedAt } : {}) },
  };
}
