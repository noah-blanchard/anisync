"use client";

import * as React from "react";
import { BarList, ChartCard, ColumnChart } from "@/components/stats/charts";
import { DimensionExplorer } from "@/components/stats/explorer";
import type { Selection } from "@/components/stats/titles-sheet";
import { groupBy, MIN_SAMPLE, popularityBuckets, rankGroups, type Ranked } from "@/lib/stats/gold";
import { formatInteger, formatSigned } from "@/lib/stats/labels";
import type { StatsRow } from "@/lib/stats/types";

export function CatalogTab({ rows, onSelect }: { rows: StatsRow[]; onSelect: (selection: Selection) => void }) {
  const popularity = React.useMemo(() => popularityBuckets(rows), [rows]);
  const studios = React.useMemo(() => {
    const groups = groupBy(rows, "studio");
    return {
      // Below 0.05 the affinity shows as 0: not a favourite.
      favorite: rankGroups(groups, "affinity").filter((r) => r.value >= 0.05).slice(0, 6),
      harshest: rankGroups(groups, "delta").reverse().slice(0, 6),
    };
  }, [rows]);
  const studioItems = (list: Ranked[], metric: "affinity" | "delta") =>
    list.map(({ group, value }) => ({
      id: group.value,
      label: group.value,
      value,
      display: formatSigned(value),
      secondary: `${metric === "affinity" ? group.rated : group.pairs} titres`,
    }));
  const selectStudio = (studio: string) =>
    onSelect({ title: `Studio : ${studio}`, rows: rows.filter((r) => r.studios.includes(studio)), filter: { studios: [studio] } });

  return (
    <div className="flex flex-col gap-4">
      <ChartCard title="Ce que tu regardes" description="Formats, époques, sources, studios… avec la mesure de ton choix.">
        <DimensionExplorer
          rows={rows}
          dimensions={["format", "length", "decade", "year", "season", "source", "studio", "country"]}
          onSelect={onSelect}
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Studios fétiches" description="Les studios dont tu notes les titres au-dessus de ton habitude (affinité).">
          <BarList
            items={studioItems(studios.favorite, "affinity")}
            onSelect={(item) => selectStudio(item.id)}
            empty={`Il faut au moins ${MIN_SAMPLE} titres notés par studio.`}
          />
        </ChartCard>
        <ChartCard
          title="Studios où tu es le plus sévère"
          description="Ton écart avec la moyenne AniList sur leurs titres, du plus bas au plus haut."
        >
          <BarList
            items={studioItems(studios.harshest, "delta")}
            diverging
            onSelect={(item) => selectStudio(item.id)}
            empty={`Il faut au moins ${MIN_SAMPLE} titres notés par studio.`}
          />
        </ChartCard>
      </div>

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
