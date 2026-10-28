"use client";

import * as React from "react";
import { BarList, ColumnChart, type BarItem } from "@/components/stats/charts";
import { Chip } from "@/components/stats/filters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  groupBy,
  METRICS,
  MIN_SAMPLE,
  naturalOrder,
  rankGroups,
  valuesOf,
  type Dimension,
  type Group,
  type Metric,
} from "@/lib/stats/gold";
import {
  DIMENSION_LABELS,
  DIMENSION_SINGULAR,
  dimensionValueLabel,
  formatDecimal,
  formatHours,
  formatInteger,
  formatPercent,
  formatSigned,
  tagGroupLabel,
} from "@/lib/stats/labels";
import type { StatsRow } from "@/lib/stats/types";
import { filterFor } from "@/lib/stats/url";
import type { Selection } from "./titles-sheet";

const METRIC_INFO: Record<Metric, { label: string; description: string }> = {
  count: { label: "Titres", description: "Nombre de titres, et part de la sélection." },
  hours: { label: "Heures", description: "Temps passé devant, revisionnages compris." },
  score: { label: "Note moyenne", description: `Ta note moyenne, sur 10 (au moins ${MIN_SAMPLE} titres notés).` },
  affinity: {
    label: "Affinité",
    description: "Tes notes ramenées sur la base commune, comparées à ton titre moyen : au-dessus de 0, tu aimes plus que d'habitude.",
  },
  delta: {
    label: "Écart communauté",
    description: "Ta note moins la moyenne AniList sur les mêmes titres : au-dessus de 0, tu notes plus haut que les autres.",
  },
  dropRate: { label: "Abandon", description: "Part des titres abandonnés parmi ceux terminés ou abandonnés." },
};

function display(metric: Metric, value: number, group: Group): Pick<BarItem, "display" | "secondary"> {
  const titles = (n: number) => `${formatInteger(n)} titre${n > 1 ? "s" : ""}`;
  switch (metric) {
    case "count":
      return { display: formatInteger(value), secondary: formatPercent(group.share) };
    case "hours":
      return { display: formatHours(group.minutes), secondary: titles(group.count) };
    case "score":
      return { display: formatDecimal(Math.round(value * 10) / 10), secondary: `${group.rated} notés` };
    case "affinity":
      return { display: formatSigned(value), secondary: `${group.rated} notés` };
    case "delta":
      return { display: formatSigned(value), secondary: titles(group.pairs) };
    case "dropRate":
      return { display: formatPercent(value), secondary: `${group.dropped}/${group.completed + group.dropped}` };
  }
}

/** Domain of a non-diverging metric: fixed scales where they exist, so bars compare across views. */
function domainOf(metric: Metric): number | undefined {
  if (metric === "score") return 10;
  if (metric === "dropRate") return 1;
  return undefined;
}

/**
 * Any dimension × any metric: the generic aggregate view behind the Goûts and Catalogue tabs.
 * Ordered dimensions (decades, years…) show as columns in their order.
 */
export function DimensionExplorer({
  rows,
  dimensions,
  tagCategories,
  onSelect,
}: {
  rows: readonly StatsRow[];
  dimensions: Dimension[];
  tagCategories?: Record<string, string>;
  onSelect: (selection: Selection) => void;
}) {
  const [dimension, setDimension] = React.useState<Dimension>(dimensions[0]!);
  const [metric, setMetric] = React.useState<Metric>("count");
  const [tagGroup, setTagGroup] = React.useState("all");

  const tagGroups = React.useMemo(() => {
    if (dimension !== "tag" || !tagCategories) return [];
    const groups = new Set<string>();
    for (const r of rows) for (const t of r.tags) groups.add(tagGroupLabel(tagCategories[t]));
    return [...groups].sort((a, b) => a.localeCompare(b, "fr"));
  }, [dimension, rows, tagCategories]);

  const order = naturalOrder(dimension);
  const spec = METRICS[metric];
  const ranked = React.useMemo(() => {
    let groups = groupBy(rows, dimension);
    if (dimension === "tag" && tagGroup !== "all" && tagCategories) {
      groups = groups.filter((g) => tagGroupLabel(tagCategories[g.value]) === tagGroup);
    }
    return rankGroups(groups, metric, order && !spec.diverging ? order : null);
  }, [rows, dimension, metric, tagGroup, tagCategories, order, spec.diverging]);

  const select = (value: string) => {
    const label = dimensionValueLabel(dimension, value);
    onSelect({
      title: `${DIMENSION_SINGULAR[dimension]} : ${label}`,
      rows: rows.filter((r) => valuesOf(r, dimension).includes(value)),
      filter: filterFor(dimension, value),
    });
  };

  const asColumns = order !== null && !spec.diverging && ranked.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Regrouper par" className="no-scrollbar -mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1">
          {dimensions.map((d) => (
            <Chip key={d} pressed={d === dimension} onClick={() => setDimension(d)}>
              {DIMENSION_LABELS[d]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {tagGroups.length > 1 ? (
            <Select value={tagGroup} onValueChange={setTagGroup}>
              <SelectTrigger aria-label="Catégorie de tags" className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes catégories</SelectItem>
                {tagGroups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
            <SelectTrigger aria-label="Mesure" className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {(Object.keys(METRIC_INFO) as Metric[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {METRIC_INFO[m].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{METRIC_INFO[metric].description}</p>

      {asColumns ? (
        <ColumnChart
          series={[{ label: METRIC_INFO[metric].label, color: "var(--viz-1)" }]}
          data={ranked.map(({ group, value }) => ({
            id: group.value,
            // Short axis labels: "1990", "8", "Court"…
            label: dimension === "decade" || dimension === "year" || dimension === "score" ? group.value : dimensionValueLabel(dimension, group.value).split(" ")[0]!,
            title: `${dimensionValueLabel(dimension, group.value)} · ${display(metric, value, group).secondary ?? ""}`,
            values: [value],
          }))}
          format={(v) => (metric === "dropRate" ? formatPercent(v) : formatDecimal(Math.round(v * 10) / 10))}
          onSelect={(d) => select(d.id)}
        />
      ) : (
        <BarList
          items={ranked.map(({ group, value }) => ({
            id: group.value,
            label: dimensionValueLabel(dimension, group.value),
            value,
            ...display(metric, value, group),
          }))}
          domain={domainOf(metric)}
          diverging={spec.diverging}
          onSelect={(item) => select(item.id)}
          empty={metric === "count" || metric === "hours" ? "Aucune donnée pour ces filtres" : `Il faut au moins ${MIN_SAMPLE} titres par valeur`}
        />
      )}
    </div>
  );
}
