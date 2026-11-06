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
import { useList } from "@/hooks/use-list";
import {
  episodeCode,
  formatLabel,
  KIND_LABELS,
  nextAiringLabel,
  scoreLabel,
  SERVICE_LABELS,
  simklUrl,
  STATUS_LABELS,
} from "@/lib/labels";
import { normalizeTotal, statusesForKind, type EntryState, type ServiceName } from "@/lib/mapping";
import { displayState, type MergedEntry } from "@/lib/merge";

const SERVICE_NAMES: Record<ServiceName, string> = { mal: "MyAnimeList", anilist: "AniList", simkl: "Simkl" };

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

export function serviceUrl(
  service: ServiceName,
  entry: Pick<MergedEntry, "malId" | "anilistId" | "simklId" | "kind">,
): string | null {
  if (service === "simkl") return entry.simklId ? simklUrl(entry.kind, entry.simklId) : null;
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
            ? [
                STATUS_LABELS[state.status],
                entry.kind === "movie" ? null : `Ép. ${state.progress}`,
                scoreLabel(state.score),
              ]
                .filter(Boolean)
                .join(" · ")
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
  const { data } = useList();
  const isMovie = entry.kind === "movie";
  const isShow = entry.kind === "show";
  const simklConnected = Boolean(data?.connections.simkl);
  const meta = (
    isMovie
      ? [KIND_LABELS.movie, entry.year]
      : isShow
        ? [KIND_LABELS.show, entry.year, total ? `${total} épisodes` : "Épisodes inconnus"]
        : [formatLabel(entry.format), entry.year, total ? `${total} épisodes` : "Épisodes inconnus"]
  )
    .filter(Boolean)
    .join(" · ");
  const watched = state?.status === "completed";
  const canIncrement = isShow
    ? state !== null && entry.nextEpisode !== null && state.status !== "completed"
    : state !== null && !(total !== null && progress >= total);
  // Services that actually hold this entry: they are the ones a deletion concerns.
  const concerned = (["mal", "anilist", "simkl"] as const).filter((s) => entry[s] !== null);

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
        {isMovie ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{watched ? "Vu" : "Pas vu"}</div>
              <div className="text-xs text-muted-foreground">{entry.year ?? "Film"}</div>
            </div>
            <Button
              variant={watched ? "outline" : "default"}
              size="lg"
              className="rounded-2xl"
              aria-pressed={watched}
              disabled={!state}
              onClick={() => actions.setStatus(watched ? "plan_to_watch" : "completed")}
            >
              {watched ? "Marquer comme pas vu" : "Marquer comme vu"}
            </Button>
          </div>
        ) : (
          <>
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
                disabled={!canIncrement}
                aria-label={`Ajouter un épisode à ${entry.title}`}
                className="inline-flex size-11 items-center justify-center rounded-2xl bg-entry-accent text-background transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:active:scale-90 disabled:opacity-40"
              >
                <PlusIcon className="size-5" strokeWidth={2.5} />
              </button>
            </div>
            <ProgressBar value={progress} total={total} className="h-1.5" />
          </>
        )}
        {isShow && (
          <p className="text-sm text-muted-foreground">
            {entry.nextEpisode ? (
              <>
                Prochain épisode :{" "}
                <span className="font-medium text-foreground">
                  {episodeCode(entry.nextEpisode)}
                  {entry.nextEpisode.title ? ` · ${entry.nextEpisode.title}` : ""}
                </span>
              </>
            ) : state?.status === "completed" ? (
              "Série terminée"
            ) : (
              "À jour : aucun épisode à voir pour l'instant"
            )}
          </p>
        )}
        {airing && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarClockIcon className="size-4" aria-hidden />
            {airing}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="text-sm font-medium text-muted-foreground">Statut</h3>
        <StatusPicker value={state?.status ?? null} onChange={actions.setStatus} statuses={statusesForKind(entry.kind)} />
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="text-sm font-medium text-muted-foreground">
          Note <span className="tabular-nums">({scoreLabel(state?.score ?? 0)})</span>
        </h3>
        <ScorePicker value={state?.score ?? 0} onChange={actions.setScore} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">Services</h3>
        {entry.kind === "anime" && entry.availability !== "anilist_only" && entry.malId !== null && (
          <ServiceRow service="mal" entry={entry} state={entry.mal} />
        )}
        {entry.kind === "anime" && entry.availability !== "mal_only" && entry.anilistId !== null && (
          <ServiceRow service="anilist" entry={entry} state={entry.anilist} />
        )}
        {(entry.kind !== "anime" || simklConnected || entry.simkl !== null) && (
          <ServiceRow service="simkl" entry={entry} state={entry.simkl} />
        )}
        {entry.kind === "anime" && !entry.inSync && (
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
              L&apos;entrée sera retirée de {joinNames(concerned.map((s) => SERVICE_NAMES[s]))}, avec ta progression et
              ta note.
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
