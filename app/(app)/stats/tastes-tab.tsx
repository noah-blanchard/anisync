"use client";

import * as React from "react";
import { BarList, ChartCard } from "@/components/stats/charts";
import { DimensionExplorer } from "@/components/stats/explorer";
import type { Selection } from "@/components/stats/titles-sheet";
import { combos, groupBy, untappedGroups } from "@/lib/stats/gold";
import { formatDecimal, formatInteger, formatSigned, genreLabel } from "@/lib/stats/labels";
import type { StatsRow } from "@/lib/stats/types";

export function TastesTab({
  rows,
  tagCategories,
  onSelect,
}: {
  rows: StatsRow[];
  tagCategories: Record<string, string>;
  onSelect: (selection: Selection) => void;
}) {
  const pairs = React.useMemo(() => combos(rows, "genre", 8), [rows]);
  const untapped = React.useMemo(() => untappedGroups(groupBy(rows, "genre")), [rows]);

  return (
    <div className="flex flex-col gap-4">
      <ChartCard title="Genres et tags" description="Choisis le regroupement et la mesure ; touche une barre pour voir les titres.">
        <DimensionExplorer rows={rows} dimensions={["genre", "tag"]} tagCategories={tagCategories} onSelect={onSelect} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Combinaisons favorites" description="Les paires de genres que tu regardes le plus, avec ta note moyenne.">
          <BarList
            items={pairs.map((p) => ({
              id: `${p.a}+${p.b}`,
              label: `${genreLabel(p.a)} + ${genreLabel(p.b)}`,
              value: p.count,
              display: formatInteger(p.count),
              secondary: p.meanScore !== null ? `moy. ${formatDecimal(Math.round(p.meanScore * 10) / 10)}` : undefined,
            }))}
            onSelect={(item) => {
              const pair = pairs.find((p) => `${p.a}+${p.b}` === item.id)!;
              onSelect({
                title: item.label,
                rows: rows.filter((r) => r.genres.includes(pair.a) && r.genres.includes(pair.b)),
                filter: { genres: [pair.a, pair.b], genreMode: "all" },
              });
            }}
            empty="Pas encore assez de genres."
          />
        </ChartCard>

        <ChartCard
          title="Pépites inexploitées"
          description="Des genres que tu notes au-dessus de ton habitude mais que tu regardes peu : à creuser."
        >
          <BarList
            items={untapped.map((g) => ({
              id: g.value,
              label: genreLabel(g.value),
              value: g.affinity!,
              display: formatSigned(g.affinity!),
              secondary: `${g.count} titre${g.count > 1 ? "s" : ""}`,
            }))}
            onSelect={(item) =>
              onSelect({
                title: `Genre : ${item.label}`,
                rows: rows.filter((r) => r.genres.includes(item.id)),
                filter: { genres: [item.id] },
              })
            }
            empty="Aucun genre sous-exploité : tu regardes déjà ce que tu aimes."
          />
        </ChartCard>
      </div>
    </div>
  );
}
