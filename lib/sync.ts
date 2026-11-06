import "server-only";
import {
  deleteAniListEntry,
  fetchAniListList,
  findAniListEntryId,
  resolveAniListId,
  resolveAniListIds,
  resolveMalId,
  saveAniListEntry,
  searchAnime,
  type SearchResult,
} from "./anilist";
import {
  getConnectionInfos,
  getMappedAniListId,
  getMappedMalId,
  loadIdMap,
  saveIdMappings,
  type ConnectionInfo,
} from "./connections";
import { isTmdbEnabled } from "./env";
import { ServiceError, userMessage } from "./errors";
import { deleteMalEntry, fetchMalList, updateMalEntry } from "./mal";
import { loadLocalList, readLocalItem, removeLocalEntry, writeLocalEntry } from "./media";
import {
  ANIME_SERVICES,
  applyPatch,
  isEmptyPatch,
  patchBetween,
  type EntryPatch,
  type EntryState,
  type LocalKind,
  type MediaKind,
  type ServiceName,
  type Slot,
} from "./mapping";
import {
  animeTruthState,
  computeSync,
  displayState,
  entryKey,
  mergeLists,
  tmdbKey,
  unresolvedMalIds,
  type AniListListItem,
  type LocalListItem,
  type MalListItem,
  type MergedEntry,
} from "./merge";
import { searchTmdb } from "./tmdb";
import { tmdbPosterUrl } from "./tmdb-parse";

const CACHE_TTL_MS = 60_000;
const ERROR_CACHE_TTL_MS = 10_000;
/** Max ids resolved per list load, to stay far below AniList's rate limit. */
const MAX_RESOLVE_PER_LOAD = 500;

export interface ListPayload {
  entries: MergedEntry[];
  connections: Record<ServiceName, ConnectionInfo | null>;
  /** Services whose list was loaded (used for sync comparisons) */
  sources: Record<ServiceName, boolean>;
  errors: Partial<Record<ServiceName, string>>;
  /** TMDB is configured (API key set): shows and movies can be searched and added */
  tmdbEnabled: boolean;
  fetchedAt: number;
}

export interface ServiceResult {
  ok: boolean;
  /** true when nothing was attempted (service not connected or anime absent there) */
  skipped?: boolean;
  error?: string;
  entry?: EntryState | null;
}

export interface WriteResult {
  key: string;
  malId: number | null;
  anilistId: number | null;
  tmdbId: number | null;
  mal: ServiceResult;
  anilist: ServiceResult;
  local: ServiceResult;
}

/** How a request designates an entry: its key first, then ids (needed for items not in the list yet). */
export interface EntryRef {
  key?: string;
  malId?: number | null;
  anilistId?: number | null;
  tmdb?: { id: number; kind: LocalKind };
}

// ---------------------------------------------------------------------------
// Merged list cache
// ---------------------------------------------------------------------------

const globalForCache = globalThis as unknown as {
  __anisyncList?: { payload: ListPayload; expiresAt: number };
  __anisyncListInFlight?: Promise<ListPayload> | null;
};

export function invalidateList(): void {
  globalForCache.__anisyncList = undefined;
}

async function loadList(): Promise<ListPayload> {
  const connections = getConnectionInfos();
  const [malResult, anilistResult, localResult] = await Promise.allSettled([
    connections.mal ? fetchMalList() : Promise.resolve(null),
    connections.anilist ? fetchAniListList() : Promise.resolve(null),
    loadLocalList(),
  ]);

  const errors: ListPayload["errors"] = {};
  const mal: MalListItem[] | null = malResult.status === "fulfilled" ? malResult.value : null;
  const anilist: AniListListItem[] | null = anilistResult.status === "fulfilled" ? anilistResult.value : null;
  if (malResult.status === "rejected") errors.mal = userMessage(malResult.reason);
  if (anilistResult.status === "rejected") errors.anilist = userMessage(anilistResult.reason);
  if (localResult.status === "rejected") console.warn(`[anisync] local list unavailable: ${userMessage(localResult.reason)}`);
  const local: LocalListItem[] = localResult.status === "fulfilled" ? localResult.value : [];

  // Remember every pair AniList gave us, then look up the MAL entries still unknown.
  if (anilist) {
    saveIdMappings(
      anilist.filter((a) => a.malId !== null).map((a) => ({ malId: a.malId as number, anilistId: a.anilistId })),
    );
  }
  let idMap = loadIdMap();
  if (mal && anilist) {
    const missing = unresolvedMalIds({ mal, anilist, local, idMap }).slice(0, MAX_RESOLVE_PER_LOAD);
    if (missing.length > 0) {
      try {
        saveIdMappings(await resolveAniListIds(missing));
        idMap = loadIdMap();
      } catch (error) {
        console.warn(`[anisync] id resolution skipped: ${userMessage(error)}`);
      }
    }
  }

  return {
    entries: mergeLists({ mal, anilist, local, idMap }),
    connections,
    sources: { mal: mal !== null, anilist: anilist !== null },
    errors,
    tmdbEnabled: isTmdbEnabled(),
    fetchedAt: Date.now(),
  };
}

