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
  type ServiceName,
} from "@/lib/mapping";
import { displayState, type MergedEntry } from "@/lib/merge";
import { getEntry, LIST_KEY, setEntry } from "./use-list";

const SERVICES: ServiceName[] = ["mal", "anilist"];
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
  if (service === "mal") return entry.malId !== null;
  return entry.availability !== "mal_only" && (entry.anilistId !== null || entry.malId !== null);
}

function optimistic(entry: MergedEntry, vars: WriteVars, sources: ListPayload["sources"]): MergedEntry {
  const base = displayState(entry) ?? NEW_STATE;
  const next = { ...entry };
  for (const service of vars.targets ?? SERVICES) {
    if (!writable(entry, service, sources)) continue;
    next[service] = { ...applyPatch(entry[service] ?? base, vars.patch, entry.totalEpisodes), updatedAt: Date.now() };
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

export interface AddTarget {
  anilistId: number;
  malId: number | null;
  title: string;
}

export interface AddVars {
  target: AddTarget;
  status: CanonicalStatus;
  targets?: ServiceName[];
}

/** Adds an anime that is not in the list yet (search results, booster cards) on both services. */
export function useAddEntry({ onAdded, quiet = false }: { onAdded?: (vars: AddVars) => void; quiet?: boolean } = {}) {
  const qc = useQueryClient();
  const add = useMutation<WriteResult, Error, AddVars>({
    mutationFn: ({ target, status, targets }) =>
      api<WriteResult>("/api/entry", {
        method: "POST",
        body: JSON.stringify({
          malId: target.malId ?? undefined,
          anilistId: target.anilistId,
          patch: { status },
          targets,
        }),
      }),
    onSuccess: (res, vars) => {
      const ok = reportResult(res, (targets) => add.mutate({ ...vars, targets }), `Ajout de ${vars.target.title}`);
      if (res.mal.ok || res.anilist.ok) {
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
        body: JSON.stringify({
          malId: entry?.malId ?? undefined,
          anilistId: entry?.anilistId ?? undefined,
          patch: vars.patch,
          targets: vars.targets,
        }),
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
    },
    onError: (error, vars, ctx) => {
      if (ctx?.prev) setEntry(qc, key, () => ctx.prev ?? null);
      toast.error(`Mise à jour impossible : ${error instanceof ApiError ? error.message : "erreur inattendue"}`, {
        action: { label: "Réessayer", onClick: () => write.mutate(vars) },
      });
    },
  });

  const align = useMutation<WriteResult, Error, { source: "mal" | "anilist" | "max" }, Snapshot>({
    scope,
    mutationFn: ({ source }) => {
      const entry = getEntry(qc, key);
      return api<WriteResult>("/api/entry/align", {
        method: "POST",
        body: JSON.stringify({ malId: entry?.malId, source }),
      });
    },
    onMutate: () => ({ prev: getEntry(qc, key) }),
    onSuccess: (result, vars, ctx) => {
      reconcile(qc, key, result, ctx?.prev);
      if (reportResult(result, () => align.mutate(vars), "Alignement")) toast.success("Entrée alignée sur les deux services");
    },
    onError: (error) => toast.error(`Alignement impossible : ${error.message}`),
  });

  const remove = useMutation<WriteResult, Error, { targets?: ServiceName[] }, Snapshot>({
    scope,
    mutationFn: ({ targets }) => {
      const entry = getEntry(qc, key);
      return api<WriteResult>("/api/entry", {
        method: "DELETE",
        body: JSON.stringify({ malId: entry?.malId ?? undefined, anilistId: entry?.anilistId ?? undefined, targets }),
      });
    },
    onMutate: () => ({ prev: getEntry(qc, key) }),
    onSuccess: (result, vars) => {
      setEntry(qc, key, (entry) => {
        const next = { ...entry };
        for (const service of SERVICES) if (result[service].ok && !result[service].skipped) next[service] = null;
        return next.mal || next.anilist ? next : null;
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
      if (!entry || !state) return;
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
