"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import type { MediaKind } from "@/lib/mapping";
import type { MergedEntry } from "@/lib/merge";
import { cn } from "@/lib/utils";

export type KindFilterValue = "all" | MediaKind;

const STORAGE_KEY = "anisync:kind";

const OPTIONS: { id: KindFilterValue; label: string }[] = [
  { id: "all", label: "Tout" },
  { id: "anime", label: "Anime" },
  { id: "show", label: "Séries" },
  { id: "movie", label: "Films" },
];

function parseKind(value: string | null | undefined): KindFilterValue | null {
  return value === "all" || value === "anime" || value === "show" || value === "movie" ? value : null;
}

function readStored(): KindFilterValue | null {
  try {
    return parseKind(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(value: KindFilterValue) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage can be blocked (private mode): the URL still carries the choice.
  }
}

export function matchesKind(entry: Pick<MergedEntry, "kind">, kind: KindFilterValue): boolean {
  return kind === "all" || entry.kind === kind;
}

export function countKinds(entries: readonly Pick<MergedEntry, "kind">[]): Record<KindFilterValue, number> {
  const counts: Record<KindFilterValue, number> = { all: entries.length, anime: 0, show: 0, movie: 0 };
  for (const entry of entries) counts[entry.kind]++;
  return counts;
}

/**
 * Kind filter state: `?kind=` wins, then the last choice kept in localStorage, then "all".
 * Always "all" when the filter is not available (no TMDB key and no show or movie tracked).
 */
export function useKindFilter(available: boolean): [KindFilterValue, (value: KindFilterValue) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [stored, setStored] = React.useState<KindFilterValue | null>(null);

  // Read after mount so server and first client render agree.
  React.useEffect(() => setStored(readStored()), []);

  const fromUrl = parseKind(params.get("kind"));
  const value: KindFilterValue = available ? (fromUrl ?? stored ?? "all") : "all";

  const setValue = React.useCallback(
    (next: KindFilterValue) => {
      writeStored(next);
      setStored(next);
      const query = new URLSearchParams(params.toString());
      query.set("kind", next);
      router.replace(`${pathname}?${query.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  return [value, setValue];
}

/** Tout / Anime / Séries / Films chips with counts. */
export function KindFilter({
  value,
  onChange,
  counts,
  className,
}: {
  value: KindFilterValue;
  onChange: (value: KindFilterValue) => void;
  counts?: Partial<Record<KindFilterValue, number>>;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Type de média" className={cn("no-scrollbar flex gap-1.5 overflow-x-auto", className)}>
      {OPTIONS.map(({ id, label }) => {
        const active = value === id;
        const count = counts?.[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(id)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:active:scale-95",
              active
                ? "border-transparent bg-primary/15 text-foreground ring-1 ring-primary/50"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