export async function getMergedList(options: { force?: boolean } = {}): Promise<ListPayload> {
  const cached = globalForCache.__anisyncList;
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.payload;

  globalForCache.__anisyncListInFlight ??= loadList()
    .then((payload) => {
      const ttl = Object.keys(payload.errors).length > 0 ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
      globalForCache.__anisyncList = { payload, expiresAt: Date.now() + ttl };
      return payload;
    })
    .finally(() => {
      globalForCache.__anisyncListInFlight = null;
    });
  return globalForCache.__anisyncListInFlight;
}

function findEntry(payload: ListPayload, ref: EntryRef): MergedEntry | undefined {
  if (ref.key) {
    const byKey = payload.entries.find((e) => e.key === ref.key);
    if (byKey) return byKey;
  }
  const malId = ref.malId ?? null;
  const anilistId = ref.anilistId ?? null;
  return payload.entries.find(
    (e) =>
      (malId !== null && e.malId === malId) ||
      (anilistId !== null && e.anilistId === anilistId) ||
      (ref.tmdb !== undefined && e.tmdbId === ref.tmdb.id && e.kind === ref.tmdb.kind),
  );
}

/** Write-through update of the cached entry; anything unexpected drops the cache. */
function updateCachedEntry(entry: MergedEntry, update: (entry: MergedEntry) => MergedEntry | null): void {
  const cached = globalForCache.__anisyncList;
  if (!cached) return;
  const current = cached.payload.entries.find((e) => e.key === entry.key);
  if (!current) {
    invalidateList();
    return;
  }
  const next = update(current);
  const entries = cached.payload.entries
    .map((e) => (e === current ? next : e))
    .filter((e): e is MergedEntry => e !== null);
  cached.payload = { ...cached.payload, entries };
}

const NO_SOURCES: Record<ServiceName, boolean> = { mal: false, anilist: false };

function withStates(entry: MergedEntry, states: Partial<Record<Slot, EntryState | null>>, sources: ListPayload["sources"]) {
  const next: MergedEntry = {
    ...entry,
    mal: states.mal !== undefined ? states.mal : entry.mal,
    anilist: states.anilist !== undefined ? states.anilist : entry.anilist,
    local: states.local !== undefined ? states.local : entry.local,
  };
  return { ...next, ...computeSync(next, sources) };
}

// ---------------------------------------------------------------------------
// Id helpers
// ---------------------------------------------------------------------------

async function completeIds(
  malId: number | null,
  anilistId: number | null,
  entry: MergedEntry | undefined,
): Promise<{ malId: number | null; anilistId: number | null }> {
  let mal = malId ?? entry?.malId ?? null;
  let al = anilistId ?? entry?.anilistId ?? null;

  if (mal !== null && al === null && entry?.availability !== "mal_only") {
    const cached = getMappedAniListId(mal);
    if (cached !== undefined) {
      al = cached;
    } else {
      al = await resolveAniListId(mal);
      saveIdMappings([{ malId: mal, anilistId: al }]);
    }
  }
  if (al !== null && mal === null && entry?.availability !== "anilist_only") {
    mal = getMappedMalId(al) ?? (await resolveMalId(al));
    if (mal !== null) saveIdMappings([{ malId: mal, anilistId: al }]);
  }
  return { malId: mal, anilistId: al };
}

function failure(error: unknown): ServiceResult {
  return { ok: false, error: userMessage(error) };
}

