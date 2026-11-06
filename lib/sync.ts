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
import { isSimklEnabled } from "./env";
import { ServiceError, userMessage } from "./errors";
import { deleteMalEntry, fetchMalList, updateMalEntry } from "./mal";
import {
  ALL_SERVICES,
  applyPatch,
  diffWithSimkl,
  isEmptyPatch,
  patchBetween,
  type EntryPatch,
  type EntryState,
  type MediaKind,
  type ServiceName,
} from "./mapping";
import {
  animeTruthState,
  computeSync,
  displayState,
  entryKey,
  mergeLists,
  simklKey,
  unresolvedMalIds,
  type AniListListItem,
  type MalListItem,
  type MergedEntry,
  type SimklListItem,
} from "./merge";
import { fetchSimklList, invalidateSimklCache, removeSimklEntry, saveSimklEntry, searchSimkl } from "./simkl";
import type { SimklWriteTarget } from "./simkl-payloads";

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
  /** Simkl is configured (client id set), whether or not it is connected */
  simklEnabled: boolean;
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
  simklId: number | null;
  mal: ServiceResult;
  anilist: ServiceResult;
  simkl: ServiceResult;
}

/** How a request designates an entry: its key first, then ids (needed for items not in the list yet). */
export interface EntryRef {
  key?: string;
  malId?: number | null;
  anilistId?: number | null;
  simkl?: { id: number; kind: MediaKind };
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
  const simklEnabled = isSimklEnabled();
  const [malResult, anilistResult, simklResult] = await Promise.allSettled([
    connections.mal ? fetchMalList() : Promise.resolve(null),
    connections.anilist ? fetchAniListList() : Promise.resolve(null),
    connections.simkl && simklEnabled ? fetchSimklList() : Promise.resolve(null),
  ]);

  const errors: ListPayload["errors"] = {};
  const mal: MalListItem[] | null = malResult.status === "fulfilled" ? malResult.value : null;
  const anilist: AniListListItem[] | null = anilistResult.status === "fulfilled" ? anilistResult.value : null;
  const simkl: SimklListItem[] | null = simklResult.status === "fulfilled" ? simklResult.value : null;
  if (malResult.status === "rejected") errors.mal = userMessage(malResult.reason);
  if (simklResult.status === "rejected") errors.simkl = userMessage(simklResult.reason);
  if (anilistResult.status === "rejected") errors.anilist = userMessage(anilistResult.reason);

