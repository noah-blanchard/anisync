"use client";

import * as React from "react";
import { ChartCard, ColumnChart } from "@/components/stats/charts";
import { DimensionExplorer } from "@/components/stats/explorer";
import type { Selection } from "@/components/stats/titles-sheet";
import { popularityBuckets } from "@/lib/stats/gold";
import { formatInteger } from "@/lib/stats/labels";
import type { StatsRow } from "@/lib/stats/types";

export function CatalogTab({ rows, onSelect }: { rows: StatsRow[]; onSelect: (selection: Selection) => void }) {
  const popularity = React.useMemo(() => popularityBuckets(rows), [rows]);

  return (
    <div className="flex flex-col gap-4">
      <ChartCard title="Ce que tu regardes" description="Formats, époques, sources, studios… avec la mesure de ton choix.">
        <DimensionExplorer
          rows={rows}
          dimensions={["format", "length", "decade", "year", "season", "source", "studio", "country"]}
          onSelect={onSelect}
        />
      </ChartCard>

      <ChartCard title="Popularité" description="Tes titres selon leur nombre de membres AniList : des pépites confidentielles aux incontournables.">
        <ColumnChart
          series={[{ label: "Titres", color: "var(--viz-1)" }]}
          data={popularity.map((b) => ({ id: b.label, label: b.label, title: `${b.label} membres`, values: [b.rows.length] }))}
          format={(v) => formatInteger(v)}
          onSelect={(d) =>
            onSelect({ title: `Popularité : ${d.label} membres`, rows: popularity.find((b) => b.label === d.id)?.rows ?? [] })
          }
        />
      </ChartCard>
    </div>
  );
}