const SKIPPED: ServiceResult = { ok: true, skipped: true };

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type PerSlotPatch = Partial<Record<Slot, EntryPatch>>;

/** Everything needed to address one entry on the three slots. */
interface WriteTarget {
  key: string;
  kind: MediaKind;
  malId: number | null;
  anilistId: number | null;
  tmdbId: number | null;
  total: number | null;
}

function keyFor(kind: MediaKind, malId: number | null, anilistId: number | null, tmdbId: number | null): string {
  if (kind !== "anime" && tmdbId !== null) return tmdbKey(kind, tmdbId);
  return entryKey(malId, anilistId);
}

/** Anime live on MAL / AniList, shows and movies only in AniSync. */
function defaultTargets(kind: MediaKind): Slot[] {
  return kind === "anime" ? [...ANIME_SERVICES] : ["local"];
}

/** Runs the given patches on the three slots in parallel and updates the cache. */
async function applyPatches(
  target: WriteTarget,
  patches: PerSlotPatch,
  existing: MergedEntry | undefined,
): Promise<WriteResult> {
  const connections = getConnectionInfos();

  const run = async (slot: Slot): Promise<ServiceResult> => {
    const patch = patches[slot];
    if (!patch) return SKIPPED;
    if (slot === "local") {
      if (target.kind === "anime" || target.tmdbId === null) return SKIPPED;
      if (isEmptyPatch(patch)) return { ok: true, entry: existing?.local ?? null };
      return { ok: true, entry: await writeLocalEntry({ kind: target.kind, tmdbId: target.tmdbId }, patch) };
    }
    if (!connections[slot]) return SKIPPED;
    if (slot === "mal" && target.malId === null) return SKIPPED;
    if (slot === "anilist" && target.anilistId === null) return SKIPPED;
    if (isEmptyPatch(patch)) return { ok: true, entry: existing?.[slot] ?? null };
    if (slot === "mal" && target.malId !== null) return { ok: true, entry: await updateMalEntry(target.malId, patch) };
    if (slot === "anilist" && target.anilistId !== null) {
      return { ok: true, entry: await saveAniListEntry(target.anilistId, patch) };
    }
    return SKIPPED;
  };

  const [malResult, anilistResult, localResult] = await Promise.allSettled([run("mal"), run("anilist"), run("local")]);
  const mal = malResult.status === "fulfilled" ? malResult.value : failure(malResult.reason);
  const anilist = anilistResult.status === "fulfilled" ? anilistResult.value : failure(anilistResult.reason);
  const local = localResult.status === "fulfilled" ? localResult.value : failure(localResult.reason);

  if (existing) {
    const states: Partial<Record<Slot, EntryState | null>> = {};
    if (mal.ok && !mal.skipped && mal.entry !== undefined) states.mal = mal.entry;
    if (anilist.ok && !anilist.skipped && anilist.entry !== undefined) states.anilist = anilist.entry;
    if (local.ok && !local.skipped && local.entry !== undefined) states.local = local.entry;
    const sources = globalForCache.__anisyncList?.payload.sources ?? NO_SOURCES;
    // Show pointers (next / last episode) follow the progress: recompute them from the database and TMDB cache.
    const item =
      target.kind === "show" && target.tmdbId !== null && local.ok && !local.skipped
        ? readLocalItem({ kind: "show", tmdbId: target.tmdbId })
        : null;
    updateCachedEntry(existing, (entry) => {
      const next = withStates(entry, states, sources);
      if (!item) return next;
      return {
        ...next,
        totalEpisodes: item.totalEpisodes,
        nextEpisode: item.nextEpisode,
        lastEpisode: item.lastEpisode,
        nextAiring: item.nextAiring,
      };
    });
  } else {
    invalidateList();
  }

  return {
    key: target.key,
    malId: target.malId,
    anilistId: target.anilistId,
    tmdbId: target.tmdbId,
    mal,
    anilist,
    local,
  };
}

const NEW_ENTRY: EntryState = { status: "plan_to_watch", progress: 0, score: 0, updatedAt: null, entryId: null };

