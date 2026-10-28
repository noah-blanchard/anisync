"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, type ListPayload } from "@/lib/client-api";
import { computeSync, type MergedEntry } from "@/lib/merge";

export const LIST_KEY = ["list"] as const;

export function useList() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () => api<ListPayload>("/api/list"),
    staleTime: 60_000,
  });
}

export function useEntry(key: string | null): MergedEntry | undefined {
  const { data } = useList();
  return key ? data?.entries.find((e) => e.key === key) : undefined;
}

/** Bypasses both caches (pull-to-refresh, refresh button). */
export function useRefreshList() {
  const qc = useQueryClient();
  return useCallback(async () => {
    const payload = await api<ListPayload>("/api/list?refresh=1");
    qc.setQueryData(LIST_KEY, payload);
    return payload;
  }, [qc]);
}

export function getEntry(qc: QueryClient, key: string): MergedEntry | undefined {
  return qc.getQueryData<ListPayload>(LIST_KEY)?.entries.find((e) => e.key === key);
}

/** Replaces one entry (or removes it when the updater returns null) and recomputes its sync fields. */
export function setEntry(qc: QueryClient, key: string, updater: (entry: MergedEntry) => MergedEntry | null): void {
  qc.setQueryData<ListPayload>(LIST_KEY, (payload) => {
    if (!payload) return payload;
    const entries: MergedEntry[] = [];
    for (const entry of payload.entries) {
      if (entry.key !== key) {
        entries.push(entry);
        continue;
      }
      const next = updater(entry);
      if (next) entries.push({ ...next, ...computeSync(next, payload.sources) });
    }
    return { ...payload, entries };
  });
}
