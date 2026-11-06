import { describe, expect, it } from "vitest";
import type { EntryState } from "@/lib/mapping";
import type { MergedEntry } from "@/lib/merge";
import { planRestore } from "@/lib/restore";
import type { SnapshotEntry } from "@/lib/stats/history";

const state = (p: Partial<EntryState> = {}): EntryState => ({
  status: "watching",
  progress: 3,
  score: 7,
  updatedAt: 1000,
  entryId: null,
  ...p,
});

function entry(p: Partial<MergedEntry> & { title: string }): MergedEntry {
  return {
    key: p.malId ? `mal:${p.malId}` : `al:${p.anilistId}`,
    kind: "anime",
    malId: null,
    anilistId: null,
    simklId: null,
    englishTitle: null,
    cover: null,
    color: null,
    totalEpisodes: null,
    format: null,
    year: null,
    nextAiring: null,
    nextEpisode: null,
    lastEpisode: null,
    mal: null,
    anilist: null,
    simkl: null,
    availability: "both",
    missingOn: null,
    inSync: true,
    diff: [],
    updatedAt: 0,
    ...p,
  } as MergedEntry;
}

const snap = (id: number, p: Partial<SnapshotEntry> = {}): SnapshotEntry => ({ id, status: "on_hold", progress: 3, score: 7, ...p });

describe("planRestore", () => {
  it("patches only the status when only the status differs", () => {
    const items = planRestore({
      mal: [snap(1)],
      anilist: null,
      entries: [entry({ title: "A", malId: 1, mal: state() })],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "changed", service: "mal", patch: { status: "on_hold" }, currentUpdatedAt: 1000 });
    expect(items[0]?.before?.status).toBe("on_hold");
    expect(items[0]?.now?.status).toBe("watching");
  });

  it("patches progress and score without touching the status", () => {
    const items = planRestore({
      mal: [snap(1, { status: "watching", progress: 5, score: 9 })],
      anilist: null,
      entries: [entry({ title: "A", malId: 1, mal: state() })],
    });
    expect(items[0]?.patch).toEqual({ progress: 5, score: 9 });
  });

  it("skips identical entries", () => {
    expect(planRestore({ mal: [snap(1, { status: "watching" })], anilist: null, entries: [entry({ title: "A", malId: 1, mal: state() })] })).toEqual([]);
  });

  it("flags entries absent from the snapshot as added (remove)", () => {
    const items = planRestore({ mal: [], anilist: null, entries: [entry({ title: "New", malId: 4, mal: state() })] });
    expect(items[0]).toMatchObject({ kind: "added", before: null, key: "mal:4", malId: 4 });
    expect(items[0]?.patch).toBeUndefined();
  });

  it("re-adds removed entries with the full state, titled from the other service", () => {
    const items = planRestore({
      mal: [snap(1, { status: "dropped", progress: 2, score: 4 })],
      anilist: null,
      entries: [entry({ title: "Only AL", malId: 1, anilistId: 10, anilist: state() })],
    });
    expect(items[0]).toMatchObject({
      kind: "removed",
      service: "mal",
      title: "Only AL",
      anilistId: 10,
      patch: { status: "dropped", progress: 2, score: 4 },
      now: null,
    });
  });

  it("falls back to a generic title for unknown removed entries", () => {
    const [mal] = planRestore({ mal: [snap(42)], anilist: null, entries: [] });
    expect(mal).toMatchObject({ title: "Anime #42", key: "mal:42", malId: 42, anilistId: null });
    const [al] = planRestore({ mal: null, anilist: [snap(7)], entries: [] });
    expect(al).toMatchObject({ title: "Anime #7", key: "al:7", malId: null, anilistId: 7 });
  });

  it("handles a MAL-only snapshot (AniList untouched)", () => {
    const items = planRestore({
      mal: [snap(1)],
      anilist: null,
      entries: [entry({ title: "A", malId: 1, anilistId: 10, mal: state(), anilist: state({ status: "completed" }) })],
    });
    expect(items.map((i) => i.service)).toEqual(["mal"]);
  });

  it("handles an AniList-only snapshot and maps media ids through anilistId", () => {
    const items = planRestore({
      mal: null,
      anilist: [snap(10)],
      entries: [
        entry({ title: "A", malId: 1, anilistId: 10, mal: state(), anilist: state() }),
        entry({ title: "B", malId: 10, anilistId: 99, mal: state(), anilist: state({ status: "on_hold" }) }),
      ],
    });
    // MAL id 10 (entry B) must not be matched with AniList media id 10 (entry A); B's media 99 is new.
    expect(items.map((i) => `${i.kind}:${i.title}`)).toEqual(["changed:A", "added:B"]);
    expect(items[0]).toMatchObject({ service: "anilist", anilistId: 10, malId: 1 });
  });

  it("ignores non-anime entries", () => {
    const items = planRestore({
      mal: [],
      anilist: null,
      entries: [entry({ title: "Show", kind: "show", malId: 5, mal: state() })],
    });
    expect(items).toEqual([]);
  });

  it("sorts status changes, other changes, added, removed, then by title", () => {
    const items = planRestore({
      mal: [snap(1), snap(2, { status: "watching", progress: 9 }), snap(3), snap(9)],
      anilist: null,
      entries: [
        entry({ title: "Zeta", malId: 1, mal: state() }),
        entry({ title: "Beta", malId: 2, mal: state() }),
        entry({ title: "Alpha", malId: 3, mal: state() }),
        entry({ title: "Added", malId: 4, mal: state() }),
      ],
    });
    expect(items.map((i) => `${i.kind}:${i.title}`)).toEqual([
      "changed:Alpha",
      "changed:Zeta",
      "changed:Beta",
      "added:Added",
      "removed:Anime #9",
    ]);
  });
});