function targetOf(
  ref: EntryRef,
  existing: MergedEntry | undefined,
  ids: { malId: number | null; anilistId: number | null },
): WriteTarget {
  const kind: MediaKind = existing?.kind ?? ref.tmdb?.kind ?? "anime";
  const tmdbId = existing?.tmdbId ?? ref.tmdb?.id ?? null;
  return {
    key: existing?.key ?? keyFor(kind, ids.malId, ids.anilistId, tmdbId),
    kind,
    malId: ids.malId,
    anilistId: ids.anilistId,
    tmdbId,
    total: existing?.totalEpisodes ?? null,
  };
}

/**
 * Applies a patch on every slot (or on `targets` only).
 * Sides that already have the entry receive only the patch fields; a missing side
 * is created with the full state so all lists end up identical.
 * Shows and movies only ever live in the local slot (created from the patch, with defaults).
 */
export async function writeEntry(input: EntryRef & { patch: EntryPatch; targets?: Slot[] }): Promise<WriteResult> {
  const list = await getMergedList();
  const existing = findEntry(list, input);
  const kind: MediaKind = existing?.kind ?? input.tmdb?.kind ?? "anime";
  const ids =
    kind === "anime"
      ? await completeIds(input.malId ?? null, input.anilistId ?? null, existing)
      : { malId: null, anilistId: null };
  const target = targetOf(input, existing, ids);
  const base = existing ? (displayState(existing) ?? NEW_ENTRY) : NEW_ENTRY;
  const wanted = applyPatch(base, input.patch, target.total);
  const allowed = defaultTargets(kind);
  const targets = (input.targets ?? allowed).filter((t) => allowed.includes(t));

  const patches: PerSlotPatch = {};
  for (const slot of targets) {
    const side = existing?.[slot] ?? null;
    // The local slot creates its own entry from the raw patch (so "completed" can jump to the total).
    patches[slot] = side || slot === "local" ? normalized(input.patch, target.total) : patchBetween(null, wanted);
  }
  return applyPatches(target, patches, existing);
}

function normalized(patch: EntryPatch, total: number | null): EntryPatch {
  const state = applyPatch(NEW_ENTRY, patch, total);
  const out: EntryPatch = {};
  if (patch.status !== undefined) out.status = state.status;
  if (patch.progress !== undefined) out.progress = state.progress;
  if (patch.score !== undefined) out.score = state.score;
  return out;
}

/** "max" = most advanced of MAL / AniList. */
export type AlignSource = ServiceName | "max";

/** Copies one source's state (MAL, AniList, or the most advanced of both) onto the other. Anime only. */
export async function alignEntry(key: string, source: AlignSource): Promise<WriteResult> {
  const list = await getMergedList();
  const existing = findEntry(list, { key });
  const sourceService: ServiceName = source === "max" ? "mal" : source;
  if (!existing) throw new ServiceError(sourceService, 404, "Entrée introuvable");
  if (existing.kind !== "anime") throw new ServiceError(sourceService, 400, "Seuls les anime peuvent être alignés");

  const state: EntryState | null = source === "max" ? animeTruthState(existing) : existing[source];
  if (!state) throw new ServiceError(sourceService, 400, "Aucune donnée à copier");

  const ids = await completeIds(existing.malId, existing.anilistId, existing);
  const target = targetOf({ key }, existing, ids);
  const patches: PerSlotPatch = {};
  for (const service of ANIME_SERVICES) {
    if (source === service) continue;
    patches[service] = patchBetween(existing[service], state);
  }
  return applyPatches(target, patches, existing);
}

