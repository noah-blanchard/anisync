"use client";

import { ArrowRightIcon } from "lucide-react";
import * as React from "react";
import { Cover } from "@/components/entry-bits";
import { useOverlay } from "@/components/overlay-context";
import { BarList, ChartCard, ColumnChart, EmptyChart, StackedBar, StatTile } from "@/components/stats/charts";
import type { Selection } from "@/components/stats/titles-sheet";
import { Button } from "@/components/ui/button";
import type { CanonicalStatus } from "@/lib/mapping";
import { completionsByYear, drops, groupBy, overview, records, type Records } from "@/lib/stats/gold";
import {
  formatCompact,
  formatDecimal,
  formatHours,
  formatInteger,
  formatPercent,
  genreLabel,
  statusLabel,
} from "@/lib/stats/labels";
import type { StatsRow } from "@/lib/stats/types";
import type { StatsTab } from "@/lib/stats/url";

/** Stack order and colour slot of each status (fixed: a status keeps its colour whatever the filter). */
const STATUS_SLOTS: [CanonicalStatus, string][] = [
  ["completed", "var(--viz-1)"],
  ["watching", "var(--viz-2)"],
  ["rewatching", "var(--viz-3)"],
  ["on_hold", "var(--viz-4)"],
  ["dropped", "var(--viz-5)"],
  ["plan_to_watch", "var(--viz-6)"],
];

const RECORDS: { id: keyof Records; label: string; value: (r: StatsRow) => string }[] = [
  { id: "timeSink", label: "Gouffre à temps", value: (r) => formatHours(r.minutesWatched) },
  { id: "longest", label: "Le plus long", value: (r) => `${formatInteger(r.episodes ?? 0)} épisodes` },
  { id: "hiddenGem", label: "Pépite cachée", value: (r) => `${r.score}/10 · ${formatCompact(r.popularity ?? 0)} membres` },
  { id: "mostPopular", label: "Le plus populaire", value: (r) => `${formatCompact(r.popularity ?? 0)} membres` },
  { id: "oldest", label: "Le plus ancien", value: (r) => String(r.year) },
  { id: "newest", label: "Le plus récent", value: (r) => String(r.year) },
  { id: "mostRewatched", label: "Le plus revu", value: (r) => `Revu ${r.repeat} fois` },
];

function plural(n: number, word: string) {
  return `${formatInteger(n)} ${word}${n > 1 ? "s" : ""}`;
}

