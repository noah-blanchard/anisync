/**
 * Pure merge of the MAL and AniList lists into one list keyed by MAL id.
 * Unit-tested in tests/merge.test.ts.
 */
import {
  diffStates,
  normalizeTotal,
  pickDisplayState,
  type EntryState,
  type ServiceName,
  type SyncField,
} from "./mapping";

export interface NextAiring {
  episode: number;
  /** epoch milliseconds */
  airingAt: number;
}

export interface MalListItem {
  malId: number;
  title: string;
  englishTitle: string | null;
  cover: string | null;
  totalEpisodes: number | null;
  mediaType: string | null;
  state: EntryState;
}

export interface AniListListItem {
  anilistId: number;
  malId: number | null;
  title: string;
  englishTitle: string | null;
  cover: string | null;
  color: string | null;
  totalEpisodes: number | null;
  format: string | null;
  nextAiring: NextAiring | null;
  state: EntryState;
}

/**
 * - both: the anime exists on both services
 * - mal_only: confirmed that AniList has no media with this idMal
 * - anilist_only: the AniList media has no idMal
 */
export type Availability = "both" | "mal_only" | "anilist_only";

export interface MergedEntry {
  key: string;
  malId: number | null;
  anilistId: number | null;
  title: string;
  englishTitle: string | null;
  cover: string | null;
  color: string | null;
  totalEpisodes: number | null;
  format: string | null;
  nextAiring: NextAiring | null;
  mal: EntryState | null;
  anilist: EntryState | null;
  availability: Availability;
  /** Side where the anime exists but is absent from my list (only when both services are connected) */
  missingOn: ServiceName | null;
  inSync: boolean;
  diff: SyncField[];
  /** epoch ms of the most recent update on either side */
  updatedAt: number;
}

export interface MergeInput {
  /** null = service not connected (or list unavailable) */
  mal: MalListItem[] | null;
  anilist: AniListListItem[] | null;
  /** id_map cache: malId -> anilistId, null when confirmed that no AniList match exists */
  idMap: ReadonlyMap<number, number | null>;
}

export function entryKey(malId: number | null, anilistId: number | null): string {
  if (malId !== null) return `mal:${malId}`;
  return `al:${anilistId ?? 0}`;
}

/** Recomputes the derived sync fields of an entry (used after optimistic updates as well). */
export function computeSync(
  entry: Pick<MergedEntry, "mal" | "anilist" | "availability">,
  connected: { mal: boolean; anilist: boolean },
): Pick<MergedEntry, "inSync" | "diff" | "missingOn" | "updatedAt"> {
  const updatedAt = Math.max(entry.mal?.updatedAt ?? 0, entry.anilist?.updatedAt ?? 0);
  const comparable = connected.mal && connected.anilist && entry.availability === "both";
  if (!comparable) return { inSync: true, diff: [], missingOn: null, updatedAt };

  if (entry.mal && entry.anilist) {
    const diff = diffStates(entry.mal, entry.anilist);
    return { inSync: diff.length === 0, diff, missingOn: null, updatedAt };
  }
  if (entry.mal) return { inSync: false, diff: [], missingOn: "anilist", updatedAt };
  if (entry.anilist) return { inSync: false, diff: [], missingOn: "mal", updatedAt };
  return { inSync: true, diff: [], missingOn: null, updatedAt };
}

export function mergeLists(input: MergeInput): MergedEntry[] {
  const connected = { mal: input.mal !== null, anilist: input.anilist !== null };
  const reverseIdMap = new Map<number, number>();
  for (const [malId, anilistId] of input.idMap) {
    if (anilistId !== null) reverseIdMap.set(anilistId, malId);
  }

  const malById = new Map<number, MalListItem>();
  for (const item of input.mal ?? []) malById.set(item.malId, item);

  const result: MergedEntry[] = [];
  const consumedMal = new Set<number>();

  for (const al of input.anilist ?? []) {
    const malId = al.malId ?? reverseIdMap.get(al.anilistId) ?? null;
    const mal = malId !== null ? malById.get(malId) : undefined;
    if (mal) consumedMal.add(mal.malId);

    const availability: Availability = malId === null ? "anilist_only" : "both";
    const base = {
      key: entryKey(malId, al.anilistId),
      malId,
      anilistId: al.anilistId,
      title: al.title || mal?.title || "Sans titre",
      englishTitle: al.englishTitle ?? mal?.englishTitle ?? null,
      cover: al.cover ?? mal?.cover ?? null,
      color: al.color,
      totalEpisodes: normalizeTotal(al.totalEpisodes) ?? normalizeTotal(mal?.totalEpisodes),
      format: al.format ?? mal?.mediaType ?? null,
      nextAiring: al.nextAiring,
      mal: mal?.state ?? null,
      anilist: al.state,
      availability,
    };
    result.push({ ...base, ...computeSync(base, connected) });
  }

  for (const mal of input.mal ?? []) {
    if (consumedMal.has(mal.malId)) continue;
    const mapped = input.idMap.get(mal.malId);
    const anilistId = mapped ?? null;
    // Without the AniList list we cannot know, so only a confirmed miss counts as "mal_only".
    const availability: Availability = mapped === null ? "mal_only" : "both";
    const base = {
      key: entryKey(mal.malId, anilistId),
      malId: mal.malId,
      anilistId,
      title: mal.title || "Sans titre",
      englishTitle: mal.englishTitle,
      cover: mal.cover,
      color: null,
      totalEpisodes: normalizeTotal(mal.totalEpisodes),
      format: mal.mediaType,
      nextAiring: null,
      mal: mal.state,
      anilist: null,
      availability,
    };
    result.push({ ...base, ...computeSync(base, connected) });
  }

  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** MAL ids from the MAL list that have no AniList counterpart yet and were never looked up. */
export function unresolvedMalIds(input: MergeInput): number[] {
  const known = new Set<number>();
  for (const al of input.anilist ?? []) if (al.malId !== null) known.add(al.malId);
  for (const [malId, anilistId] of input.idMap) {
    if (anilistId !== null) known.add(malId);
  }
  return (input.mal ?? [])
    .map((m) => m.malId)
    .filter((id) => !known.has(id) && !input.idMap.has(id));
}

/** State shown in the UI for an entry. */
export function displayState(entry: Pick<MergedEntry, "mal" | "anilist">): EntryState | null {
  return pickDisplayState(entry.mal, entry.anilist);
}
