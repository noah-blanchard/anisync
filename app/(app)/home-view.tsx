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

  const watching = React.useMemo(
    () =>
      (data?.entries ?? [])
        .filter((e) => {
          const state = displayState(e);
          return state !== null && isActiveStatus(state.status);
        })
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [data],
  );
  const ordered = useStableOrder(watching, data?.fetchedAt);
  const outOfSync = data?.entries.filter((e) => !e.inSync).length ?? 0;

  return (
    <PullToRefresh onRefresh={refresh}>
      <PageHeader
        title="En cours"
        subtitle={data ? `${watching.length} anime${watching.length > 1 ? "s" : ""} en cours` : " "}
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

      {isPending ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : ordered.length === 0 ? (
        <EmptyState
          title="Rien en cours pour l'instant"
          description="Ajoute un anime ou passe un titre « À voir » en cours depuis ta bibliothèque."
          cta={{ href: "/add", label: "Ajouter un anime" }}
        />
      ) : (
        <div className={ENTRY_GRID}>
          {ordered.map((entry, i) => (
            <EntryCard key={entry.key} entry={entry} priority={i < 4} />
          ))}
        </div>
      )}
    </PullToRefresh>
  );
}
