import { describe, expect, it } from "vitest";
import {
  ANILIST_STATUSES,
  CANONICAL_STATUSES,
  applyPatch,
  buildStepPatch,
  clampProgress,
  clampScore,
  diffStates,
  fromAniListScore,
  fromAniListStatus,
  fromMalStatus,
  maxState,
  normalizeTotal,
  patchBetween,
  pickDisplayState,
  reachedEnd,
  toAniListScoreRaw,
  toAniListStatus,
  toMalStatus,
  type EntryState,
} from "@/lib/mapping";

function state(partial: Partial<EntryState> = {}): EntryState {
  return { status: "watching", progress: 0, score: 0, updatedAt: null, entryId: null, ...partial };
}

describe("status mapping", () => {
  it("maps canonical statuses to MAL", () => {
    expect(toMalStatus("watching")).toEqual({ status: "watching", is_rewatching: false });
    expect(toMalStatus("completed")).toEqual({ status: "completed", is_rewatching: false });
    expect(toMalStatus("on_hold")).toEqual({ status: "on_hold", is_rewatching: false });
    expect(toMalStatus("dropped")).toEqual({ status: "dropped", is_rewatching: false });
    expect(toMalStatus("plan_to_watch")).toEqual({ status: "plan_to_watch", is_rewatching: false });
  });

  it("maps rewatching to MAL watching + is_rewatching", () => {
    expect(toMalStatus("rewatching")).toEqual({ status: "watching", is_rewatching: true });
  });

  it("maps MAL statuses back, is_rewatching wins over the base status", () => {
    expect(fromMalStatus("watching", false)).toBe("watching");
    expect(fromMalStatus("watching", true)).toBe("rewatching");
    expect(fromMalStatus("completed", true)).toBe("rewatching");
    expect(fromMalStatus("on_hold", false)).toBe("on_hold");
    expect(fromMalStatus("plan_to_watch", false)).toBe("plan_to_watch");
  });

  it("maps canonical statuses to AniList", () => {
    expect(toAniListStatus("watching")).toBe("CURRENT");
    expect(toAniListStatus("completed")).toBe("COMPLETED");
    expect(toAniListStatus("on_hold")).toBe("PAUSED");
    expect(toAniListStatus("dropped")).toBe("DROPPED");
    expect(toAniListStatus("plan_to_watch")).toBe("PLANNING");
    expect(toAniListStatus("rewatching")).toBe("REPEATING");
  });

  it("round-trips every status through both services", () => {
    for (const s of CANONICAL_STATUSES) {
      expect(fromAniListStatus(toAniListStatus(s))).toBe(s);
      const mal = toMalStatus(s);
      expect(fromMalStatus(mal.status, mal.is_rewatching)).toBe(s);
    }
    for (const s of ANILIST_STATUSES) {
      expect(toAniListStatus(fromAniListStatus(s))).toBe(s);
    }
  });
});

describe("score conversion", () => {
  it("converts to AniList scoreRaw (0-100)", () => {
    expect(toAniListScoreRaw(0)).toBe(0);
    expect(toAniListScoreRaw(7)).toBe(70);
    expect(toAniListScoreRaw(10)).toBe(100);
  });

  it("clamps out-of-range values before converting", () => {
    expect(toAniListScoreRaw(-3)).toBe(0);
    expect(toAniListScoreRaw(42)).toBe(100);
    expect(toAniListScoreRaw(7.6)).toBe(80);
    expect(toAniListScoreRaw(Number.NaN)).toBe(0);
  });

  it("reads AniList POINT_100 scores and rounds", () => {
    expect(fromAniListScore(0)).toBe(0);
    expect(fromAniListScore(100)).toBe(10);
    expect(fromAniListScore(85)).toBe(9);
    expect(fromAniListScore(84)).toBe(8);
    expect(fromAniListScore(75)).toBe(8);
    expect(fromAniListScore(74)).toBe(7);
    expect(fromAniListScore(4)).toBe(0);
    expect(fromAniListScore(5)).toBe(1);
    expect(fromAniListScore(null)).toBe(0);
    expect(fromAniListScore(undefined)).toBe(0);
  });

  it("clampScore keeps integers in [0, 10]", () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(10)).toBe(10);
    expect(clampScore(11)).toBe(10);
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(4.5)).toBe(5);
  });
});

