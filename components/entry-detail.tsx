"use client";

import { CalendarClockIcon, ExternalLinkIcon, MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import * as React from "react";
import { Cover, ProgressBar, SyncBadges, TickNumber } from "@/components/entry-bits";
import { useOverlay } from "@/components/overlay-context";
import { ScorePicker, StatusPicker } from "@/components/pickers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useEntryActions } from "@/hooks/use-entry-actions";
import { accentStyle } from "@/lib/color";
import { formatLabel, nextAiringLabel, scoreLabel, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { normalizeTotal, type EntryState, type ServiceName } from "@/lib/mapping";
import { displayState, type MergedEntry } from "@/lib/merge";

export function serviceUrl(service: ServiceName, entry: Pick<MergedEntry, "malId" | "anilistId">): string | null {
  if (service === "mal") return entry.malId ? `https://myanimelist.net/anime/${entry.malId}` : null;
  return entry.anilistId ? `https://anilist.co/anime/${entry.anilistId}` : null;
}

function ServiceRow({ service, entry, state }: { service: ServiceName; entry: MergedEntry; state: EntryState | null }) {
  const url = serviceUrl(service, entry);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="font-medium">{SERVICE_LABELS[service]}</div>
        <div className="truncate text-muted-foreground tabular-nums">
          {state
            ? `${STATUS_LABELS[state.status]} · Ép. ${state.progress} · ${scoreLabel(state.score)}`
            : "Absent de la liste"}
        </div>
      </div>
      {url && (
        <Button variant="ghost" size="icon" asChild>
          <a href={url} target="_blank" rel="noreferrer" aria-label={`Ouvrir sur ${SERVICE_LABELS[service]}`}>
            <ExternalLinkIcon />
          </a>
        </Button>
      )}
    </div>
  );
}

export function EntryDetail({ entry }: { entry: MergedEntry }) {
  const { open, close } = useOverlay();
  const actions = useEntryActions(entry.key);
  const state = displayState(entry);
  const total = normalizeTotal(entry.totalEpisodes);
  const progress = state?.progress ?? 0;
  const airing = nextAiringLabel(entry.nextAiring);
  const meta = [formatLabel(entry.format), total ? `${total} épisodes` : "Épisodes inconnus"].filter(Boolean).join(" · ");

  return (
    <div className="entry-accent flex flex-col gap-6 p-5 lg:p-6" style={accentStyle(entry.color)}>
      <div className="flex gap-4 pr-8">
        <Cover src={entry.cover} alt="" className="w-24 rounded-xl" sizes="96px" />
        <div className="flex min-w-0 flex-col gap-1.5 pt-1">
          <h2 className="text-lg leading-snug font-semibold">{entry.title}</h2>
          {entry.englishTitle && entry.englishTitle !== entry.title && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{entry.englishTitle}</p>
          )}
          <p className="text-xs text-muted-foreground">{meta}</p>
          <SyncBadges entry={entry} onCompare={() => open({ type: "compare", key: entry.key })} />
        </div>
      </div>

      <section aria-label="Progression" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="icon-lg"
            className="rounded-2xl"
            onClick={actions.decrement}
            disabled={!state || progress <= 0}
            aria-label={`Retirer un épisode à ${entry.title}`}
          >
            <MinusIcon />
          </Button>
          <div className="text-center">
            <div className="text-3xl font-semibold tracking-tight">
              <TickNumber value={progress} />
              <span className="text-muted-foreground tabular-nums"> / {total ?? "?"}</span>
            </div>
            <div className="text-xs text-muted-foreground">épisodes vus</div>
          </div>
          <button
            type="button"
            onClick={actions.increment}
            disabled={!state || (total !== null && progress >= total)}
            aria-label={`Ajouter un épisode à ${entry.title}`}
            className="inline-flex size-11 items-center justify-center rounded-2xl bg-entry-accent text-background transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:active:scale-90 disabled:opacity-40"
          >
            <PlusIcon className="size-5" strokeWidth={2.5} />
          </button>
        </div>
        <ProgressBar value={progress} total={total} className="h-1.5" />
        {airing && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarClockIcon className="size-4" aria-hidden />
            {airing}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="text-sm font-medium text-muted-foreground">Statut</h3>
        <StatusPicker value={state?.status ?? null} onChange={actions.setStatus} />
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="text-sm font-medium text-muted-foreground">
          Note <span className="tabular-nums">({scoreLabel(state?.score ?? 0)})</span>
        </h3>
        <ScorePicker value={state?.score ?? 0} onChange={actions.setScore} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">Services</h3>
        {entry.availability !== "anilist_only" && <ServiceRow service="mal" entry={entry} state={entry.mal} />}
        {entry.availability !== "mal_only" && <ServiceRow service="anilist" entry={entry} state={entry.anilist} />}
        {!entry.inSync && (
          <Button variant="outline" onClick={() => open({ type: "compare", key: entry.key })}>
            Comparer et aligner
          </Button>
        )}
      </section>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={actions.removing}>
            <Trash2Icon />
            Supprimer de ma liste
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {entry.title} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              L&apos;entrée sera retirée de MyAnimeList et d&apos;AniList, avec ta progression et ta note.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                actions.remove({});
                close();
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
