"use client";

import { ListChecksIcon, RefreshCwIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { BoosterShelf } from "@/components/booster/booster-shelf";
import { ENTRY_GRID, EntryCard } from "@/components/entry-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/list-states";
import { useOverlay } from "@/components/overlay-context";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { countKinds, KindFilter, matchesKind, useKindFilter } from "@/components/kind-filter";
import { InstallCard } from "@/components/pwa";
import { Button } from "@/components/ui/button";
import { useRefreshList, useList } from "@/hooks/use-list";
import { useStableOrder } from "@/hooks/use-stable-order";
import { isActiveStatus } from "@/lib/mapping";
import { displayState } from "@/lib/merge";
import { cn } from "@/lib/utils";

export function HomeView() {
  const { data, isPending, error, refetch } = useList();
  const refreshList = useRefreshList();
  const { open } = useOverlay();
  const [refreshing, setRefreshing] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshList();
    } catch {
      toast.error("Actualisation impossible");
    } finally {
      setRefreshing(false);
    }
  }, [refreshList]);

  const kindAvailable = Boolean(data?.connections.simkl);
  const [kind, setKind] = useKindFilter(kindAvailable);

  const active = React.useMemo(
    () =>
      (data?.entries ?? []).filter((e) => {
        const state = displayState(e);
        return state !== null && isActiveStatus(state.status);
      }),
    [data],
  );
  const kindCounts = React.useMemo(() => countKinds(active), [active]);
  const watching = React.useMemo(
    () => active.filter((e) => matchesKind(e, kind)).sort((a, b) => b.updatedAt - a.updatedAt),
    [active, kind],
  );
  const ordered = useStableOrder(watching, `${data?.fetchedAt}|${kind}`);
  const outOfSync = data?.entries.filter((e) => !e.inSync).length ?? 0;
  const noun = kind === "show" ? "série" : kind === "movie" ? "film" : "anime";

  return (
    <PullToRefresh onRefresh={refresh}>
      <PageHeader
        title="En cours"
        subtitle={data ? `${watching.length} ${noun}${watching.length > 1 ? "s" : ""} en cours` : " "}
        actions={
          <>
            <Button variant="outline" onClick={() => open({ type: "check" })} disabled={!data}>
              <ListChecksIcon />
              Tout vérifier
              {outOfSync > 0 && (
                <span className="rounded-full bg-warning/15 px-1.5 text-xs text-warning tabular-nums">{outOfSync}</span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Actualiser les listes"
              className="hidden md:inline-flex"
            >
              <RefreshCwIcon className={cn(refreshing && "motion-safe:animate-spin")} />
            </Button>
          </>
        }
      />

      <InstallCard />
      <BoosterShelf />

      {kindAvailable && <KindFilter value={kind} onChange={setKind} counts={kindCounts} className="mb-4" />}

      {isPending ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : ordered.length === 0 ? (
        <EmptyState
          title="Rien en cours pour l'instant"
          description="Ajoute un titre ou passe un titre « À voir » en cours depuis ta bibliothèque."
          cta={{ href: "/add", label: "Ajouter un titre" }}
        />
      ) : (
        <div className={ENTRY_GRID}>
          {ordered.map((entry, i) => (
            <EntryCard key={entry.key} entry={entry} priority={i < 4} showKind={kindAvailable && kind === "all"} />
          ))}
        </div>
      )}
    </PullToRefresh>
  );
}
