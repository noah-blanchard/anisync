/**
 * Pure merge of the MAL, AniList and Simkl lists into one list.
 * Unit-tested in tests/merge.test.ts.
 */
import {
  diffStates,
  diffWithSimkl,
  normalizeTotal,
  animeMaxState,
  type EntryState,
  type MediaKind,
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
export type Availability = "both" | "mal_only" | "anilist_only" | "simkl_only";

/** A season / episode pointer (shows only), with the episode title when Simkl gives one. */
export interface EpisodeRef {
  season: number;
  episode: number;
  title: string | null;
}

/**
 * One item of the Simkl library.
 * state.progress = watched_episodes_count, except for movies: 1 when completed, 0 otherwise.
 * state.score = user_rating ?? 0, state.updatedAt = most recent of the watch / rating / add dates.
 */
export interface SimklListItem {
  simklId: number;
  kind: MediaKind;
  malId: number | null;
  anilistId: number | null;
  title: string;
  cover: string | null;
  year: number | null;
  totalEpisodes: number | null;
  animeType: string | null;
  nextEpisode: EpisodeRef | null;
  lastEpisode: EpisodeRef | null;
  state: EntryState;
}

export interface MergedEntry {
  key: string;
  kind: MediaKind;
  malId: number | null;
  anilistId: number | null;
  simklId: number | null;
  title: string;
  englishTitle: string | null;
  cover: string | null;
  color: string | null;
  totalEpisodes: number | null;
  format: string | null;
  year: number | null;
  nextAiring: NextAiring | null;
  /** shows only: next episode to watch / last watched (for +1 / -1) */
  nextEpisode: EpisodeRef | null;
  lastEpisode: EpisodeRef | null;
  mal: EntryState | null;
  anilist: EntryState | null;
  simkl: EntryState | null;
  availability: Availability;
  /** Service where the title exists but is absent from my list (only when the services are connected) */
  missingOn: ServiceName | null;
  inSync: boolean;
  diff: SyncField[];
  /** epoch ms of the most recent update on any service */
  updatedAt: number;
}

export interface MergeInput {
  /** null = service not connected (or list unavailable) */
  mal: MalListItem[] | null;
  anilist: AniListListItem[] | null;
  /** null = Simkl not connected / not configured (or list unavailable) */
  simkl: SimklListItem[] | null;
  /** id_map cache: malId -> anilistId, null when confirmed that no AniList match exists */
  idMap: ReadonlyMap<number, number | null>;
}

export function entryKey(malId: number | null, anilistId: number | null): string {
  if (malId !== null) return `mal:${malId}`;
  return `al:${anilistId ?? 0}`;
}

/** Key of an entry that only exists on Simkl (shows, movies, anime without MAL / AniList id). */
export function simklKey(kind: MediaKind, simklId: number): string {
  return `simkl:${kind}:${simklId}`;
}

type SyncFields = Pick<MergedEntry, "inSync" | "diff" | "missingOn" | "updatedAt">;

/** Recomputes the derived sync fields of an entry (used after optimistic updates as well). */
export function computeSync(
  entry: Pick<MergedEntry, "kind" | "mal" | "anilist" | "simkl" | "availability">,
  connected: { mal: boolean; anilist: boolean; simkl: boolean },
): SyncFields {
  // Shows and movies live on Simkl only: nothing to compare.
  if (entry.kind !== "anime") {
    return { inSync: true, diff: [], missingOn: null, updatedAt: entry.simkl?.updatedAt ?? 0 };
  }
  // For anime only MAL / AniList count: a fresh Simkl import must not reorder or "refresh" entries.
  const updatedAt = Math.max(entry.mal?.updatedAt ?? 0, entry.anilist?.updatedAt ?? 0);

  let diff: SyncField[] = [];
  let missingOn: ServiceName | null = null;

  const comparable = connected.mal && connected.anilist && entry.availability === "both";
  if (comparable) {
    if (entry.mal && entry.anilist) diff = diffStates(entry.mal, entry.anilist);
    else if (entry.mal) missingOn = "anilist";
    else if (entry.anilist) missingOn = "mal";
  }

  // Simkl is a mirror: a difference only means that Simkl needs an update (the reference is MAL / AniList).
  if (connected.simkl) {
    const reference = animeTruthState(entry);
    if (reference && entry.simkl) {
      for (const field of diffWithSimkl(reference, entry.simkl)) {
        if (!diff.includes(field)) diff.push(field);
      }
    } else if (reference) {
      missingOn = missingOn ?? "simkl";
    }
  }

  return { inSync: diff.length === 0 && missingOn === null, diff, missingOn, updatedAt };
}

type EntryBase = Omit<MergedEntry, keyof SyncFields>;

export function mergeLists(input: MergeInput): MergedEntry[] {
  const connected = { mal: input.mal !== null, anilist: input.anilist !== null, simkl: input.simkl !== null };
  const reverseIdMap = new Map<number, number>();
  for (const [malId, anilistId] of input.idMap) {
    if (anilistId !== null) reverseIdMap.set(anilistId, malId);
  }

  const malById = new Map<number, MalListItem>();
  for (const item of input.mal ?? []) malById.set(item.malId, item);

  const bases: EntryBase[] = [];
  const consumedMal = new Set<number>();

  for (const al of input.anilist ?? []) {
    const malId = al.malId ?? reverseIdMap.get(al.anilistId) ?? null;
    const mal = malId !== null ? malById.get(malId) : undefined;
    if (mal) consumedMal.add(mal.malId);

    const availability: Availability = malId === null ? "anilist_only" : "both";
    bases.push({
      key: entryKey(malId, al.anilistId),
      kind: "anime",
      malId,
      anilistId: al.anilistId,
      simklId: null,
      title: al.title || mal?.title || "Sans titre",
      englishTitle: al.englishTitle ?? mal?.englishTitle ?? null,
      cover: al.cover ?? mal?.cover ?? null,
      color: al.color,
      totalEpisodes: normalizeTotal(al.totalEpisodes) ?? normalizeTotal(mal?.totalEpisodes),
      format: al.format ?? mal?.mediaType ?? null,
      year: null,
      nextAiring: al.nextAiring,
      nextEpisode: null,
      lastEpisode: null,
      mal: mal?.state ?? null,
      anilist: al.state,
      simkl: null,
      availability,
    });
  }

  for (const mal of input.mal ?? []) {
    if (consumedMal.has(mal.malId)) continue;
    const mapped = input.idMap.get(mal.malId);
    const anilistId = mapped ?? null;
    // Without the AniList list we cannot know, so only a confirmed miss counts as "mal_only".
    const availability: Availability = mapped === null ? "mal_only" : "both";
    bases.push({
      key: entryKey(mal.malId, anilistId),
      kind: "anime",
      malId: mal.malId,
      anilistId,
      simklId: null,
      title: mal.title || "Sans titre",
      englishTitle: mal.englishTitle,
      cover: mal.cover,
      color: null,
      totalEpisodes: normalizeTotal(mal.totalEpisodes),
      format: mal.mediaType,
      year: null,
      nextAiring: null,
      nextEpisode: null,
      lastEpisode: null,
      mal: mal.state,
      anilist: null,
      simkl: null,
      availability,
    });
  }

  // Simkl: anime attach to the entry with the same MAL id, then the same AniList id.
  const byMal = new Map<number, EntryBase>();
  const byAnilist = new Map<number, EntryBase>();
  for (const entry of bases) {
    if (entry.malId !== null && !byMal.has(entry.malId)) byMal.set(entry.malId, entry);
    if (entry.anilistId !== null && !byAnilist.has(entry.anilistId)) byAnilist.set(entry.anilistId, entry);
  }

  for (const item of input.simkl ?? []) {
    if (item.kind !== "anime") {
      const isMovie = item.kind === "movie";
      bases.push({
        key: simklKey(item.kind, item.simklId),
        kind: item.kind,
        malId: null,
        anilistId: null,
        simklId: item.simklId,
        title: item.title || "Sans titre",
        englishTitle: null,
        cover: item.cover,
        color: null,
        totalEpisodes: isMovie ? 1 : normalizeTotal(item.totalEpisodes),
        format: null,
        year: item.year,
        nextAiring: null,
        nextEpisode: isMovie ? null : item.nextEpisode,
        lastEpisode: isMovie ? null : item.lastEpisode,
        mal: null,
        anilist: null,
        simkl: item.state,
        availability: "simkl_only",
      });
      continue;
    }

    const target =
      (item.malId !== null ? byMal.get(item.malId) : undefined) ??
      (item.anilistId !== null ? byAnilist.get(item.anilistId) : undefined);
    if (target) {
      // Duplicate Simkl rows for the same anime: the first one wins.
      if (target.simkl) continue;
      target.simkl = item.state;
      target.simklId = item.simklId;
      target.year = item.year;
      target.cover = target.cover ?? item.cover;
      target.totalEpisodes = target.totalEpisodes ?? normalizeTotal(item.totalEpisodes);
      target.format = target.format ?? item.animeType;
      continue;
    }

    // Anime unknown to MAL and AniList are ignored: Simkl is a mirror, never a source of entries.
  }

  return bases.map((base) => ({ ...base, ...computeSync(base, connected) })).sort((a, b) => b.updatedAt - a.updatedAt);
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

/**
 * The state that counts for an entry. For anime, MAL and AniList are the only sources of truth:
 * Simkl is a one-way mirror and never takes part, whatever its progress or update date.
 * Shows and movies only exist on Simkl.
 */
export function animeTruthState(entry: Pick<MergedEntry, "mal" | "anilist">): EntryState | null {
  return animeMaxState(entry.mal, entry.anilist);
}

/** State shown in the UI for an entry. */
export function displayState(entry: Pick<MergedEntry, "kind" | "mal" | "anilist" | "simkl">): EntryState | null {
  return entry.kind === "anime" ? animeTruthState(entry) : entry.simkl;
}
