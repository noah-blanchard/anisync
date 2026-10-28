"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { BoosterCard } from "@/lib/booster";
import { api, type WriteResult } from "@/lib/client-api";
import type { ServiceName } from "@/lib/mapping";
import { reportResult, useAddEntry } from "./use-entry-actions";
import { LIST_KEY } from "./use-list";

// ---------------------------------------------------------------------------
// Preferences (per device, like the theme)
// ---------------------------------------------------------------------------

const PREF_EVENT = "anisync:booster-pref";

function readPref(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function subscribePrefs(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREF_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREF_EVENT, onChange);
  };
}

function usePref(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribePrefs, () => readPref(key, fallback), () => fallback);
  const setValue = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Private mode: the choice lasts for this page only.
      }
      window.dispatchEvent(new Event(PREF_EVENT));
    },
    [key],
  );
  return [value, setValue];
}

/** Unlocks the Ecchi and Hentai boosters. */
export const useBoosterAdult = () => usePref("anisync-booster-adult", false);

/** Blurs hentai covers until the card is tapped. On by default. */
export const useBoosterBlur = () => usePref("anisync-booster-blur", true);

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

/** Decoded covers are kept referenced until the next pack so the browser does not evict them. */
let decoded: HTMLImageElement[] = [];

/** Resolves once every cover is decoded (or after a timeout), so a card never flips onto an empty frame. */
export function preloadCovers(urls: string[], timeoutMs = 8000): Promise<void> {
  const images = urls.map((url) => {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    return img;
  });
  decoded = [...decoded, ...images].slice(-15);
  const all = Promise.all(images.map((img) => img.decode().catch(() => undefined)));
  return Promise.race([all.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/** Each opened pack consumes a round of its booster, so coming back always shows a fresh pack. */
const rounds = new Map<string, number>();
export const currentRound = (pack: string) => rounds.get(pack) ?? 0;
export const consumeRound = (pack: string) => {
  rounds.set(pack, currentRound(pack) + 1);
  return currentRound(pack);
};

export function boosterQuery(pack: string, packRound: number, adult: boolean) {
  return {
    queryKey: ["booster", pack, packRound] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ pack, ...(adult ? { adult: "1" } : {}) });
      const { cards } = await api<{ cards: BoosterCard[] }>(`/api/booster?${params}`);
      await preloadCovers(cards.map((c) => c.cover));
      return cards;
    },
    staleTime: Infinity,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  };
}

export function usePrefetchBooster() {
  const qc = useQueryClient();
  return useCallback(
    (pack: string, packRound: number, adult: boolean) => void qc.prefetchQuery(boosterQuery(pack, packRound, adult)),
    [qc],
  );
}

// ---------------------------------------------------------------------------
// Swipes
// ---------------------------------------------------------------------------

export type Decision = "added" | "skipped";

function logSwipe(card: BoosterCard, decision: Decision | null) {
  const init: RequestInit =
    decision === null
      ? { method: "DELETE", body: JSON.stringify({ anilistId: card.anilistId }) }
      : { method: "POST", body: JSON.stringify({ anilistId: card.anilistId, decision, rarity: card.rarity }) };
  // Best effort: losing one log line only means the card may come back in a later pack.
  void api("/api/booster/swipes", { ...init, keepalive: true }).catch(() => undefined);
}

/**
 * Right swipe = add as "À voir" on both services through the regular add flow (errors and retries
 * included), without waiting: the card is already gone. Undo removes it again once the add settled.
 */
export function useBoosterSwipes() {
  const qc = useQueryClient();
  const add = useAddEntry({ quiet: true });
  const pending = useRef(new Map<number, Promise<WriteResult | null>>());

  const remove = useMutation<WriteResult, Error, { card: BoosterCard; targets?: ServiceName[] }>({
    mutationFn: ({ card, targets }) =>
      api<WriteResult>("/api/entry", {
        method: "DELETE",
        body: JSON.stringify({ malId: card.malId, anilistId: card.anilistId, targets }),
      }),
    onSuccess: (result, vars) => {
      reportResult(result, (targets) => remove.mutate({ ...vars, targets }), "Annulation");
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (error, vars) =>
      toast.error(`Annulation impossible : ${error.message}`, {
        action: { label: "Réessayer", onClick: () => remove.mutate(vars) },
      }),
  });

  const { mutateAsync } = add;
  const decide = useCallback(
    (card: BoosterCard, decision: Decision) => {
      logSwipe(card, decision);
      if (decision !== "added") return;
      pending.current.set(
        card.anilistId,
        mutateAsync({ target: card, status: "plan_to_watch" }).catch(() => null),
      );
    },
    [mutateAsync],
  );

  const { mutate: removeEntry } = remove;
  const undo = useCallback(
    async (card: BoosterCard, decision: Decision) => {
      logSwipe(card, null);
      if (decision !== "added") return;
      const result = await pending.current.get(card.anilistId);
      pending.current.delete(card.anilistId);
      const written = result && (["mal", "anilist"] as const).some((s) => result[s].ok && !result[s].skipped);
      if (written) removeEntry({ card });
    },
    [removeEntry],
  );

  return { decide, undo };
}