  // Remember every pair AniList gave us, then look up the MAL entries still unknown.
  if (anilist) {
    saveIdMappings(
      anilist.filter((a) => a.malId !== null).map((a) => ({ malId: a.malId as number, anilistId: a.anilistId })),
    );
  }
  let idMap = loadIdMap();
  if (mal && anilist) {
    const missing = unresolvedMalIds({ mal, anilist, simkl, idMap }).slice(0, MAX_RESOLVE_PER_LOAD);
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
    entries: mergeLists({ mal, anilist, simkl, idMap }),
    connections,
    sources: { mal: mal !== null, anilist: anilist !== null, simkl: simkl !== null },
    errors,
    simklEnabled,
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
      (ref.simkl !== undefined && e.simklId === ref.simkl.id && e.kind === ref.simkl.kind),
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

const NO_SOURCES: Record<ServiceName, boolean> = { mal: false, anilist: false, simkl: false };

function withStates(entry: MergedEntry, states: Partial<Record<ServiceName, EntryState | null>>, sources: ListPayload["sources"]) {
  const next: MergedEntry = {
    ...entry,
    mal: states.mal !== undefined ? states.mal : entry.mal,
    anilist: states.anilist !== undefined ? states.anilist : entry.anilist,
    simkl: states.simkl !== undefined ? states.simkl : entry.simkl,
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

type PerServicePatch = Partial<Record<ServiceName, EntryPatch>>;

/** Everything needed to address one entry on the three services. */
interface WriteTarget {
  key: string;
  kind: MediaKind;
  malId: number | null;
  anilistId: number | null;
  simklId: number | null;
  total: number | null;
  nextEpisode: SimklWriteTarget["nextEpisode"];
  lastEpisode: SimklWriteTarget["lastEpisode"];
}

function keyFor(kind: MediaKind, malId: number | null, anilistId: number | null, simklId: number | null): string {
  if (kind !== "anime" && simklId !== null) return simklKey(kind, simklId);
  if (malId === null && anilistId === null && simklId !== null) return simklKey("anime", simklId);
  return entryKey(malId, anilistId);
}

function defaultTargets(kind: MediaKind): ServiceName[] {
  return kind === "anime" ? [...ALL_SERVICES] : ["simkl"];
}

function simklWriteTarget(target: WriteTarget): SimklWriteTarget {
  return {
    kind: target.kind,
    simklId: target.simklId,
    malId: target.malId,
    anilistId: target.anilistId,
    nextEpisode: target.nextEpisode,
    lastEpisode: target.lastEpisode,
  };
}

function refreshCaches(target: WriteTarget, simklTouched: boolean): void {
  if (simklTouched) invalidateSimklCache();
  // Shows and movies depend on Simkl's next_to_watch: reload the merged list next time.
  if (simklTouched && target.kind !== "anime") invalidateList();
}

/** Runs the given patches on the three services in parallel and updates the cache. */
async function applyPatches(
  target: WriteTarget,
  patches: PerServicePatch,
  existing: MergedEntry | undefined,
): Promise<WriteResult> {
  const connections = getConnectionInfos();
  const simklUsable = connections.simkl !== null && isSimklEnabled();

  const run = async (service: ServiceName): Promise<ServiceResult> => {
    const patch = patches[service];
    if (!patch) return SKIPPED;
    if (!connections[service]) return SKIPPED;
    if (service === "simkl" && !simklUsable) return SKIPPED;
    if (service === "mal" && target.malId === null) return SKIPPED;
    if (service === "anilist" && target.anilistId === null) return SKIPPED;
    if (isEmptyPatch(patch)) return { ok: true, entry: existing?.[service] ?? null };
    if (service === "mal" && target.malId !== null) return { ok: true, entry: await updateMalEntry(target.malId, patch) };
    if (service === "anilist" && target.anilistId !== null) {
      return { ok: true, entry: await saveAniListEntry(target.anilistId, patch) };
    }
    return {
      ok: true,
      entry: await saveSimklEntry(simklWriteTarget(target), existing?.simkl ?? null, patch, target.total),
    };
  };

  // Simkl calls are slow (one POST per 1.1 s) but independent from MAL / AniList: run all in parallel.
  const [malResult, anilistResult, simklResult] = await Promise.allSettled([run("mal"), run("anilist"), run("simkl")]);
  const mal = malResult.status === "fulfilled" ? malResult.value : failure(malResult.reason);
  const anilist = anilistResult.status === "fulfilled" ? anilistResult.value : failure(anilistResult.reason);
  const simkl = simklResult.status === "fulfilled" ? simklResult.value : failure(simklResult.reason);

  const simklTouched = patches.simkl !== undefined && !simkl.skipped;
  refreshCaches(target, simklTouched);

  if (existing) {
    const states: Partial<Record<ServiceName, EntryState | null>> = {};
    if (mal.ok && !mal.skipped && mal.entry !== undefined) states.mal = mal.entry;
    if (anilist.ok && !anilist.skipped && anilist.entry !== undefined) states.anilist = anilist.entry;
    if (simkl.ok && !simkl.skipped && simkl.entry !== undefined) states.simkl = simkl.entry;
    const sources = globalForCache.__anisyncList?.payload.sources ?? NO_SOURCES;
    updateCachedEntry(existing, (entry) => withStates(entry, states, sources));
  } else {
    invalidateList();
  }

  return {
    key: target.key,
    malId: target.malId,
    anilistId: target.anilistId,
    simklId: target.simklId,
    mal,
    anilist,
    simkl,
  };
}

const NEW_ENTRY: EntryState = { status: "plan_to_watch", progress: 0, score: 0, updatedAt: null, entryId: null };

function targetOf(
  ref: EntryRef,
  existing: MergedEntry | undefined,
  ids: { malId: number | null; anilistId: number | null },
): WriteTarget {
  const kind: MediaKind = existing?.kind ?? ref.simkl?.kind ?? "anime";
  const simklId = existing?.simklId ?? ref.simkl?.id ?? null;
  return {
    key: existing?.key ?? keyFor(kind, ids.malId, ids.anilistId, simklId),
    kind,
    malId: ids.malId,
    anilistId: ids.anilistId,
    simklId,
    total: existing?.totalEpisodes ?? null,
    nextEpisode: existing?.nextEpisode ?? null,
    lastEpisode: existing?.lastEpisode ?? null,
  };
}

/**
 * Applies a patch on every service (or on `targets` only).
 * Sides that already have the entry receive only the patch fields; a missing side
 * is created with the full state so all lists end up identical.
 * Shows and movies only ever live on Simkl.
 */
export async function writeEntry(input: EntryRef & { patch: EntryPatch; targets?: ServiceName[] }): Promise<WriteResult> {
  const list = await getMergedList();
  const existing = findEntry(list, input);
  const kind: MediaKind = existing?.kind ?? input.simkl?.kind ?? "anime";
  const ids =
    kind === "anime"
      ? await completeIds(input.malId ?? null, input.anilistId ?? null, existing)
      : { malId: null, anilistId: null };
  const target = targetOf(input, existing, ids);
  const base = existing ? (displayState(existing) ?? NEW_ENTRY) : NEW_ENTRY;
  const wanted = applyPatch(base, input.patch, target.total);
  const allowed = defaultTargets(kind);
  const targets = (input.targets ?? allowed).filter((t) => allowed.includes(t));

  const patches: PerServicePatch = {};
  for (const service of targets) {
    const side = existing?.[service] ?? null;
    patches[service] = side ? normalized(input.patch, target.total) : patchBetween(null, wanted);
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

/** "max" = most advanced of MAL / AniList. Simkl is never a source for anime. */
export type AlignSource = Exclude<ServiceName, "simkl"> | "max";

/** Drops a status change that only differs by watching / rewatching (Simkl has no rewatching). */
function withoutEquivalentStatus(current: EntryState | null, target: EntryState, patch: EntryPatch): EntryPatch {
  if (!current || patch.status === undefined) return patch;
  if (diffWithSimkl(current, target).includes("status")) return patch;
  const { status: _status, ...rest } = patch;
  return rest;
}

/**
 * Copies one source's state (MAL, AniList, or the most advanced of both) onto the others. Anime only.
 * Simkl only ever receives the result (mirror): it is never read as a source.
 */
export async function alignEntry(key: string, source: AlignSource | "simkl"): Promise<WriteResult> {
  if (source === "simkl") throw new ServiceError("simkl", 400, "Simkl ne peut pas servir de source pour un anime");
  const list = await getMergedList();
  const existing = findEntry(list, { key });
  const sourceService: ServiceName = source === "max" ? "mal" : source;
  if (!existing) throw new ServiceError(sourceService, 404, "Entrée introuvable");
  if (existing.kind !== "anime") throw new ServiceError("simkl", 400, "Seuls les anime peuvent être alignés");

  const state: EntryState | null = source === "max" ? animeTruthState(existing) : existing[source];
  if (!state) throw new ServiceError(sourceService, 400, "Aucune donnée à copier");

  const ids = await completeIds(existing.malId, existing.anilistId, existing);
  const target = targetOf({ key }, existing, ids);
  const patches: PerServicePatch = {};
  for (const service of ALL_SERVICES) {
    if (source === service) continue;
    const patch = patchBetween(existing[service], state);
    patches[service] = service === "simkl" ? withoutEquivalentStatus(existing[service], state, patch) : patch;
  }
  return applyPatches(target, patches, existing);
}

export async function removeEntry(input: EntryRef & { targets?: ServiceName[] }): Promise<WriteResult> {
  const list = await getMergedList();
  const existing = findEntry(list, input);
  const kind: MediaKind = existing?.kind ?? input.simkl?.kind ?? "anime";
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
  const removeSimkl = async (): Promise<ServiceResult> => {
    if (!targets.includes("simkl") || !connections.simkl || !isSimklEnabled()) return SKIPPED;
    // Nothing to remove when the entry is known and absent from Simkl.
    if (existing ? existing.simkl === null : input.simkl === undefined) return SKIPPED;
    await removeSimklEntry(simklWriteTarget(target));
    return { ok: true, entry: null };
  };

  const [malResult, anilistResult, simklResult] = await Promise.allSettled([removeMal(), removeAniList(), removeSimkl()]);
  const mal = malResult.status === "fulfilled" ? malResult.value : failure(malResult.reason);
  const anilist = anilistResult.status === "fulfilled" ? anilistResult.value : failure(anilistResult.reason);
  const simkl = simklResult.status === "fulfilled" ? simklResult.value : failure(simklResult.reason);

  refreshCaches(target, !simkl.skipped);

  if (existing) {
    const sources = globalForCache.__anisyncList?.payload.sources ?? NO_SOURCES;
    updateCachedEntry(existing, (entry) => {
      const next = withStates(
        entry,
        {
          ...(mal.ok && !mal.skipped ? { mal: null } : {}),
          ...(anilist.ok && !anilist.skipped ? { anilist: null } : {}),
          ...(simkl.ok && !simkl.skipped ? { simkl: null } : {}),
        },
        sources,
      );
      return next.mal || next.anilist || next.simkl ? next : null;
    });
  }

  return {
    key: target.key,
    malId: ids.malId,
    anilistId: ids.anilistId,
    simklId: target.simklId,
    mal,
    anilist,
    simkl,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type AnimeSearchResult = SearchResult & { kind: "anime"; key: string; inList: boolean };

export interface SimklSearchResult {
  kind: "show" | "movie";
  simklId: number;
  title: string;
  year: number | null;
  cover: string | null;
  totalEpisodes: number | null;
  key: string;
  inList: boolean;
}

export type AnnotatedSearchResult = AnimeSearchResult | SimklSearchResult;

export async function search(q: string, kind: MediaKind = "anime"): Promise<AnnotatedSearchResult[]> {
  if (kind !== "anime") return searchSimklTitles(q, kind);

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

async function searchSimklTitles(q: string, kind: "show" | "movie"): Promise<SimklSearchResult[]> {
  if (!getConnectionInfos().simkl || !isSimklEnabled()) {
    throw new ServiceError("simkl", 400, "Simkl n'est pas connecté", "not_connected");
  }
  const [hits, list] = await Promise.all([searchSimkl(q, kind), getMergedList().catch(() => null)]);
  const known = new Set<number>();
  for (const e of list?.entries ?? []) {
    if (e.kind === kind && e.simklId !== null && e.simkl) known.add(e.simklId);
  }
  return hits.map((hit) => ({
    kind,
    simklId: hit.simklId,
    title: hit.title,
    year: hit.year,
    cover: hit.cover,
    totalEpisodes: hit.totalEpisodes,
    key: simklKey(kind, hit.simklId),
    inList: known.has(hit.simklId),
  }));
}
