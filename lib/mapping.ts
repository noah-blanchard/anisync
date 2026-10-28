/**
 * Pure mapping between the canonical AniSync model and the MAL / AniList models.
 * No I/O here: everything is unit-tested in tests/mapping.test.ts.
 */

export const CANONICAL_STATUSES = [
  "watching",
  "rewatching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
] as const;
export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

export const MAL_STATUSES = ["watching", "completed", "on_hold", "dropped", "plan_to_watch"] as const;
export type MalStatus = (typeof MAL_STATUSES)[number];

export const ANILIST_STATUSES = ["CURRENT", "COMPLETED", "PAUSED", "DROPPED", "PLANNING", "REPEATING"] as const;
export type AniListStatus = (typeof ANILIST_STATUSES)[number];

export type SyncField = "status" | "progress" | "score";
export type ServiceName = "mal" | "anilist";

/** State of one list entry on one service, expressed in the canonical model. */
export interface EntryState {
  status: CanonicalStatus;
  progress: number;
  /** 0 to 10, 0 = no score */
  score: number;
  /** epoch milliseconds, null when unknown */
  updatedAt: number | null;
  /** AniList list entry id (needed to delete), null on MAL */
  entryId: number | null;
}

export interface EntryPatch {
  status?: CanonicalStatus;
  progress?: number;
  score?: number;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function toMalStatus(status: CanonicalStatus): { status: MalStatus; is_rewatching: boolean } {
  if (status === "rewatching") return { status: "watching", is_rewatching: true };
  return { status, is_rewatching: false };
}

export function fromMalStatus(status: MalStatus, isRewatching: boolean): CanonicalStatus {
  // MAL keeps the base status (watching or completed) and flags the rewatch separately.
  if (isRewatching) return "rewatching";
  return status;
}

const TO_ANILIST: Record<CanonicalStatus, AniListStatus> = {
  watching: "CURRENT",
  completed: "COMPLETED",
  on_hold: "PAUSED",
  dropped: "DROPPED",
  plan_to_watch: "PLANNING",
  rewatching: "REPEATING",
};

const FROM_ANILIST: Record<AniListStatus, CanonicalStatus> = {
  CURRENT: "watching",
  COMPLETED: "completed",
  PAUSED: "on_hold",
  DROPPED: "dropped",
  PLANNING: "plan_to_watch",
  REPEATING: "rewatching",
};

export function toAniListStatus(status: CanonicalStatus): AniListStatus {
  return TO_ANILIST[status];
}

export function fromAniListStatus(status: AniListStatus): CanonicalStatus {
  return FROM_ANILIST[status];
}

export function isActiveStatus(status: CanonicalStatus): boolean {
  return status === "watching" || status === "rewatching";
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(10, Math.max(0, Math.round(score)));
}

/** AniList `scoreRaw` is always on the 0-100 scale, whatever the user's display format. */
export function toAniListScoreRaw(score: number): number {
  return clampScore(score) * 10;
}

/** Reads `score(format: POINT_100)` and brings it back to 0-10. */
export function fromAniListScore(point100: number | null | undefined): number {
  if (point100 == null || !Number.isFinite(point100)) return 0;
  return clampScore(point100 / 10);
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** MAL reports 0 and AniList null for unknown episode counts: both mean "ongoing / unknown". */
export function normalizeTotal(total: number | null | undefined): number | null {
  if (total == null || !Number.isFinite(total) || total <= 0) return null;
  return Math.floor(total);
}

export function clampProgress(progress: number, total: number | null | undefined): number {
  const value = Number.isFinite(progress) ? Math.max(0, Math.floor(progress)) : 0;
  const max = normalizeTotal(total);
  return max === null ? value : Math.min(value, max);
}

// ---------------------------------------------------------------------------
// Comparison and derived actions
// ---------------------------------------------------------------------------

export function diffStates(a: EntryState, b: EntryState): SyncField[] {
  const diff: SyncField[] = [];
  if (a.status !== b.status) diff.push("status");
  if (a.progress !== b.progress) diff.push("progress");
  if (a.score !== b.score) diff.push("score");
  return diff;
}

/** Applies a patch to a state, normalising values. */
export function applyPatch(state: EntryState, patch: EntryPatch, total: number | null): EntryState {
  return {
    ...state,
    status: patch.status ?? state.status,
    progress: patch.progress !== undefined ? clampProgress(patch.progress, total) : state.progress,
    score: patch.score !== undefined ? clampScore(patch.score) : state.score,
  };
}

/**
 * Patch produced by the "+1" (or "-1") action.
 * - plan_to_watch -> watching when incrementing
 * - progress is clamped to the total when known
 * Returns null when nothing would change.
 */
export function buildStepPatch(state: EntryState, total: number | null, delta: 1 | -1): EntryPatch | null {
  const progress = clampProgress(state.progress + delta, total);
  const patch: EntryPatch = {};
  if (progress !== state.progress) patch.progress = progress;
  if (delta > 0 && state.status === "plan_to_watch") {
    patch.status = "watching";
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** True when the given state has just reached the end of a known-length show and is not completed yet. */
export function reachedEnd(state: EntryState, total: number | null): boolean {
  const max = normalizeTotal(total);
  return max !== null && state.progress >= max && state.status !== "completed";
}

/** The state shown in the UI when both sides exist: the most advanced one. */
export function pickDisplayState(mal: EntryState | null, anilist: EntryState | null): EntryState | null {
  if (!mal) return anilist;
  if (!anilist) return mal;
  if (anilist.progress > mal.progress) return anilist;
  if (mal.progress > anilist.progress) return mal;
  return (anilist.updatedAt ?? 0) > (mal.updatedAt ?? 0) ? anilist : mal;
}

/**
 * "Prendre le max": highest progress wins (its status comes along),
 * and the highest non-zero score is kept.
 */
export function maxState(mal: EntryState, anilist: EntryState): EntryState {
  const base = pickDisplayState(mal, anilist) ?? mal;
  return { ...base, score: Math.max(mal.score, anilist.score) };
}

/** Fields of `target` that must be written to transform `current` into it. */
export function patchBetween(current: EntryState | null, target: EntryState): EntryPatch {
  if (!current) return { status: target.status, progress: target.progress, score: target.score };
  const patch: EntryPatch = {};
  if (current.status !== target.status) patch.status = target.status;
  if (current.progress !== target.progress) patch.progress = target.progress;
  if (current.score !== target.score) patch.score = target.score;
  return patch;
}

export function isEmptyPatch(patch: EntryPatch): boolean {
  return patch.status === undefined && patch.progress === undefined && patch.score === undefined;
}