export async function removeEntry(input: EntryRef & { targets?: Slot[] }): Promise<WriteResult> {
  const list = await getMergedList();
  const existing = findEntry(list, input);
  const kind: MediaKind = existing?.kind ?? input.tmdb?.kind ?? "anime";
  const ids =
    kind === "anime"
      ? {
          malId: input.malId ?? existing?.malId ?? null,
          anilistId: input.anilistId ?? existing?.anilistId ?? null,
        }
      : { malId: null, anilistId: null };
  const target = targetOf(input, existing, ids);
  const allowed = defaultTargets(kind);
  const targets = (input.targets ?? allowed).filter((t) => allowed.includes(t));
  const connections = getConnectionInfos();

  const removeMal = async (): Promise<ServiceResult> => {
    if (!targets.includes("mal") || ids.malId === null || !connections.mal) return SKIPPED;
    await deleteMalEntry(ids.malId);
    return { ok: true, entry: null };
  };
  const removeAniList = async (): Promise<ServiceResult> => {
    if (!targets.includes("anilist") || ids.anilistId === null) return SKIPPED;
    if (!connections.anilist) return SKIPPED;
    const entryId = existing?.anilist?.entryId ?? (await findAniListEntryId(ids.anilistId));
    if (entryId === null) return { ok: true, entry: null };
    await deleteAniListEntry(entryId);
    return { ok: true, entry: null };
  };
  const removeLocal = async (): Promise<ServiceResult> => {
    if (!targets.includes("local") || target.kind === "anime" || target.tmdbId === null) return SKIPPED;
    // Nothing to remove when the entry is known and not tracked.
    if (existing ? existing.local === null : input.tmdb === undefined) return SKIPPED;
    removeLocalEntry({ kind: target.kind, tmdbId: target.tmdbId });
    return { ok: true, entry: null };
  };

  const [malResult, anilistResult, localResult] = await Promise.allSettled([
    removeMal(),
    removeAniList(),
    removeLocal(),
  ]);
  const mal = malResult.status === "fulfilled" ? malResult.value : failure(malResult.reason);
  const anilist = anilistResult.status === "fulfilled" ? anilistResult.value : failure(anilistResult.reason);
  const local = localResult.status === "fulfilled" ? localResult.value : failure(localResult.reason);

  if (existing) {
    const sources = globalForCache.__anisyncList?.payload.sources ?? NO_SOURCES;
    updateCachedEntry(existing, (entry) => {
      const next = withStates(
        entry,
        {
          ...(mal.ok && !mal.skipped ? { mal: null } : {}),
          ...(anilist.ok && !anilist.skipped ? { anilist: null } : {}),
          ...(local.ok && !local.skipped ? { local: null } : {}),
        },
        sources,
      );
      return next.mal || next.anilist || next.local ? next : null;
    });
  }

  return {
    key: target.key,
    malId: ids.malId,
    anilistId: ids.anilistId,
    tmdbId: target.tmdbId,
    mal,
    anilist,
    local,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type AnimeSearchResult = SearchResult & { kind: "anime"; key: string; inList: boolean };

export interface MediaSearchResult {
  kind: LocalKind;
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  cover: string | null;
  overview: string | null;
  key: string;
  inList: boolean;
}

export type AnnotatedSearchResult = AnimeSearchResult | MediaSearchResult;

export async function search(q: string, kind: MediaKind = "anime"): Promise<AnnotatedSearchResult[]> {
  if (kind !== "anime") return searchMedia(q, kind);

  const [results, list] = await Promise.all([searchAnime(q), getMergedList().catch(() => null)]);
  const malIds = new Set<number>();
  const anilistIds = new Set<number>();
  for (const e of list?.entries ?? []) {
    if (e.malId !== null && (e.mal || e.anilist)) malIds.add(e.malId);
    if (e.anilistId !== null && (e.mal || e.anilist)) anilistIds.add(e.anilistId);
  }
  return results.map((r) => ({
    ...r,
    kind: "anime" as const,
    key: entryKey(r.malId, r.anilistId),
    inList: anilistIds.has(r.anilistId) || (r.malId !== null && malIds.has(r.malId)),
  }));
}

async function searchMedia(q: string, kind: LocalKind): Promise<MediaSearchResult[]> {
  if (!isTmdbEnabled()) throw new ServiceError("tmdb", 400, "TMDB n'est pas configuré", "not_connected");
  const [hits, list] = await Promise.all([searchTmdb(q, kind), getMergedList().catch(() => null)]);
  const known = new Set<number>();
  for (const e of list?.entries ?? []) {
    if (e.kind === kind && e.tmdbId !== null && e.local) known.add(e.tmdbId);
  }
  return hits.map((hit) => ({
    kind,
    tmdbId: hit.tmdbId,
    title: hit.title,
    originalTitle: hit.originalTitle,
    year: hit.year,
    cover: tmdbPosterUrl(hit.posterPath),
    overview: hit.overview,
    key: tmdbKey(kind, hit.tmdbId),
    inList: known.has(hit.tmdbId),
  }));
}
