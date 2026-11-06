"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, PlusIcon, SearchIcon } from "lucide-react";
import * as React from "react";
import { PageHeader } from "@/components/app-shell";
import { Cover } from "@/components/entry-bits";
import { EmptyState } from "@/components/list-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAddEntry } from "@/hooks/use-entry-actions";
import { useList } from "@/hooks/use-list";
import { api, type AnnotatedSearchResult } from "@/lib/client-api";
import { accentStyle } from "@/lib/color";
import { episodesLabel, formatLabel, KIND_LABELS, STATUS_LABELS } from "@/lib/labels";
import { statusesForKind, type CanonicalStatus, type MediaKind } from "@/lib/mapping";
import { cn } from "@/lib/utils";

type AnimeResult = Extract<AnnotatedSearchResult, { kind: "anime" }>;
type SimklResult = Exclude<AnnotatedSearchResult, { kind: "anime" }>;

const KIND_OPTIONS: { id: MediaKind; label: string; placeholder: string; noun: string }[] = [
  { id: "anime", label: "Anime", placeholder: "Titre d'un anime…", noun: "un anime" },
  { id: "show", label: "Séries", placeholder: "Titre d'une série…", noun: "une série" },
  { id: "movie", label: "Films", placeholder: "Titre d'un film…", noun: "un film" },
];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function AnimeResultCard({ result }: { result: AnimeResult }) {
  const [status, setStatus] = React.useState<CanonicalStatus>("plan_to_watch");
  const [added, setAdded] = React.useState(false);
  const add = useAddEntry({ onAdded: () => setAdded(true) });

  const inList = result.inList || added;
  const meta = [result.year, formatLabel(result.format), episodesLabel(result.totalEpisodes)].filter(Boolean).join(" · ");

  return (
    <li
      className="entry-accent flex gap-3 rounded-2xl border border-border bg-card p-2.5 md:flex-col md:p-0"
      style={accentStyle(result.color)}
    >
      <Cover
        src={result.cover}
        alt=""
        className="w-20 rounded-xl md:w-full md:rounded-t-2xl md:rounded-b-none"
        glow={false}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:p-3 md:pt-0">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold md:min-h-[2lh]">{result.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {inList && (
            <Badge variant="success">
              <CheckIcon aria-hidden />
              Déjà dans ta liste
            </Badge>
          )}
          {result.malId === null && <Badge variant="secondary">AniList uniquement</Badge>}
        </div>
        {!inList && (
          <div className="mt-auto flex gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as CanonicalStatus)}>
              <SelectTrigger aria-label={`Statut pour ${result.title}`} className="h-10 min-w-0 flex-1 px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusesForKind("anime").filter((s) => s !== "rewatching").map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="h-10"
              onClick={() => add.mutate({ target: result, status })}
              disabled={add.isPending}
              aria-label={`Ajouter ${result.title}`}
            >
              {add.isPending ? <Loader2Icon className="motion-safe:animate-spin" /> : <PlusIcon />}
              Ajouter
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function SimklResultCard({ result }: { result: SimklResult }) {
  const [status, setStatus] = React.useState<CanonicalStatus>("plan_to_watch");
  const [added, setAdded] = React.useState(false);
  const add = useAddEntry({ onAdded: () => setAdded(true) });

  const inList = result.inList || added;
  const meta = [
    KIND_LABELS[result.kind],
    result.year,
    result.kind === "show" && result.totalEpisodes ? episodesLabel(result.totalEpisodes) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="entry-accent flex gap-3 rounded-2xl border border-border bg-card p-2.5 md:flex-col md:p-0" style={accentStyle(null)}>
      <Cover
        src={result.cover}
        alt=""
        className="w-20 rounded-xl md:w-full md:rounded-t-2xl md:rounded-b-none"
        glow={false}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:p-3 md:pt-0">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold md:min-h-[2lh]">{result.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
        </div>
        {inList && (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="success">
              <CheckIcon aria-hidden />
              Déjà dans ta liste
            </Badge>
          </div>
        )}
        {!inList && (
          <div className="mt-auto flex gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as CanonicalStatus)}>
              <SelectTrigger aria-label={`Statut pour ${result.title}`} className="h-10 min-w-0 flex-1 px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusesForKind(result.kind)
                  .filter((s) => s !== "rewatching")
                  .map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              className="h-10"
              onClick={() =>
                add.mutate({ target: { kind: result.kind, simklId: result.simklId, title: result.title }, status })
              }
              disabled={add.isPending}
              aria-label={`Ajouter ${result.title}`}
            >
              {add.isPending ? <Loader2Icon className="motion-safe:animate-spin" /> : <PlusIcon />}
              Ajouter
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function AddView() {
  const { data: list } = useList();
  const simklConnected = Boolean(list?.connections.simkl);
  const [chosen, setChosen] = React.useState<MediaKind>("anime");
  // Without Simkl only the anime search exists.
  const kind: MediaKind = simklConnected ? chosen : "anime";
  const option = KIND_OPTIONS.find((o) => o.id === kind) ?? KIND_OPTIONS[0]!;
  const [query, setQuery] = React.useState("");
  const debounced = useDebounced(query.trim(), 300);
  const enabled = debounced.length >= 2;

  const { data, isFetching, error } = useQuery({
    queryKey: ["search", kind, debounced],
    queryFn: () => api<{ results: AnnotatedSearchResult[] }>(`/api/search?q=${encodeURIComponent(debounced)}&kind=${kind}`),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <PageHeader
        title="Ajouter"
        subtitle={
          simklConnected
            ? "Anime : recherche AniList, ajout sur tes services. Séries et films : recherche Simkl."
            : "Recherche sur AniList, ajout sur MAL et AniList."
        }
      />
      {simklConnected && (
        <div role="radiogroup" aria-label="Type de média" className="mb-4 flex gap-1.5">
          {KIND_OPTIONS.map(({ id, label }) => {
            const active = kind === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setChosen(id)}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:active:scale-95",
                  active
                    ? "border-transparent bg-primary/15 text-foreground ring-1 ring-primary/50"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div className="relative mb-6 md:max-w-xl">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-search-input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={option.placeholder}
          aria-label={`Rechercher ${option.noun}`}
          className="pl-10"
        />
        {isFetching && (
          <Loader2Icon
            className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground motion-safe:animate-spin"
            aria-label="Recherche en cours"
          />
        )}
      </div>

      {!enabled ? (
        <EmptyState title="Que veux-tu regarder ?" description="Tape au moins 2 caractères pour lancer la recherche." />
      ) : error ? (
        <EmptyState title="Recherche impossible" description={error.message} />
      ) : !data ? (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex gap-3 rounded-2xl border border-border bg-card p-2.5 md:flex-col md:p-0">
              <div className="aspect-[2/3] w-20 rounded-xl bg-muted motion-safe:animate-pulse md:w-full md:rounded-b-none" />
              <div className="flex flex-1 flex-col gap-2 md:p-3">
                <div className="h-4 w-3/4 rounded-md bg-muted motion-safe:animate-pulse" />
                <div className="h-3 w-1/2 rounded-md bg-muted motion-safe:animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      ) : data.results.length === 0 ? (
        <EmptyState title="Aucun résultat" description={kind === "anime" ? "Essaie le titre romaji ou anglais." : "Essaie le titre original ou anglais."} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {data.results.map((result) =>
            result.kind === "anime" ? (
              <AnimeResultCard key={result.key} result={result} />
            ) : (
              <SimklResultCard key={result.key} result={result} />
            ),
          )}
        </ul>
      )}
    </>
  );
}
