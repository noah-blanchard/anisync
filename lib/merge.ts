/**
 * Pure merge of the MAL and AniList lists (anime) and the local shows / movies into one list.
 * Unit-tested in tests/merge.test.ts.
 */
import {
  diffStates,
  normalizeTotal,
  animeMaxState,
  type EntryState,
  type LocalKind,
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
export type Availability = "both" | "mal_only" | "anilist_only" | "local";

/** A season / episode pointer (shows only); title is null with TMDB (kept for the UI). */
export interface EpisodeRef {
  season: number;
  episode: number;
  title: string | null;
}

/**
 * One show or movie tracked in AniSync, enriched with TMDB details when available.
 * state.progress = watched episodes, except for movies: 1 when completed, 0 otherwise.
 */
export interface LocalListItem {
  tmdbId: number;
  kind: LocalKind;
  title: string;
  originalTitle: string | null;
  cover: string | null;
  year: number | null;
  /** shows: known regular episodes (season >= 1); movies: 1 */
  totalEpisodes: number | null;
  /** shows only, null = up to date or unknown */
  nextEpisode: EpisodeRef | null;
  /** shows only */
  lastEpisode: EpisodeRef | null;
  /** shows only, episode = absolute index */
  nextAiring: NextAiring | null;
  state: EntryState;
}

export interface MergedEntry {
  key: string;
  kind: MediaKind;
  malId: number | null;
  anilistId: number | null;
  tmdbId: number | null;
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
  /** AniSync tracking, shows and movies only */
  local: EntryState | null;
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
  /** Shows and movies tracked in AniSync (never null: the database is always available) */
  local: LocalListItem[];
  /** id_map cache: malId -> anilistId, null when confirmed that no AniList match exists */
  idMap: ReadonlyMap<number, number | null>;
}

export function entryKey(malId: number | null, anilistId: number | null): string {
  if (malId !== null) return `mal:${malId}`;
  return `al:${anilistId ?? 0}`;
}

/** Key of a show or movie tracked locally. */
export function tmdbKey(kind: LocalKind, tmdbId: number): string {
  return `tmdb:${kind}:${tmdbId}`;
}

type SyncFields = Pick<MergedEntry, "inSync" | "diff" | "missingOn" | "updatedAt">;

/** Recomputes the derived sync fields of an entry (used after optimistic updates as well). */
export function computeSync(
  entry: Pick<MergedEntry, "kind" | "mal" | "anilist" | "local" | "availability">,
  connected: { mal: boolean; anilist: boolean },
): SyncFields {
  // Shows and movies live in AniSync only: nothing to compare.
  if (entry.kind !== "anime") {
    return { inSync: true, diff: [], missingOn: null, updatedAt: entry.local?.updatedAt ?? 0 };
  }
  const updatedAt = Math.max(entry.mal?.updatedAt ?? 0, entry.anilist?.updatedAt ?? 0);

  let diff: SyncField[] = [];
  let missingOn: ServiceName | null = null;

  const comparable = connected.mal && connected.anilist && entry.availability === "both";
  if (comparable) {
    if (entry.mal && entry.anilist) diff = diffStates(entry.mal, entry.anilist);
    else if (entry.mal) missingOn = "anilist";
    else if (entry.anilist) missingOn = "mal";
  }

  return { inSync: diff.length === 0 && missingOn === null, diff, missingOn, updatedAt };
}

type EntryBase = Omit<MergedEntry, keyof SyncFields>;

export function mergeLists(input: MergeInput): MergedEntry[] {
  const connected = { mal: input.mal !== null, anilist: input.anilist !== null };
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
      tmdbId: null,
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
      local: null,
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
      tmdbId: null,
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
      local: null,
      availability,
    });
  }

  for (const item of input.local) {
    const isMovie = item.kind === "movie";
    bases.push({
      key: tmdbKey(item.kind, item.tmdbId),
      kind: item.kind,
      malId: null,
      anilistId: null,
      tmdbId: item.tmdbId,
      title: item.title || "Sans titre",
      englishTitle: item.originalTitle,
      cover: item.cover,
      color: null,
      totalEpisodes: isMovie ? 1 : normalizeTotal(item.totalEpisodes),
      format: null,
      year: item.year,
      nextAiring: isMovie ? null : item.nextAiring,
      nextEpisode: isMovie ? null : item.nextEpisode,
      lastEpisode: isMovie ? null : item.lastEpisode,
      mal: null,
      anilist: null,
      local: item.state,
      availability: "local",
    });
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

/** The anime state that counts: MAL and AniList are the only sources of truth. */
export function animeTruthState(entry: Pick<MergedEntry, "mal" | "anilist">): EntryState | null {
  return animeMaxState(entry.mal, entry.anilist);
}

/** State shown in the UI for an entry: the anime truth, or the local tracking for shows and movies. */
export function displayState(entry: Pick<MergedEntry, "kind" | "mal" | "anilist" | "local">): EntryState | null {
  return entry.kind === "anime" ? animeTruthState(entry) : entry.local;
}
