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
import { ServiceError, userMessage } from "./errors";
import { deleteMalEntry, fetchMalList, updateMalEntry } from "./mal";
import {
  applyPatch,
  isEmptyPatch,
  maxState,
  patchBetween,
  type EntryPatch,
  type EntryState,
  type ServiceName,
} from "./mapping";
import {
  computeSync,
  displayState,
  entryKey,
  mergeLists,
  unresolvedMalIds,
  type AniListListItem,
  type MalListItem,
  type MergedEntry,
} from "./merge";

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
  malId: number | null;
  anilistId: number | null;
  mal: ServiceResult;
  anilist: ServiceResult;
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
  const [malResult, anilistResult] = await Promise.allSettled([
    connections.mal ? fetchMalList() : Promise.resolve(null),
    connections.anilist ? fetchAniListList() : Promise.resolve(null),
  ]);

  const errors: ListPayload["errors"] = {};
  const mal: MalListItem[] | null = malResult.status === "fulfilled" ? malResult.value : null;
  const anilist: AniListListItem[] | null = anilistResult.status === "fulfilled" ? anilistResult.value : null;
  if (malResult.status === "rejected") errors.mal = userMessage(malResult.reason);
  if (anilistResult.status === "rejected") errors.anilist = userMessage(anilistResult.reason);

  // Remember every pair AniList gave us, then look up the MAL entries still unknown.
  if (anilist) {
    saveIdMappings(
      anilist.filter((a) => a.malId !== null).map((a) => ({ malId: a.malId as number, anilistId: a.anilistId })),
    );
  }
  let idMap = loadIdMap();
  if (mal && anilist) {
    const missing = unresolvedMalIds({ mal, anilist, idMap }).slice(0, MAX_RESOLVE_PER_LOAD);
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
    entries: mergeLists({ mal, anilist, idMap }),
    connections,
    sources: { mal: mal !== null, anilist: anilist !== null },
    errors,
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

function findEntry(payload: ListPayload, malId: number | null, anilistId: number | null): MergedEntry | undefined {
  return payload.entries.find(
    (e) => (malId !== null && e.malId === malId) || (anilistId !== null && e.anilistId === anilistId),
  );
}

/** Write-through update of the cached entry; anything unexpected drops the cache. */
function updateCachedEntry(
  malId: number | null,
  anilistId: number | null,
  update: (entry: MergedEntry) => MergedEntry | null,
): void {
  const cached = globalForCache.__anisyncList;
  if (!cached) return;
  const entry = findEntry(cached.payload, malId, anilistId);
  if (!entry) {
    invalidateList();
    return;
  }
  const next = update(entry);
  const entries = cached.payload.entries
    .map((e) => (e === entry ? next : e))
    .filter((e): e is MergedEntry => e !== null);
  cached.payload = { ...cached.payload, entries };
}

function withStates(entry: MergedEntry, states: Partial<Record<ServiceName, EntryState | null>>, sources: ListPayload["sources"]) {
  const next: MergedEntry = {
    ...entry,
    mal: states.mal !== undefined ? states.mal : entry.mal,
    anilist: states.anilist !== undefined ? states.anilist : entry.anilist,
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

/** Runs the given patches on both services in parallel and updates the cache. */
async function applyPatches(
  ids: { malId: number | null; anilistId: number | null },
  patches: PerServicePatch,
  existing: MergedEntry | undefined,
): Promise<WriteResult> {
  const connections = getConnectionInfos();

  const run = async (service: ServiceName): Promise<ServiceResult> => {
    const patch = patches[service];
    if (!patch) return SKIPPED;
    const id = service === "mal" ? ids.malId : ids.anilistId;
    if (id === null) return SKIPPED;
    if (!connections[service]) return SKIPPED;
    if (isEmptyPatch(patch)) return { ok: true, entry: existing?.[service] ?? null };
    const entry = service === "mal" ? await updateMalEntry(id, patch) : await saveAniListEntry(id, patch);
    return { ok: true, entry };
  };

  const [malResult, anilistResult] = await Promise.allSettled([run("mal"), run("anilist")]);
  const mal = malResult.status === "fulfilled" ? malResult.value : failure(malResult.reason);
  const anilist = anilistResult.status === "fulfilled" ? anilistResult.value : failure(anilistResult.reason);

  if (existing) {
    const states: Partial<Record<ServiceName, EntryState | null>> = {};
    if (mal.ok && !mal.skipped && mal.entry !== undefined) states.mal = mal.entry;
    if (anilist.ok && !anilist.skipped && anilist.entry !== undefined) states.anilist = anilist.entry;
    const sources = globalForCache.__anisyncList?.payload.sources ?? { mal: false, anilist: false };
    updateCachedEntry(ids.malId, ids.anilistId, (entry) => withStates(entry, states, sources));
  } else {
    invalidateList();
  }

  return { ...ids, mal, anilist };
}

const NEW_ENTRY: EntryState = { status: "plan_to_watch", progress: 0, score: 0, updatedAt: null, entryId: null };

/**
 * Applies a patch on both services (or on `targets` only).
 * Sides that already have the entry receive only the patch fields; a missing side
 * is created with the full state so both lists end up identical.
 */
export async function writeEntry(input: {
  malId: number | null;
  anilistId: number | null;
  patch: EntryPatch;
  targets?: ServiceName[];
}): Promise<WriteResult> {
  const list = await getMergedList();
  const existing = findEntry(list, input.malId, input.anilistId);
  const ids = await completeIds(input.malId, input.anilistId, existing);
  const total = existing?.totalEpisodes ?? null;
  const base = existing ? (displayState(existing) ?? NEW_ENTRY) : NEW_ENTRY;
  const target = applyPatch(base, input.patch, total);
  const targets = input.targets ?? ["mal", "anilist"];

  const patches: PerServicePatch = {};
  for (const service of targets) {
    const side = existing?.[service] ?? null;
    patches[service] = side ? normalized(input.patch, total) : patchBetween(null, target);
  }
  return applyPatches(ids, patches, existing);
}

function normalized(patch: EntryPatch, total: number | null): EntryPatch {
  const state = applyPatch(NEW_ENTRY, patch, total);
  const out: EntryPatch = {};
  if (patch.status !== undefined) out.status = state.status;
  if (patch.progress !== undefined) out.progress = state.progress;
  if (patch.score !== undefined) out.score = state.score;
  return out;
}

export type AlignSource = "mal" | "anilist" | "max";

export async function alignEntry(malId: number, source: AlignSource): Promise<WriteResult> {
  const list = await getMergedList();
  const existing = findEntry(list, malId, null);
  if (!existing) throw new ServiceError(source === "anilist" ? "anilist" : "mal", 404, "Entrée introuvable");

  let target: EntryState | null;
  if (source === "max") {
    target = existing.mal && existing.anilist ? maxState(existing.mal, existing.anilist) : displayState(existing);
  } else {
    target = existing[source];
  }
  if (!target) throw new ServiceError(source === "anilist" ? "anilist" : "mal", 400, "Aucune donnée à copier");

  const ids = await completeIds(existing.malId, existing.anilistId, existing);
  const patches: PerServicePatch = {};
  for (const service of ["mal", "anilist"] as const) {
    if (source === service) continue;
    patches[service] = patchBetween(existing[service], target);
  }
  return applyPatches(ids, patches, existing);
}

export async function removeEntry(input: {
  malId: number | null;
  anilistId: number | null;
  targets?: ServiceName[];
}): Promise<WriteResult> {
  const list = await getMergedList();
  const existing = findEntry(list, input.malId, input.anilistId);
  const ids = { malId: input.malId ?? existing?.malId ?? null, anilistId: input.anilistId ?? existing?.anilistId ?? null };
  const targets = input.targets ?? ["mal", "anilist"];
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

  const [malResult, anilistResult] = await Promise.allSettled([removeMal(), removeAniList()]);
  const mal = malResult.status === "fulfilled" ? malResult.value : failure(malResult.reason);
  const anilist = anilistResult.status === "fulfilled" ? anilistResult.value : failure(anilistResult.reason);

  const sources = globalForCache.__anisyncList?.payload.sources ?? { mal: false, anilist: false };
  updateCachedEntry(ids.malId, ids.anilistId, (entry) => {
    const next = withStates(
      entry,
      { ...(mal.ok && !mal.skipped ? { mal: null } : {}), ...(anilist.ok && !anilist.skipped ? { anilist: null } : {}) },
      sources,
    );
    return next.mal || next.anilist ? next : null;
  });

  return { ...ids, mal, anilist };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface AnnotatedSearchResult extends SearchResult {
  key: string;
  inList: boolean;
}

export async function search(q: string): Promise<AnnotatedSearchResult[]> {
  const [results, list] = await Promise.all([searchAnime(q), getMergedList().catch(() => null)]);
  const malIds = new Set<number>();
  const anilistIds = new Set<number>();
  for (const e of list?.entries ?? []) {
    if (e.malId !== null && (e.mal || e.anilist)) malIds.add(e.malId);
    if (e.anilistId !== null && (e.mal || e.anilist)) anilistIds.add(e.anilistId);
  }
  return results.map((r) => ({
    ...r,
    key: entryKey(r.malId, r.anilistId),
    inList: anilistIds.has(r.anilistId) || (r.malId !== null && malIds.has(r.malId)),
  }));
}