export function OverviewTab({
  rows,
  taste,
  onSelect,
  onTab,
}: {
  /** Filtered rows, titles to watch included */
  rows: StatsRow[];
  /** Filtered rows used for taste stats */
  taste: StatsRow[];
  onSelect: (selection: Selection) => void;
  onTab: (tab: StatsTab) => void;
}) {
  const { open } = useOverlay();
  const o = React.useMemo(() => overview(rows), [rows]);
  const years = React.useMemo(() => completionsByYear(rows), [rows]);
  const d = React.useMemo(() => drops(rows), [rows]);
  const rec = React.useMemo(() => records(taste), [taste]);
  const genres = React.useMemo(() => groupBy(taste, "genre").slice(0, 6), [taste]);
  const inProgress = o.byStatus.watching + o.byStatus.rewatching + o.byStatus.on_hold;
  const days = o.minutes / 1440;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1 rounded-3xl border border-border bg-card p-5 md:p-6">
        <p className="text-sm text-muted-foreground">Temps passé devant tes animes</p>
        <p className="text-5xl font-semibold tracking-tight md:text-6xl">{formatHours(o.minutes)}</p>
        <p className="text-sm text-muted-foreground">
          soit {formatDecimal(Math.round(days * 10) / 10)} jours non-stop · {plural(o.episodes, "épisode")}
          {o.rewatches > 0 ? ` · ${plural(o.rewatches, "revisionnage")}` : ""}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Titres" value={formatInteger(o.titles)} hint={`${formatInteger(o.byStatus.completed)} terminés`} />
        <StatTile
          label="Note moyenne"
          value={o.meanScore !== null ? formatDecimal(Math.round(o.meanScore * 10) / 10) : "—"}
          hint={`sur ${plural(o.rated, "titre")} noté${o.rated > 1 ? "s" : ""}`}
        />
        <StatTile
          label="Taux de complétion"
          value={o.completionRate !== null ? formatPercent(o.completionRate) : "—"}
          hint="terminés / (terminés + abandonnés)"
        />
        <StatTile label="En cours ou en pause" value={formatInteger(inProgress)} hint={`${formatHours(o.minutesLeftInProgress)} restantes`} />
        <StatTile label="À voir" value={formatInteger(o.byStatus.plan_to_watch)} hint={`${formatHours(o.plannedMinutes)} de backlog`} />
        <StatTile
          label="Suites"
          value={o.sequelShare !== null ? formatPercent(o.sequelShare) : "—"}
          hint="titres qui suivent une autre série"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Statuts" description="Où en sont les titres de ta liste.">
          <StackedBar
            segments={STATUS_SLOTS.map(([status, color]) => ({
              id: status,
              label: statusLabel(status),
              value: o.byStatus[status],
              color,
            }))}
            format={formatInteger}
            onSelect={(s) =>
              onSelect({
                title: `Statut : ${s.label}`,
                rows: rows.filter((r) => r.status === s.id),
                filter: { statuses: [s.id as CanonicalStatus] },
              })
            }
          />
        </ChartCard>

        <ChartCard title="Activité" description="Titres terminés par année, d'après tes dates de fin.">
          {years.length > 0 ? (
            <ColumnChart
              series={[{ label: "Titres terminés", color: "var(--viz-1)" }]}
              data={years.map((y) => ({
                id: String(y.year),
                label: String(y.year),
                title: `${y.year} · ${formatHours(y.minutes)}`,
                values: [y.count],
              }))}
              format={(v) => formatInteger(v)}
              onSelect={(datum) =>
                onSelect({
                  title: `Terminés en ${datum.id}`,
                  rows: rows.filter((r) => r.completedAt !== null && new Date(r.completedAt).getUTCFullYear() === Number(datum.id)),
                })
              }
            />
          ) : (
            <EmptyChart>Aucune date de fin : renseigne-les sur AniList ou MAL pour voir ton activité.</EmptyChart>
          )}
        </ChartCard>

        <ChartCard
          title="Genres les plus regardés"
          description="Part des titres vus de chaque genre."
          action={
            <Button variant="ghost" size="sm" onClick={() => onTab("tastes")}>
              Tout voir
              <ArrowRightIcon />
            </Button>
          }
        >
          <BarList
            items={genres.map((g) => ({
              id: g.value,
              label: genreLabel(g.value),
              value: g.count,
              display: formatInteger(g.count),
              secondary: formatPercent(g.share),
            }))}
            onSelect={(item) =>
              onSelect({
                title: `Genre : ${item.label}`,
                rows: taste.filter((r) => r.genres.includes(item.id)),
                filter: { genres: [item.id] },
              })
            }
            empty="Pas encore de genres : les métadonnées arrivent."
          />
        </ChartCard>

        <ChartCard
          title="Abandons"
          description={
            d.count > 0
              ? `${plural(d.count, "titre")} abandonné${d.count > 1 ? "s" : ""}, dont ${d.early} dans les 3 premiers épisodes${
                  d.medianEpisode !== null ? ` · en médiane à l'épisode ${formatDecimal(d.medianEpisode)}` : ""
                }.`
              : "Aucun titre abandonné."
          }
          action={
            d.count > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelect({ title: "Abandonnés", rows: d.rows, filter: { statuses: ["dropped"] } })}
              >
                Voir
                <ArrowRightIcon />
              </Button>
            ) : null
          }
        >
          {d.count > 0 ? (
            <>
              <p className="-mt-2 text-xs text-muted-foreground">Part des épisodes vus avant d&apos;arrêter</p>
              <ColumnChart
                series={[{ label: "Titres abandonnés", color: "var(--viz-1)" }]}
                data={d.buckets.map((b) => ({ id: b.label, label: b.label, values: [b.count] }))}
                format={(v) => formatInteger(v)}
                height={120}
              />
            </>
          ) : (
            <EmptyChart>Tu finis tout ce que tu commences.</EmptyChart>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Records" description="Les extrêmes de ta liste (hors « À voir »).">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {RECORDS.map(({ id, label, value }) => {
            const row = rec[id];
            if (!row) return null;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => open({ type: "detail", key: row.key })}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border p-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Cover src={row.cover} alt="" glow={false} sizes="48px" className="w-12 rounded-lg" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="truncate text-sm font-medium">{row.title}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{value(row)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </ChartCard>
    </div>
  );
}
