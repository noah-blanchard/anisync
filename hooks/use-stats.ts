"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/client-api";
import type { StatsPayload } from "@/lib/stats/types";

export const STATS_KEY = ["stats"] as const;

/** Silver rows of my list; polls while AniList metadata is still being fetched. */
export function useStats() {
  return useQuery({
    queryKey: STATS_KEY,
    queryFn: () => api<StatsPayload>("/api/stats"),
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.pending ? 4_000 : false),
  });
}

/** Bypasses the server caches (list, raw lists and stats). */
export function useRefreshStats() {
  const qc = useQueryClient();
  return useCallback(async () => {
    const payload = await api<StatsPayload>("/api/stats?refresh=1");
    qc.setQueryData(STATS_KEY, payload);
    return payload;
  }, [qc]);
}
