/**
 * Restore plan: compares a daily list snapshot with the live list, per service. Pure, unit-tested in
 * tests/restore.test.ts. The plan only describes writes; the client applies them through /api/entry.
 */
import type { CanonicalStatus, EntryPatch } from "./mapping";
import type { MergedEntry } from "./merge";
import type { SnapshotEntry } from "./stats/history";

export type RestoreService = "mal" | "anilist";
export type RestoreKind = "changed" | "added" | "removed";

export interface RestoreState {
  status: CanonicalStatus;
  progress: number;
  /** 0-10, 0 = not rated */
  score: number;
}

export interface RestoreItem {
  /** Unique within a plan */
  id: string;
  service: RestoreService;
  /** changed: patch the entry; added: remove it (absent from the snapshot); removed: re-add it */
  kind: RestoreKind;
  key: string;
  malId: number | null;
  anilistId: number | null;
  title: string;
  cover: string | null;
  /** State in the snapshot (null for "added") */
  before: RestoreState | null;
  /** Current state (null for "removed") */
  now: RestoreState | null;
  /** changed: only the differing fields, from the snapshot. removed: the full snapshot state */
  patch?: EntryPatch;
  currentUpdatedAt: number | null;
}

export interface RestoreInput {
  mal: SnapshotEntry[] | null;
  anilist: SnapshotEntry[] | null;
  entries: MergedEntry[];
}

const state = (s: { status: CanonicalStatus; progress: number; score: number }): RestoreState => ({
  status: s.status,
  progress: s.progress,
  score: s.score,
});

function planService(service: RestoreService, snapshot: SnapshotEntry[], anime: MergedEntry[]): RestoreItem[] {
  const idOf = (e: MergedEntry) => (service === "mal" ? e.malId : e.anilistId);
  const stateOf = (e: MergedEntry) => (service === "mal" ? e.mal : e.anilist);
  const byId = new Map<number, MergedEntry>();
  for (const e of anime) {
    const id = idOf(e);
    if (id !== null) byId.set(id, e);
  }
  const snapshotById = new Map(snapshot.map((s) => [s.id, s]));
  const items: RestoreItem[] = [];

  for (const e of anime) {
    const id = idOf(e);
    const current = stateOf(e);
    if (id === null || current === null || snapshotById.has(id)) continue;
    items.push({
      id: `${service}:added:${id}`,
      service,
      kind: "added",
      key: e.key,
      malId: e.malId,
      anilistId: e.anilistId,
      title: e.title,
      cover: e.cover,
      before: null,
      now: state(current),
      currentUpdatedAt: current.updatedAt,
    });
  }

  for (const snap of snapshotById.values()) {
    const entry = byId.get(snap.id);
    const current = entry ? stateOf(entry) : null;
    const before = state(snap);
    if (entry && current) {
      const patch: EntryPatch = {};
      if (current.status !== snap.status) patch.status = snap.status;
      if (current.progress !== snap.progress) patch.progress = snap.progress;
      if (current.score !== snap.score) patch.score = snap.score;
      if (Object.keys(patch).length === 0) continue;
      items.push({
        id: `${service}:changed:${snap.id}`,
        service,
        kind: "changed",
        key: entry.key,
        malId: entry.malId,
        anilistId: entry.anilistId,
        title: entry.title,
        cover: entry.cover,
        before,
        now: state(current),
        patch,
        currentUpdatedAt: current.updatedAt,
      });
      continue;
    }
    // Missing from the live list on this service (the merged entry may still exist through the other one).
    items.push({
      id: `${service}:removed:${snap.id}`,
      service,
      kind: "removed",
      key: entry?.key ?? (service === "mal" ? `mal:${snap.id}` : `al:${snap.id}`),
      malId: entry?.malId ?? (service === "mal" ? snap.id : null),
      anilistId: entry?.anilistId ?? (service === "anilist" ? snap.id : null),
      title: entry?.title ?? `Anime #${snap.id}`,
      cover: entry?.cover ?? null,
      before,
      now: null,
      patch: { status: snap.status, progress: snap.progress, score: snap.score },
      currentUpdatedAt: null,
    });
  }
  return items;
}

function rank(item: RestoreItem): number {
  if (item.kind === "changed") return item.patch?.status !== undefined ? 0 : 1;
  return item.kind === "added" ? 2 : 3;
}

/** Differences to undo to bring each service with a snapshot back to it. Anime only. */
export function planRestore(input: RestoreInput): RestoreItem[] {
  const anime = input.entries.filter((e) => e.kind === "anime");
  const items = [
    ...(input.mal ? planService("mal", input.mal, anime) : []),
    ...(input.anilist ? planService("anilist", input.anilist, anime) : []),
  ];
  return items.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, "fr") || a.id.localeCompare(b.id));
}
