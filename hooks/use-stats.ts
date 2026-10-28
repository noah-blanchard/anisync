"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, ApiError } from "@/lib/client-api";
import type { StatsPayload } from "@/lib/stats/types";

/** No user = my own list; otherwise a public AniList profile. */
export const statsKey = (user?: string) => ["stats", user?.toLowerCase() ?? null] as const;

function statsUrl(user: string | undefined, refresh = false): string {
  const base = user ? `/api/stats/user/${encodeURIComponent(user)}` : "/api/stats";
  return refresh ? `${base}?refresh=1` : base;
}

/** Silver rows of a list; polls while AniList metadata is still being fetched. */
export function useStats(user?: string) {
  return useQuery({
    queryKey: statsKey(user),
    queryFn: () => api<StatsPayload>(statsUrl(user)),
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.pending ? 4_000 : false),
    // An unknown or private profile will not change by retrying.
    retry: (count, error) => !(error instanceof ApiError && [400, 403, 404].includes(error.status)) && count < 2,
  });
}

/** Bypasses the server caches (lists, raw lists and stats). */
export function useRefreshStats(user?: string) {
  const qc = useQueryClient();
  return useCallback(async () => {
    const payload = await api<StatsPayload>(statsUrl(user, true));
    qc.setQueryData(statsKey(user), payload);
    return payload;
  }, [qc, user]);
}
