"use client";

import { ArrowLeftRightIcon, SlidersHorizontalIcon } from "lucide-react";
import * as React from "react";
import { ChartCard, ColumnChart, EmptyChart, Meter, PairedBarList } from "@/components/stats/charts";
import { Chip, filterLabels } from "@/components/stats/filters";
import { Button } from "@/components/ui/button";
import { EMPTY_FILTERS, tasteRows, type StatsFilters } from "@/lib/stats/gold";
import { formatCompact, formatDecimal, formatInteger, formatPercent, formatSigned, genreLabel } from "@/lib/stats/labels";
import { traits, type Trait } from "@/lib/stats/profile";
import { genreShares, scoreShares, summarize, type SegmentSummary } from "@/lib/stats/segments";
import { completionYears } from "@/lib/stats/time";
import type { StatsRow } from "@/lib/stats/types";
import { cn } from "@/lib/utils";

const round1 = (v: number) => formatDecimal(Math.round(v * 10) / 10);

const METRICS: { label: string; value: (s: SegmentSummary) => number | null; format: (v: number) => string; delta?: (d: number) => string }[] = [
  { label: "Titres", value: (s) => s.titles, format: formatInteger },
  { label: "Heures", value: (s) => s.hours, format: (v) => `${formatInteger(Math.round(v))} h` },
  { label: "Titres notés", value: (s) => s.rated, format: formatInteger },
  { label: "Note moyenne", value: (s) => s.meanScore, format: round1, delta: formatSigned },
  { label: "Note sur la base commune", value: (s) => s.meanNormalized, format: round1, delta: formatSigned },
  { label: "Écart avec la communauté", value: (s) => s.bias, format: formatSigned, delta: formatSigned },
  { label: "Taux de complétion", value: (s) => s.completionRate, format: formatPercent, delta: (d) => `${formatSigned(d * 100)} pts` },
  { label: "Popularité médiane", value: (s) => s.medianPopularity, format: (v) => `${formatCompact(v)} membres` },
  { label: "Année médiane", value: (s) => s.medianYear, format: (v) => String(Math.round(v)), delta: (d) => `${formatSigned(d)} ans` },
  { label: "Épisodes en moyenne", value: (s) => s.meanEpisodes, format: (v) => formatInteger(Math.round(v)) },
  { label: "Part de suites", value: (s) => s.sequelShare, format: formatPercent, delta: (d) => `${formatSigned(d * 100)} pts` },
];

function SegmentHeader({
  side,
  filters,
  count,
  children,
}: {
  side: "A" | "B";
  filters: StatsFilters;
  count: number;
  children?: React.ReactNode;
}) {
  const labels = filterLabels(filters);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-3 rounded-[3px]", side === "A" ? "bg-viz-1" : "bg-viz-2")} />
        <p className="font-semibold">Sélection {side}</p>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatInteger(count)} titre{count > 1 ? "s" : ""}
          {filters.statuses.length === 0 ? " vus" : ""}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{labels.length > 0 ? labels.join(" · ") : "Toute la liste"}</p>
      {children}
    </div>
  );
}

function TraitPair({ a, b }: { a: Trait | undefined; b: Trait | undefined }) {
  const t = (a ?? b)!;
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{t.name}</p>
      {([
        ["A", a],
        ["B", b],
      ] as const).map(([side, trait]) => (
        <div key={side} className="flex flex-col gap-1">
          <p className="flex justify-between gap-2 text-sm">
            <span className="font-medium">{trait ? trait.label : "—"}</span>
            <span className="text-xs text-muted-foreground">{side}</span>
          </p>
          {trait ? (
            <Meter value={trait.score} centered={trait.centered} tone={side === "A" ? "a" : "b"} label={`${t.name}, sélection ${side} : ${trait.label}`} />
          ) : (
            <p className="text-xs text-muted-foreground">Pas assez de données</p>
          )}
        </div>
      ))}
      <p className="flex justify-between text-[11px] text-muted-foreground">
        <span>{t.poles[0]}</span>
        <span>{t.poles[1]}</span>
      </p>
    </li>
  );
}

/**
 * Two selections of the list side by side: A is the page's filters, B its own filters (kept in the URL).
 * Titles to watch only count for the profile's backlog axis, unless a status filter asks for them.
 */
