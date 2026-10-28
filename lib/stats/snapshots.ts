/**
 * Bronze snapshots back to the canonical model, for the history. Kept apart from history.ts so the
 * browser bundle does not carry the raw schemas. Pure, unit-tested in tests/stats-v3.test.ts.
 */
import {
  ANILIST_STATUSES,
  clampScore,
  fromAniListScore,
  fromAniListStatus,
  fromMalStatus,
  MAL_STATUSES,
  type AniListStatus,
  type MalStatus,
} from "../mapping";
import type { SnapshotEntry } from "./history";
import { rawAniListEntrySchema, rawMalEntrySchema } from "./raw";

export function normalizeAniListSnapshot(payload: readonly unknown[]): SnapshotEntry[] {
  return payload.flatMap((item) => {
    const parsed = rawAniListEntrySchema.safeParse(item);
    if (!parsed.success) return [];
    const e = parsed.data;
    const status = ANILIST_STATUSES.includes(e.status as AniListStatus) ? (e.status as AniListStatus) : "PLANNING";
    return [{ id: e.mediaId, status: fromAniListStatus(status), score: fromAniListScore(e.score), progress: Math.max(0, e.progress ?? 0) }];
  });
}

export function normalizeMalSnapshot(payload: readonly unknown[]): SnapshotEntry[] {
  return payload.flatMap((item) => {
    const parsed = rawMalEntrySchema.safeParse(item);
    if (!parsed.success) return [];
    const s = parsed.data.list_status;
    const status = MAL_STATUSES.includes(s.status as MalStatus) ? (s.status as MalStatus) : "plan_to_watch";
    return [
      {
        id: parsed.data.node.id,
        status: fromMalStatus(status, s.is_rewatching ?? false),
        score: clampScore(s.score ?? 0),
        progress: Math.max(0, s.num_episodes_watched ?? 0),
      },
    ];
  });
}
