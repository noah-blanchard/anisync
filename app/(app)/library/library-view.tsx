"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { PageHeader } from "@/components/app-shell";
import { ENTRY_GRID, EntryCard } from "@/components/entry-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/list-states";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useList } from "@/hooks/use-list";
import { useStableOrder } from "@/hooks/use-stable-order";
import type { CanonicalStatus } from "@/lib/mapping";
import { displayState, type MergedEntry } from "@/lib/merge";

const TABS: { id: string; label: string; statuses: CanonicalStatus[] }[] = [
  { id: "watching", label: "En cours", statuses: ["watching", "rewatching"] },
  { id: "completed", label: "Terminés", statuses: ["completed"] },
  { id: "on_hold", label: "En pause", statuses: ["on_hold"] },
  { id: "dropped", label: "Abandonnés", statuses: ["dropped"] },
  { id: "plan_to_watch", label: "À voir", statuses: ["plan_to_watch"] },
];

type Sort = "updated" | "title" | "score";

const SORTERS: Record<Sort, (a: MergedEntry, b: MergedEntry) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  title: (a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }),
  score: (a, b) => (displayState(b)?.score ?? 0) - (displayState(a)?.score ?? 0) || a.title.localeCompare(b.title, "fr"),
};

function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function LibraryView() {
  const { data, isPending, error, refetch } = useList();
  const params = useSearchParams();
  const [tab, setTab] = React.useState("watching");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<Sort>("updated");
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (params.get("focus") === "search") searchRef.current?.focus();
  }, [params]);

  const counts = React.useMemo(() => {
    const result: Record<string, number> = {};
    for (const t of TABS) result[t.id] = 0;
    for (const entry of data?.entries ?? []) {
      const status = displayState(entry)?.status;
      const t = TABS.find((x) => status && x.statuses.includes(status));
      if (t) result[t.id] = (result[t.id] ?? 0) + 1;
    }
    return result;
  }, [data]);

  const filtered = React.useMemo(() => {
    const statuses = TABS.find((t) => t.id === tab)?.statuses ?? [];
    const q = normalize(query.trim());
    return (data?.entries ?? [])
      .filter((e) => {
        const status = displayState(e)?.status;
        if (!status || !statuses.includes(status)) return false;
        if (!q) return true;
        return normalize(`${e.title} ${e.englishTitle ?? ""}`).includes(q);
      })
      .sort(SORTERS[sort]);
  }, [data, tab, query, sort]);

  const ordered = useStableOrder(filtered, `${data?.fetchedAt}|${tab}|${query}|${sort}`);

  return (
    <>
      <PageHeader title="Bibliothèque" subtitle={data ? `${data.entries.length} entrées au total` : " "} />

      <div className="mb-5 flex flex-col gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Statut">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
                <span className="text-xs text-muted-foreground tabular-nums">{counts[t.id] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <div className="relative flex-1 md:max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              data-search-input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer par titre"
              aria-label="Filtrer par titre"
              className="pr-10 pl-10"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Effacer le filtre"
                className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger aria-label="Trier par" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="updated">Mise à jour</SelectItem>
              <SelectItem value="title">Titre</SelectItem>
              <SelectItem value="score">Note</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isPending ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : ordered.length === 0 ? (
        <EmptyState
          title={query ? "Aucun résultat" : "Rien ici"}
          description={query ? "Essaie un autre titre." : undefined}
          cta={query ? undefined : { href: "/add", label: "Ajouter un anime" }}
        />
      ) : (
        <div className={ENTRY_GRID}>
          {ordered.map((entry) => (
            <EntryCard key={entry.key} entry={entry} />
          ))}
        </div>
      )}
    </>
  );
}