export function CompareTab({
  filteredA,
  filteredB,
  filtersA,
  filtersB,
  allRows,
  onEditB,
  onChangeB,
  onSwap,
}: {
  /** Filtered rows of each segment, titles to watch included */
  filteredA: StatsRow[];
  filteredB: StatsRow[];
  filtersA: StatsFilters;
  filtersB: StatsFilters;
  allRows: StatsRow[];
  onEditB: () => void;
  onChangeB: (filters: StatsFilters) => void;
  onSwap: () => void;
}) {
  const rowsA = React.useMemo(() => tasteRows(filteredA, filtersA), [filteredA, filtersA]);
  const rowsB = React.useMemo(() => tasteRows(filteredB, filtersB), [filteredB, filtersB]);
  const a = React.useMemo(() => summarize(rowsA), [rowsA]);
  const b = React.useMemo(() => summarize(rowsB), [rowsB]);
  const sharesA = React.useMemo(() => scoreShares(rowsA), [rowsA]);
  const sharesB = React.useMemo(() => scoreShares(rowsB), [rowsB]);
  const genres = React.useMemo(() => genreShares(rowsA, rowsB), [rowsA, rowsB]);
  const traitsA = React.useMemo(() => traits(filteredA), [filteredA]);
  const traitsB = React.useMemo(() => traits(filteredB), [filteredB]);
  const years = React.useMemo(() => completionYears(allRows).slice(0, 3), [allRows]);
  const traitIds = [...new Set([...traitsA, ...traitsB].map((t) => t.id))];

  const presets: { label: string; filters: StatsFilters }[] = [
    { label: "Toute la liste", filters: EMPTY_FILTERS },
    ...years.map((y) => ({ label: `Terminés en ${y}`, filters: { ...EMPTY_FILTERS, completedYears: [y] } })),
    { label: "Films", filters: { ...EMPTY_FILTERS, formats: ["MOVIE"] } },
    { label: "Séries longues", filters: { ...EMPTY_FILTERS, lengths: ["long" as const, "saga" as const] } },
  ];
  const sameAs = (f: StatsFilters) => JSON.stringify(f) === JSON.stringify(filtersB);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <SegmentHeader side="A" filters={filtersA} count={rowsA.length}>
          <p className="text-xs text-muted-foreground">Ce sont les filtres de la page.</p>
        </SegmentHeader>
        <SegmentHeader side="B" filters={filtersB} count={rowsB.length}>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Chip key={p.label} pressed={sameAs(p.filters)} onClick={() => onChangeB(p.filters)} className="h-7 px-2.5 text-xs">
                {p.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onEditB}>
              <SlidersHorizontalIcon />
              Filtres de B
            </Button>
            <Button variant="ghost" size="sm" onClick={onSwap}>
              <ArrowLeftRightIcon />
              Inverser A et B
            </Button>
          </div>
        </SegmentHeader>
      </div>

      {rowsA.length === 0 || rowsB.length === 0 ? (
        <EmptyChart>Une des deux sélections est vide : élargis ses filtres.</EmptyChart>
      ) : (
        <>
          <ChartCard title="En chiffres" description="Les mêmes indicateurs pour les deux sélections, et l'écart de B par rapport à A.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Indicateur</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">A</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">B</th>
                    <th scope="col" className="py-2 text-right font-medium">B − A</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {METRICS.map((m) => {
                    const va = m.value(a);
                    const vb = m.value(b);
                    const diff = va !== null && vb !== null ? vb - va : null;
                    return (
                      <tr key={m.label} className="border-b border-border/60 last:border-0">
                        <th scope="row" className="py-2 pr-3 text-left font-normal">
                          {m.label}
                        </th>
                        <td className="py-2 pr-3 text-right">{va !== null ? m.format(va) : "—"}</td>
                        <td className="py-2 pr-3 text-right">{vb !== null ? m.format(vb) : "—"}</td>
                        <td className="py-2 text-right text-muted-foreground">
                          {diff === null ? "—" : m.delta ? m.delta(diff) : va ? formatSigned(((vb! - va) / Math.abs(va)) * 100) + " %" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Distribution des notes" description="Part des titres notés à chaque note, pour comparer des sélections de tailles différentes.">
              <ColumnChart
                series={[
                  { label: "A", color: "var(--viz-1)" },
                  { label: "B", color: "var(--viz-2)" },
                ]}
                data={sharesA.map((share, i) => ({ id: String(i + 1), label: String(i + 1), title: `Note ${i + 1}`, values: [share, sharesB[i]!] }))}
                format={(v) => formatPercent(v)}
              />
            </ChartCard>
            <ChartCard title="Genres" description="Part des titres de chaque sélection dans les genres qui comptent.">
              <PairedBarList
                items={genres.map((g) => ({ id: g.genre, label: genreLabel(g.genre), a: g.a, b: g.b }))}
                format={formatPercent}
                series={["A", "B"]}
              />
            </ChartCard>
          </div>

          <ChartCard title="Profils" description="Les axes du profil de spectateur, calculés sur chaque sélection.">
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {traitIds.map((id) => (
                <TraitPair key={id} a={traitsA.find((t) => t.id === id)} b={traitsB.find((t) => t.id === id)} />
              ))}
            </ul>
          </ChartCard>
        </>
      )}
    </div>
  );
}
