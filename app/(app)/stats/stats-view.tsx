"use client";

import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  InfoIcon,
  ListIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  UserSearchIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { EmptyState, ErrorState } from "@/components/list-states";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { CompareCard } from "@/components/stats/compare-card";
import { ActiveFilters, FilterSheet } from "@/components/stats/filters";
import { OpenTitleProvider } from "@/components/stats/open-title";
import { ProfileAvatar, ProfileSearch, rememberProfile } from "@/components/stats/profile-search";
import { TitlesSheet, type Selection } from "@/components/stats/titles-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useList } from "@/hooks/use-list";
import { useRefreshStats, useStats } from "@/hooks/use-stats";
import { activeFilterCount, applyFilters, tasteRows, type StatsFilters } from "@/lib/stats/gold";
import { mergeFilters, parseStatsParams, statsSearch, type StatsTab, type StatsUrlState } from "@/lib/stats/url";
import { cn } from "@/lib/utils";
import { BacklogTab } from "./backlog-tab";
import { CatalogTab } from "./catalog-tab";
import { CompareTab } from "./compare-tab";
import { HistoryTab } from "./history-tab";
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
  { id: "history", label: "Historique" },
  { id: "compare", label: "Comparer" },
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

/** My stats, or those of a public AniList profile (`user`). */
export function StatsView({ user }: { user?: string }) {
  const own = useStats();
  const viewed = useStats(user);
  const { data, isPending, error, refetch } = user ? viewed : own;
  // The detail overlay reads entries from the list cache (also for the titles of a profile I have too).
  useList();
  const refreshStats = useRefreshStats(user);
  const [searchOpen, setSearchOpen] = React.useState(false);
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
  const { filters, compare, tab } = state;
  const [compareOpen, setCompareOpen] = React.useState(false);

  const navigate = React.useCallback(
    (next: Partial<StatsUrlState>) => {
      const merged: StatsUrlState = { filters, compare, tab, ...next };
      setState((prev) => ({ url: prev.url, ...merged }));
      router.replace(`${pathname}${statsSearch(merged)}`, { scroll: false });
    },
    [router, pathname, filters, compare, tab],
  );
  const setFilters = React.useCallback((next: StatsFilters) => navigate({ filters: next }), [navigate]);
  const setCompare = React.useCallback((next: StatsFilters) => navigate({ compare: next }), [navigate]);
  const setTab = React.useCallback((next: StatsTab) => navigate({ tab: next }), [navigate]);

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
  const filteredB = React.useMemo(() => applyFilters(rows, compare), [rows, compare]);
  const wrappedHref = user ? `/stats/u/${encodeURIComponent(user)}/wrapped` : "/stats/wrapped";
  const filterCount = activeFilterCount(filters);
  const withoutMeta = rows.filter((r) => !r.hasMeta).length;
  const profile = data?.user;

  React.useEffect(() => {
    if (profile) rememberProfile({ id: profile.id, name: profile.name, avatar: profile.avatar });
  }, [profile]);

  const search = <ProfileSearch open={searchOpen} onOpenChange={setSearchOpen} />;
  const searchButton = (
    <Button variant="outline" onClick={() => setSearchOpen(true)}>
      <UserSearchIcon />
      <span className="hidden sm:inline">Analyser un profil</span>
      <span className="sm:hidden">Profil</span>
    </Button>
  );
  const backButton = user ? (
    <Button variant="ghost" asChild>
      <Link href="/stats">
        <ArrowLeftIcon />
        Mes stats
      </Link>
    </Button>
  ) : null;

  if (isPending) return <StatsSkeleton />;
  if (error) {
    return (
      <>
        <PageHeader
          title={user ?? "Stats"}
          actions={
            <>
              {backButton}
              {searchButton}
            </>
          }
        />
        <ErrorState
          title={user ? "Impossible d'analyser ce profil" : undefined}
          message={error.message}
          onRetry={() => refetch()}
        />
        {search}
      </>
    );
  }

  const fetchedAt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(data.fetchedAt);
  const analysed = `${rows.length} titre${rows.length > 1 ? "s" : ""} analysé${rows.length > 1 ? "s" : ""} · ${fetchedAt}`;

  return (
    <OpenTitleProvider>
      <PullToRefresh onRefresh={refresh}>
        <PageHeader
          title={profile ? profile.name : "Stats"}
          subtitle={
            profile ? (
              <span className="flex items-center gap-2">
                <ProfileAvatar src={profile.avatar} className="size-6" />
                <a href={profile.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                  Profil AniList
                  <ExternalLinkIcon aria-hidden className="size-3.5" />
                </a>
                · {analysed}
              </span>
            ) : (
              analysed
            )
          }
          actions={
            <>
              {backButton}
              {searchButton}
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
            </>
          }
        />

        {profile ? (
          <Notice tone="info" icon={<InfoIcon />}>
            Tu regardes les stats de <strong className="font-semibold">{profile.name}</strong> : dans les textes, « tu » désigne
            ce profil. Seule sa liste AniList publique compte, et un titre qui n&apos;est pas dans ta liste s&apos;ouvre sur
            AniList.
          </Notice>
        ) : null}

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
          profile ? (
            <EmptyState title="Liste vide" description={`${profile.name} n'a encore aucun anime dans sa liste AniList.`} />
          ) : (
            <EmptyState
              title="Rien à analyser pour l'instant"
              description="Connecte MAL ou AniList et ajoute des animes à ta liste : les stats apparaîtront ici."
              cta={{ href: "/add", label: "Ajouter un anime" }}
            />
          )
        ) : (
          <>
            {profile && own.data && own.data.rows.length > 0 ? (
              <div className="mb-4">
                <CompareCard mine={own.data.rows} theirs={rows} name={profile.name} />
              </div>
            ) : null}

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
                    <OverviewTab rows={filtered} taste={taste} onSelect={setSelection} onTab={setTab} wrappedHref={wrappedHref} />
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
                  <TabsContent value="history">
                    <HistoryTab rows={taste} allRows={rows} user={user} />
                  </TabsContent>
                  <TabsContent value="compare">
                    <CompareTab
                      filteredA={filtered}
                      filteredB={filteredB}
                      filtersA={filters}
                      filtersB={compare}
                      allRows={rows}
                      onEditB={() => setCompareOpen(true)}
                      onChangeB={setCompare}
                      onSwap={() => navigate({ filters: compare, compare: filters })}
                    />
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
        <FilterSheet
          title="Filtres de la sélection B"
          open={compareOpen}
          onOpenChange={setCompareOpen}
          rows={rows}
          filters={compare}
          onChange={setCompare}
          resultCount={filteredB.length}
        />
        <TitlesSheet selection={selection} onClose={() => setSelection(null)} onFilter={(extra) => setFilters(mergeFilters(filters, extra))} />
        {search}
      </PullToRefresh>
    </OpenTitleProvider>
  );
}
