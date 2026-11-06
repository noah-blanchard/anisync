"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { useOverlay } from "@/components/overlay-context";
import { api, ApiError, type ListPayload, type WriteResult } from "@/lib/client-api";
import { SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import {
  applyPatch,
  buildStepPatch,
  reachedEnd,
  type CanonicalStatus,
  type EntryPatch,
  type EntryState,
  type MediaKind,
  type ServiceName,
} from "@/lib/mapping";
import { displayState, type MergedEntry } from "@/lib/merge";
import { getEntry, LIST_KEY, setEntry } from "./use-list";

const SERVICES: ServiceName[] = ["mal", "anilist", "simkl"];
const NEW_STATE: EntryState = { status: "plan_to_watch", progress: 0, score: 0, updatedAt: null, entryId: null };

interface WriteVars {
  patch: EntryPatch;
  targets?: ServiceName[];
}

interface Snapshot {
  prev: MergedEntry | undefined;
}

/** Whether a write on `service` will actually be attempted for this entry. */
function writable(entry: MergedEntry, service: ServiceName, sources: ListPayload["sources"]): boolean {
  if (!sources[service]) return false;
  // Shows and movies only exist on Simkl.
  if (entry.kind !== "anime") return service === "simkl";
  if (service === "simkl") return entry.simklId !== null || entry.malId !== null || entry.anilistId !== null;
  if (service === "mal") return entry.malId !== null;
  return entry.availability !== "mal_only" && (entry.anilistId !== null || entry.malId !== null);
}

/** Body fields identifying the entry for the server (key first, ids as fallback). */
function identity(entry: MergedEntry | undefined, key: string) {
  return {
    key,
    malId: entry?.malId ?? undefined,
    anilistId: entry?.anilistId ?? undefined,
    simkl: entry && entry.simklId !== null ? { id: entry.simklId, kind: entry.kind } : undefined,
  };
}

function optimistic(entry: MergedEntry, vars: WriteVars, sources: ListPayload["sources"]): MergedEntry {
  const base = displayState(entry) ?? NEW_STATE;
  const next = { ...entry };
  for (const service of vars.targets ?? SERVICES) {
    if (!writable(entry, service, sources)) continue;
    const applied = applyPatch(entry[service] ?? base, vars.patch, entry.totalEpisodes);
    // A movie is either watched (1) or not (0).
    if (entry.kind === "movie" && vars.patch.status !== undefined) applied.progress = vars.patch.status === "completed" ? 1 : 0;
    next[service] = { ...applied, updatedAt: Date.now() };
  }
  return next;
}

/** Applies the per-service result: server state on success, previous state on failure or skip. */
function reconcile(qc: QueryClient, key: string, result: WriteResult, prev: MergedEntry | undefined) {
  setEntry(qc, key, (entry) => {
    const next: MergedEntry = {
      ...entry,
      malId: entry.malId ?? result.malId,
      anilistId: entry.anilistId ?? result.anilistId,
      simklId: entry.simklId ?? result.simklId,
    };
    for (const service of SERVICES) {
      const r = result[service];
      if (r.ok && !r.skipped) next[service] = r.entry !== undefined ? r.entry : entry[service];
      else next[service] = prev ? prev[service] : entry[service];
    }
    return next;
  });
}

function failedServices(result: WriteResult): ServiceName[] {
  return SERVICES.filter((s) => !result[s].ok);
}

function succeededServices(result: WriteResult): ServiceName[] {
  return SERVICES.filter((s) => result[s].ok && !result[s].skipped);
}

/** "MAL ✓ / AniList ✗ : raison" with a retry limited to the failed side. */
export function reportResult(result: WriteResult, retry: (targets: ServiceName[]) => void, verb = "Mise à jour"): boolean {
  const failed = failedServices(result);
  if (failed.length === 0) return true;
  const reason = failed.map((s) => result[s].error).find(Boolean) ?? "erreur inconnue";
  const ok = succeededServices(result);
  const message =
    ok.length > 0
      ? `${ok.map((s) => `${SERVICE_LABELS[s]} ✓`).join(" / ")} / ${failed.map((s) => `${SERVICE_LABELS[s]} ✗`).join(" / ")} : ${reason}`
      : `${verb} impossible (${failed.map((s) => SERVICE_LABELS[s]).join(", ")}) : ${reason}`;
  toast.error(message, { action: { label: "Réessayer", onClick: () => retry(failed) }, duration: 8000 });
  return false;
}

export interface AnimeAddTarget {
  anilistId: number;
  malId: number | null;
  title: string;
}

/** A show or movie found through the Simkl search. */
export interface SimklAddTarget {
  kind: MediaKind;
  simklId: number;
  title: string;
}

export type AddTarget = AnimeAddTarget | SimklAddTarget;

export interface AddVars {
  target: AddTarget;
  status: CanonicalStatus;
  targets?: ServiceName[];
}

/** Adds a title that is not in the list yet (search results, booster cards) on every relevant service. */
export function useAddEntry({ onAdded, quiet = false }: { onAdded?: (vars: AddVars) => void; quiet?: boolean } = {}) {
  const qc = useQueryClient();
  const add = useMutation<WriteResult, Error, AddVars>({
    mutationFn: ({ target, status, targets }) =>
      api<WriteResult>("/api/entry", {
        method: "POST",
        body: JSON.stringify(
          "simklId" in target
            ? { simkl: { id: target.simklId, kind: target.kind }, patch: { status }, targets }
            : { malId: target.malId ?? undefined, anilistId: target.anilistId, patch: { status }, targets },
        ),
      }),
    onSuccess: (res, vars) => {
      const ok = reportResult(res, (targets) => add.mutate({ ...vars, targets }), `Ajout de ${vars.target.title}`);
      if (succeededServices(res).length > 0) {
        onAdded?.(vars);
        void qc.invalidateQueries({ queryKey: LIST_KEY });
        void qc.invalidateQueries({ queryKey: ["search"] });
      }
      if (ok && !quiet) toast.success(`${vars.target.title} ajouté (${STATUS_LABELS[vars.status]})`);
    },
    onError: (error, vars) =>
      toast.error(`Ajout de ${vars.target.title} impossible : ${error.message}`, {
        action: { label: "Réessayer", onClick: () => add.mutate(vars) },
      }),
  });
  return add;
}

export function useEntryActions(key: string) {
  const qc = useQueryClient();
  const { open } = useOverlay();
  const scope = { id: `entry:${key}` };

  const write = useMutation<WriteResult, Error, WriteVars, Snapshot>({
    scope,
    mutationFn: async (vars) => {
      const entry = getEntry(qc, key);
      return api<WriteResult>("/api/entry", {
        method: "POST",
        body: JSON.stringify({ ...identity(entry, key), patch: vars.patch, targets: vars.targets }),
      });
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const payload = qc.getQueryData<ListPayload>(LIST_KEY);
      const prev = getEntry(qc, key);
      if (payload && prev) setEntry(qc, key, (entry) => optimistic(entry, vars, payload.sources));
      return { prev };
    },
    onSuccess: (result, vars, ctx) => {
      reconcile(qc, key, result, ctx?.prev);
      reportResult(result, (targets) => write.mutate({ ...vars, targets }));
      // Shows: Simkl decides the next / last episode, so reload the list.
      const kind = ctx?.prev?.kind ?? getEntry(qc, key)?.kind;
      if (kind && kind !== "anime" && result.simkl.ok && !result.simkl.skipped) {
        void qc.invalidateQueries({ queryKey: LIST_KEY });
      }
    },
    onError: (error, vars, ctx) => {
      if (ctx?.prev) setEntry(qc, key, () => ctx.prev ?? null);
      toast.error(`Mise à jour impossible : ${error instanceof ApiError ? error.message : "erreur inattendue"}`, {
        action: { label: "Réessayer", onClick: () => write.mutate(vars) },
      });
    },
  });

  const align = useMutation<WriteResult, Error, { source: "mal" | "anilist" | "simkl" | "max" }, Snapshot>({
    scope,
    mutationFn: ({ source }) => {
      const entry = getEntry(qc, key);
      return api<WriteResult>("/api/entry/align", {
        method: "POST",
        body: JSON.stringify({ key: entry?.key ?? key, source }),
      });
    },
    onMutate: () => ({ prev: getEntry(qc, key) }),
    onSuccess: (result, vars, ctx) => {
      reconcile(qc, key, result, ctx?.prev);
      if (reportResult(result, () => align.mutate(vars), "Alignement")) toast.success("Entrée alignée");
    },
    onError: (error) => toast.error(`Alignement impossible : ${error.message}`),
  });

  const remove = useMutation<WriteResult, Error, { targets?: ServiceName[] }, Snapshot>({
    scope,
    mutationFn: ({ targets }) => {
      const entry = getEntry(qc, key);
      return api<WriteResult>("/api/entry", {
        method: "DELETE",
        body: JSON.stringify({ ...identity(entry, key), targets }),
      });
    },
    onMutate: () => ({ prev: getEntry(qc, key) }),
    onSuccess: (result, vars) => {
      setEntry(qc, key, (entry) => {
        const next = { ...entry };
        for (const service of SERVICES) if (result[service].ok && !result[service].skipped) next[service] = null;
        return next.mal || next.anilist || next.simkl ? next : null;
      });
      if (reportResult(result, (targets) => remove.mutate({ ...vars, targets }), "Suppression")) {
        toast.success("Supprimé de ta liste");
      }
    },
    onError: (error) => toast.error(`Suppression impossible : ${error.message}`),
  });

  const update = useCallback((patch: EntryPatch, targets?: ServiceName[]) => write.mutate({ patch, targets }), [write]);

  const step = useCallback(
    (delta: 1 | -1) => {
      const entry = getEntry(qc, key);
      const state = entry ? displayState(entry) : null;
      if (!entry || !state || entry.kind === "movie") return;
      // Shows move one episode at a time, and only when Simkl knows the next one.
      if (entry.kind === "show" && delta > 0 && !entry.nextEpisode) return;
      if (entry.kind === "show" && delta < 0 && !entry.lastEpisode) return;
      const patch = buildStepPatch(state, entry.totalEpisodes, delta);
      if (!patch) return;
      write.mutate({ patch });
      const next = applyPatch(state, patch, entry.totalEpisodes);
      if (delta > 0 && reachedEnd(next, entry.totalEpisodes)) {
        toast(`Dernier épisode de ${entry.title} !`, {
          id: `complete-${key}`,
          action: { label: "Marquer comme terminé", onClick: () => open({ type: "complete", key }) },
          duration: 10_000,
        });
      }
    },
    [qc, key, write, open],
  );

  return {
    increment: useCallback(() => step(1), [step]),
    decrement: useCallback(() => step(-1), [step]),
    setStatus: useCallback((status: CanonicalStatus) => update({ status }), [update]),
    setScore: useCallback((score: number) => update({ score }), [update]),
    update,
    align: align.mutate,
    aligning: align.isPending,
    remove: remove.mutate,
    removing: remove.isPending,
  };
}