describe("progress clamping", () => {
  it("clamps to [0, total] when total is known", () => {
    expect(clampProgress(5, 12)).toBe(5);
    expect(clampProgress(13, 12)).toBe(12);
    expect(clampProgress(-1, 12)).toBe(0);
  });

  it("does not clamp the upper bound when total is unknown", () => {
    expect(clampProgress(1500, null)).toBe(1500);
    expect(clampProgress(30, 0)).toBe(30);
    expect(clampProgress(-4, null)).toBe(0);
  });

  it("floors fractional and ignores non finite values", () => {
    expect(clampProgress(3.9, 12)).toBe(3);
    expect(clampProgress(Number.NaN, 12)).toBe(0);
  });

  it("normalizes unknown totals", () => {
    expect(normalizeTotal(0)).toBeNull();
    expect(normalizeTotal(null)).toBeNull();
    expect(normalizeTotal(undefined)).toBeNull();
    expect(normalizeTotal(24)).toBe(24);
  });
});

describe("+1 / -1 patch", () => {
  it("increments progress", () => {
    expect(buildStepPatch(state({ progress: 3 }), 12, 1)).toEqual({ progress: 4 });
  });

  it("switches plan_to_watch to watching on +1", () => {
    expect(buildStepPatch(state({ status: "plan_to_watch", progress: 0 }), 12, 1)).toEqual({
      progress: 1,
      status: "watching",
    });
  });

  it("returns null at the end of a known show", () => {
    expect(buildStepPatch(state({ progress: 12 }), 12, 1)).toBeNull();
  });

  it("never goes below zero", () => {
    expect(buildStepPatch(state({ progress: 0 }), 12, -1)).toBeNull();
    expect(buildStepPatch(state({ progress: 2 }), 12, -1)).toEqual({ progress: 1 });
  });

  it("increments without limit for ongoing shows", () => {
    expect(buildStepPatch(state({ progress: 1100 }), null, 1)).toEqual({ progress: 1101 });
  });

  it("detects the end of a show", () => {
    expect(reachedEnd(state({ progress: 12 }), 12)).toBe(true);
    expect(reachedEnd(state({ progress: 12, status: "completed" }), 12)).toBe(false);
    expect(reachedEnd(state({ progress: 11 }), 12)).toBe(false);
    expect(reachedEnd(state({ progress: 50 }), null)).toBe(false);
  });
});

describe("state helpers", () => {
  it("diffs states field by field", () => {
    expect(diffStates(state(), state())).toEqual([]);
    expect(diffStates(state({ progress: 2 }), state({ progress: 3 }))).toEqual(["progress"]);
    expect(diffStates(state({ status: "rewatching", score: 8 }), state({ status: "watching", score: 7 }))).toEqual([
      "status",
      "score",
    ]);
  });

  it("applies a patch with clamping", () => {
    expect(applyPatch(state({ progress: 3 }), { progress: 99, score: 12 }, 12)).toMatchObject({
      progress: 12,
      score: 10,
      status: "watching",
    });
  });

  it("picks the most advanced state for display", () => {
    const mal = state({ progress: 4, updatedAt: 10 });
    const al = state({ progress: 5, updatedAt: 5 });
    expect(pickDisplayState(mal, al)).toBe(al);
    expect(pickDisplayState(mal, null)).toBe(mal);
    expect(pickDisplayState(null, al)).toBe(al);
    expect(pickDisplayState(null, null)).toBeNull();
    // tie on progress: most recent wins
    expect(pickDisplayState(state({ progress: 4, updatedAt: 1 }), state({ progress: 4, updatedAt: 2 }))?.updatedAt).toBe(2);
  });

  it("maxState keeps highest progress (with its status) and highest score", () => {
    const mal = state({ status: "watching", progress: 10, score: 0 });
    const al = state({ status: "completed", progress: 12, score: 8 });
    expect(maxState(mal, al)).toMatchObject({ status: "completed", progress: 12, score: 8 });
    expect(maxState(state({ progress: 12, score: 9 }), state({ progress: 3, score: 6 }))).toMatchObject({
      progress: 12,
      score: 9,
    });
  });

  it("computes the minimal patch between two states", () => {
    expect(patchBetween(state({ progress: 3 }), state({ progress: 5 }))).toEqual({ progress: 5 });
    expect(patchBetween(null, state({ progress: 5, score: 7 }))).toEqual({ status: "watching", progress: 5, score: 7 });
    expect(patchBetween(state(), state())).toEqual({});
  });
});
