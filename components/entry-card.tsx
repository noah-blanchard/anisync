"use client";

import { CalendarClockIcon, PlusIcon } from "lucide-react";
import * as React from "react";
import { Cover, ProgressBar, SyncBadges, TickNumber } from "@/components/entry-bits";
import { useOverlay } from "@/components/overlay-context";
import { useEntryActions } from "@/hooks/use-entry-actions";
import { accentStyle } from "@/lib/color";
import { nextAiringLabel, STATUS_LABELS } from "@/lib/labels";
import { normalizeTotal } from "@/lib/mapping";
import { displayState, type MergedEntry } from "@/lib/merge";
import { cn } from "@/lib/utils";

function PlusOneButton({
  entry,
  onClick,
  disabled,
  className,
}: {
  entry: MergedEntry;
  onClick: () => void;
  disabled: boolean;
  className?: string;
}) {
  const [popping, setPopping] = React.useState(0);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setPopping((n) => n + 1);
        onClick();
      }}
      disabled={disabled}
      aria-label={`Ajouter un épisode à ${entry.title}`}
      className={cn(
        "relative z-10 inline-flex shrink-0 items-center justify-center gap-0.5 rounded-2xl bg-entry-accent font-semibold text-background tabular-nums transition-[transform,opacity] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:active:scale-90 disabled:opacity-40",
        className,
      )}
    >
      <span key={popping} className={cn("inline-flex items-center gap-0.5", popping > 0 && "motion-safe:animate-pop")}>
        <PlusIcon className="size-4" strokeWidth={3} aria-hidden />1
      </span>
    </button>
  );
}

export function EntryCard({ entry, priority = false }: { entry: MergedEntry; priority?: boolean }) {
  const { open } = useOverlay();
  const actions = useEntryActions(entry.key);
  const state = displayState(entry);
  const total = normalizeTotal(entry.totalEpisodes);
  const progress = state?.progress ?? 0;
  const atEnd = total !== null && progress >= total;
  const airing = nextAiringLabel(entry.nextAiring);
  const canIncrement = state !== null && !atEnd && state.status !== "completed";

  const openDetail = () => open({ type: "detail", key: entry.key });

  return (
    <article
      className="entry-accent group relative flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5 transition-colors hover:border-foreground/15 md:flex-col md:items-stretch md:gap-0 md:p-0"
      style={accentStyle(entry.color)}
      onKeyDown={(e) => {
        if ((e.key === "+" || e.key === "=") && canIncrement) {
          e.preventDefault();
          actions.increment();
        } else if (e.key === "-" && progress > 0) {
          e.preventDefault();
          actions.decrement();
        }
      }}
    >
      {/* Stretched button: the whole card opens the detail, +1 and badges sit above it. */}
      <button
        type="button"
        onClick={openDetail}
        aria-label={`Ouvrir ${entry.title}`}
        aria-keyshortcuts="+"
        className="absolute inset-0 z-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      <Cover
        src={entry.cover}
        alt=""
        priority={priority}
        className="pointer-events-none w-16 rounded-xl md:w-full md:rounded-t-2xl md:rounded-b-none"
      />

      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-1.5 md:p-3">
        <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold md:min-h-[2lh] md:text-sm">{entry.title}</h3>

        <div className="flex items-baseline gap-2 text-sm text-muted-foreground">
          <span className="text-foreground">
            Ép. <TickNumber value={progress} className="font-semibold" />
            <span className="tabular-nums"> / {total ?? "?"}</span>
          </span>
          {state && state.status !== "watching" && (
            <span className="truncate text-xs">{STATUS_LABELS[state.status]}</span>
          )}
        </div>

        <ProgressBar value={progress} total={total} />

        <div className="flex min-h-6 items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {airing && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarClockIcon className="size-3.5" aria-hidden />
                {airing}
              </span>
            )}
            <SyncBadges entry={entry} onCompare={() => open({ type: "compare", key: entry.key })} />
          </div>
          <PlusOneButton
            entry={entry}
            onClick={actions.increment}
            disabled={!canIncrement}
            className="pointer-events-auto hidden h-10 px-3.5 text-sm md:inline-flex"
          />
        </div>
      </div>

      <PlusOneButton
        entry={entry}
        onClick={actions.increment}
        disabled={!canIncrement}
        className="size-14 text-base md:hidden"
      />
    </article>
  );
}

export function EntryCardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5 md:flex-col md:items-stretch md:p-0">
      <div className="aspect-[2/3] w-16 shrink-0 rounded-xl bg-muted motion-safe:animate-pulse md:w-full md:rounded-b-none md:rounded-t-2xl" />
      <div className="flex flex-1 flex-col gap-2 md:p-3">
        <div className="h-4 w-3/4 rounded-md bg-muted motion-safe:animate-pulse" />
        <div className="h-3 w-1/3 rounded-md bg-muted motion-safe:animate-pulse" />
        <div className="h-1 w-full rounded-full bg-muted" />
        <div className="hidden h-10 w-16 self-end rounded-2xl bg-muted motion-safe:animate-pulse md:block" />
      </div>
      <div className="size-14 shrink-0 rounded-2xl bg-muted motion-safe:animate-pulse md:hidden" />
    </div>
  );
}

export const ENTRY_GRID = "grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
