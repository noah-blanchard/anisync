"use client";

import { FilterIcon } from "lucide-react";
import * as React from "react";
import { Cover } from "@/components/entry-bits";
import { ResponsiveOverlay } from "@/components/responsive-overlay";
import { useOpenTitle } from "@/components/stats/open-title";
import { Button } from "@/components/ui/button";
import type { StatsFilters } from "@/lib/stats/gold";
import { formatDecimal, statusLabel } from "@/lib/stats/labels";
import type { StatsRow } from "@/lib/stats/types";

/** What a click on a bar, a column or a record opens: the titles behind it. */
export interface Selection {
  title: string;
  rows: StatsRow[];
  /** The filter that narrows the whole page to this selection, when there is one */
  filter?: Partial<StatsFilters> | null;
}

const MAX_SHOWN = 300;

function byScore(a: StatsRow, b: StatsRow) {
  return (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title, "fr");
}

export function TitlesSheet({
  selection,
  onClose,
  onFilter,
}: {
  selection: Selection | null;
  onClose: () => void;
  onFilter: (filter: Partial<StatsFilters>) => void;
}) {
  const openTitle = useOpenTitle();
  const rows = React.useMemo(() => [...(selection?.rows ?? [])].sort(byScore), [selection]);

  const openRow = (row: StatsRow) => {
    onClose();
    // Let the sheet close before the detail opens (one overlay at a time).
    requestAnimationFrame(() => openTitle(row));
  };

  return (
    <ResponsiveOverlay
      open={selection !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={selection?.title ?? "Titres"}
      description={`${rows.length} titre${rows.length > 1 ? "s" : ""}`}
    >
      <div className="flex flex-col gap-4 p-5 pb-8 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{selection?.title}</h2>
            <p className="text-sm text-muted-foreground">
              {rows.length} titre{rows.length > 1 ? "s" : ""}
            </p>
          </div>
          {selection?.filter ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onFilter(selection.filter!);
                onClose();
              }}
            >
              <FilterIcon />
              Filtrer la page
            </Button>
          ) : null}
        </div>
        <ul className="flex flex-col">
          {rows.slice(0, MAX_SHOWN).map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => openRow(r)}
                className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Cover src={r.cover} alt="" glow={false} sizes="40px" className="w-10 rounded-lg" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{r.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[statusLabel(r.status), r.year, r.community !== null ? `Communauté ${formatDecimal(r.community)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{r.score !== null ? `${r.score}/10` : "—"}</span>
              </button>
            </li>
          ))}
        </ul>
        {rows.length > MAX_SHOWN ? (
          <p className="text-sm text-muted-foreground">Et {rows.length - MAX_SHOWN} autres : affine avec les filtres.</p>
        ) : null}
      </div>
    </ResponsiveOverlay>
  );
}
