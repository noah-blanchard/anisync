"use client";

import { InfoIcon, ListIcon, LoaderCircleIcon, RefreshCwIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { EmptyState, ErrorState } from "@/components/list-states";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { ActiveFilters, FilterSheet } from "@/components/stats/filters";
import { TitlesSheet, type Selection } from "@/components/stats/titles-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useList } from "@/hooks/use-list";
import { useRefreshStats, useStats } from "@/hooks/use-stats";
import { activeFilterCount, applyFilters, tasteRows, type StatsFilters } from "@/lib/stats/gold";
import { mergeFilters, parseStatsParams, statsSearch, type StatsTab } from "@/lib/stats/url";
import { cn } from "@/lib/utils";
import { BacklogTab } from "./backlog-tab";
import { CatalogTab } from "./catalog-tab";
import { OverviewTab } from "./overview-tab";
import { ProfileTab } from "./profile-tab";
import { ScoresTab } from "./scores-tab";
import { TastesTab } from "./tastes-tab";
import { TimeTab } from "./time-tab";

const TABS: { id: StatsTab; label: string }[] = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "time", label: "Temps" },
  { id: "tastes", label: "Goûts" },
  { id: "scores", label: "Notes" },
  { id: "catalog", label: "Catalogue" },
  { id: "backlog", label: "Backlog" },
  { id: "profile", label: "Profil" },
];

export function StatsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement" className="flex flex-col gap-4">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-10 w-full max-w-xl rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-3xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-3xl" />
    </div>
  );
}

function Notice({ tone, icon, children }: { tone: "info" | "warning"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm",
        tone === "warning" ? "border-warning/30 bg-warning/10" : "border-border bg-card",
      )}
    >
      <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", tone === "warning" ? "text-warning" : "text-muted-foreground")}>{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StatsView() {
  const { data, isPending, error, refetch } = useStats();
  // The detail overlay reads entries from the list cache.
  useList();
  const refreshStats = useRefreshStats();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  // The URL is the source of truth (back / forward, shared links), mirrored locally so quick successive
  // changes build on each other instead of on a URL that has not updated yet.
  const url = params.toString();
  const [state, setState] = React.useState(() => ({ url, ...parseStatsParams(new URLSearchParams(url)) }));
  if (state.url !== url) setState({ url, ...parseStatsParams(new URLSearchParams(url)) });
  const { filters, tab } = state;

  const navigate = React.useCallback(
    (nextFilters: StatsFilters, nextTab: StatsTab) => {
      setState((prev) => ({ url: prev.url, filters: nextFilters, tab: nextTab }));
      router.replace(`${pathname}${statsSearch(nextFilters, nextTab)}`, { scroll: false });
    },
    [router, pathname],
  );
  const setFilters = React.useCallback((next: StatsFilters) => navigate(next, tab), [navigate, tab]);
  const setTab = React.useCallback((next: StatsTab) => navigate(filters, next), [navigate, filters]);

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshStats();
    } catch {
      toast.error("Actualisation impossible");
    } finally {
      setRefreshing(false);
    }
  }, [refreshStats]);

  const rows = React.useMemo(() => data?.rows ?? [], [data]);
  const filtered = React.useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const taste = React.useMemo(() => tasteRows(filtered, filters), [filtered, filters]);
  const filterCount = activeFilterCount(filters);
  const withoutMeta = rows.filter((r) => !r.hasMeta).length;

  if (isPending) return <StatsSkeleton />;
  if (error) {
    return (
      <>
        <PageHeader title="Stats" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </>
    );
  }

  const fetchedAt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(data.fetchedAt);

  return (
    <PullToRefresh onRefresh={refresh}>
      <PageHeader
        title="Stats"
        subtitle={`${rows.length} titre${rows.length > 1 ? "s" : ""} analysé${rows.length > 1 ? "s" : ""} · ${fetchedAt}`}
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Actualiser les statistiques"
            className="hidden md:inline-flex"
          >
            <RefreshCwIcon className={cn(refreshing && "motion-safe:animate-spin")} />
          </Button>
        }
      />

      {data.pending > 0 ? (
        <Notice tone="info" icon={<LoaderCircleIcon className="motion-safe:animate-spin" />}>
          Récupération des genres, tags et studios sur AniList : encore {data.pending} titre{data.pending > 1 ? "s" : ""}. Les
          stats se complètent toutes seules.
        </Notice>
      ) : null}
      {data.errors.length > 0 ? (
        <Notice tone="warning" icon={<TriangleAlertIcon />}>
          <p className="font-medium">Certaines données manquent</p>
          <ul className="mt-0.5 text-muted-foreground">
            {data.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Rien à analyser pour l'instant"
          description="Connecte MAL ou AniList et ajoute des animes à ta liste : les stats apparaîtront ici."
          cta={{ href: "/add", label: "Ajouter un anime" }}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontalIcon />
                Filtres
                {filterCount > 0 ? (
                  <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary tabular-nums">{filterCount}</span>
                ) : null}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setSelection({ title: filterCount > 0 ? "Titres filtrés" : "Tous les titres", rows: filtered })}
              >
                <ListIcon />
                {filtered.length} titre{filtered.length > 1 ? "s" : ""}
              </Button>
            </div>
            <ActiveFilters filters={filters} onChange={setFilters} />
          </div>

          <Tabs value={tab} onValueChange={(t) => setTab(t as StatsTab)}>
            <TabsList aria-label="Sections">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {filtered.length === 0 ? (
              <EmptyState title="Aucun titre ne correspond" description="Retire un filtre pour élargir la sélection." />
            ) : (
              <>
                <TabsContent value="overview">
                  <OverviewTab rows={filtered} taste={taste} onSelect={setSelection} onTab={setTab} />
                </TabsContent>
                <TabsContent value="time">
                  <TimeTab rows={taste} onSelect={setSelection} />
                </TabsContent>
                <TabsContent value="tastes">
                  <TastesTab rows={taste} tagCategories={data.tagCategories} onSelect={setSelection} />
                </TabsContent>
                <TabsContent value="scores">
                  <ScoresTab rows={taste} calibration={data.calibration} onSelect={setSelection} />
                </TabsContent>
                <TabsContent value="catalog">
                  <CatalogTab rows={taste} onSelect={setSelection} />
                </TabsContent>
                <TabsContent value="backlog">
                  <BacklogTab rows={filtered} onSelect={setSelection} />
                </TabsContent>
                <TabsContent value="profile">
                  <ProfileTab rows={filtered} />
                </TabsContent>
              </>
            )}
          </Tabs>

          {withoutMeta > 0 && data.pending === 0 ? (
            <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
              <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
              {withoutMeta} titre{withoutMeta > 1 ? "s" : ""} sans fiche AniList (présents seulement sur MAL) : ils comptent dans
              le temps et les notes, pas dans les genres, tags et studios.
            </p>
          ) : null}
        </>
      )}

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        rows={rows}
        filters={filters}
        onChange={setFilters}
        resultCount={filtered.length}
      />
      <TitlesSheet selection={selection} onClose={() => setSelection(null)} onFilter={(extra) => setFilters(mergeFilters(filters, extra))} />
    </PullToRefresh>
  );
}
