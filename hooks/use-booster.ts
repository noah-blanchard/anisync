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
// Preference: adult content in packs (per device, like the theme)
// ---------------------------------------------------------------------------

const ADULT_KEY = "anisync-booster-adult";
const ADULT_EVENT = "anisync:booster-adult";

function readAdult(): boolean {
  try {
    return localStorage.getItem(ADULT_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeAdult(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(ADULT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(ADULT_EVENT, onChange);
  };
}

export function useBoosterAdult(): [boolean, (value: boolean) => void] {
  const adult = useSyncExternalStore(subscribeAdult, readAdult, () => false);
  const setAdult = useCallback((value: boolean) => {
    try {
      localStorage.setItem(ADULT_KEY, value ? "1" : "0");
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    window.dispatchEvent(new Event(ADULT_EVENT));
  }, []);
  return [adult, setAdult];
}

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

/** Each opened pack consumes a round, so coming back to the page always shows a fresh pack. */
let round = 0;
export const currentRound = () => round;
export const consumeRound = () => ++round;

export function boosterQuery(packRound: number, adult: boolean) {
  return {
    queryKey: ["booster", packRound, adult] as const,
    queryFn: async () => {
      const { cards } = await api<{ cards: BoosterCard[] }>(`/api/booster${adult ? "?adult=1" : ""}`);
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
    (packRound: number, adult: boolean) => void qc.prefetchQuery(boosterQuery(packRound, adult)),
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
