"use client";

import * as React from "react";
import { Cover } from "@/components/entry-bits";
import { EmptyState } from "@/components/list-states";
import { ChartCard, ColumnChart, EmptyChart, StackedBar, StatTile } from "@/components/stats/charts";
import { Chip } from "@/components/stats/filters";
import { CalendarHeatmap } from "@/components/stats/heatmap";
import { useOpenTitle } from "@/components/stats/open-title";
import type { Selection } from "@/components/stats/titles-sheet";
import { formatDecimal, formatInteger, formatPercent } from "@/lib/stats/labels";
import {
  byMonthOfYear,
  byWeekday,
  completionsByDay,
  completionYears,
  monthIndex,
  monthlyActivity,
  monthStart,
  paceStats,
  simulcast,
  streaks,
} from "@/lib/stats/time";
import type { StatsRow } from "@/lib/stats/types";

const MONTH_SHORT = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTHS = Array.from({ length: 12 }, (_, m) => MONTH_SHORT.format(Date.UTC(2024, m, 1)));
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function plural(n: number, word: string) {
  return `${formatInteger(n)} ${word}${n > 1 ? "s" : ""}`;
}

/** "18 mois", "2,3 ans" */
function duration(days: number): string {
  if (days < 60) return plural(Math.round(days), "jour");
  if (days < 730) return `${formatInteger(Math.round(days / 30.4))} mois`;
  return `${formatDecimal(Math.round((days / 365.25) * 10) / 10)} ans`;
}

export function TimeTab({ rows, onSelect }: { rows: StatsRow[]; onSelect: (selection: Selection) => void }) {
  const openTitle = useOpenTitle();
  const years = React.useMemo(() => completionYears(rows), [rows]);
  const [pickedYear, setYear] = React.useState<number | null>(null);
  const year = pickedYear !== null && years.includes(pickedYear) ? pickedYear : (years[0] ?? null);
  const [monthMetric, setMonthMetric] = React.useState<"count" | "hours">("count");

  const days = React.useMemo(() => completionsByDay(rows), [rows]);
  const months = React.useMemo(() => monthlyActivity(rows), [rows]);
  const runs = React.useMemo(() => streaks(rows), [rows]);
  const pace = React.useMemo(() => paceStats(rows), [rows]);
  const live = React.useMemo(() => simulcast(rows), [rows]);
  const seasons = React.useMemo(() => byMonthOfYear(rows), [rows]);
  const weekdays = React.useMemo(() => byWeekday(rows), [rows]);

  if (years.length === 0 && live.dated === 0) {
    return (
      <EmptyState
        title="Aucune date"
        description="Renseigne tes dates de début et de fin sur AniList ou MAL : le calendrier, le rythme et le simulcast apparaîtront ici."
      />
    );
  }

  const completedIn = (predicate: (date: Date) => boolean) =>
    rows.filter((r) => r.completedAt !== null && predicate(new Date(r.completedAt)));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Série record"
          value={runs.longest > 0 ? `${runs.longest} mois` : "—"}
          hint={runs.longestFrom !== null ? `depuis ${MONTH_YEAR.format(monthStart(runs.longestFrom))}` : "mois d'affilée avec un titre fini"}
        />
        <StatTile label="Série en cours" value={`${runs.current} mois`} hint="d'affilée, jusqu'à ce mois-ci" />
        <StatTile
          label="Mois record"
          value={runs.record ? plural(runs.record.count, "titre") : "—"}
          hint={runs.record ? MONTH_YEAR.format(monthStart(runs.record.month)) : undefined}
        />
        <StatTile
          label="Pour finir un titre"
          value={pace.medianDays !== null ? duration(pace.medianDays) : "—"}
          hint="en médiane, du début à la fin"
        />
        <StatTile
          label="Après la sortie"
          value={live.medianDelayDays !== null ? duration(live.medianDelayDays) : "—"}
          hint="délai médian avant de commencer"
        />
        <StatTile
          label="Simulcast"
          value={live.share !== null ? formatPercent(live.share) : "—"}
          hint="commencés pendant la diffusion"
        />
      </div>

      {year !== null ? (
        <ChartCard
          title="Calendrier"
          description="Chaque case est un jour ; plus elle est foncée, plus tu as terminé de titres ce jour-là."
          action={
            <div role="group" aria-label="Année" className="no-scrollbar flex max-w-full gap-1.5 overflow-x-auto">
              {years.map((y) => (
                <Chip key={y} pressed={y === year} onClick={() => setYear(y)} className="h-7 px-2.5 text-xs">
                  {y}
                </Chip>
              ))}
            </div>
          }
        >
          <CalendarHeatmap
            year={year}
            days={days}
            onSelect={(date, list) =>
              onSelect({ title: `Terminés le ${new Date(date).toLocaleDateString("fr-FR", { timeZone: "UTC" })}`, rows: list })
            }
          />
        </ChartCard>
      ) : null}

      <ChartCard
        title="Les 24 derniers mois"
        description={
          monthMetric === "count"
            ? "Titres terminés chaque mois."
            : "Heures estimées : le temps de chaque titre terminé, réparti entre ses dates de début et de fin."
        }
        action={
          <div className="flex gap-1.5">
            <Chip pressed={monthMetric === "count"} onClick={() => setMonthMetric("count")} className="h-7 px-2.5 text-xs">
              Titres
            </Chip>
            <Chip pressed={monthMetric === "hours"} onClick={() => setMonthMetric("hours")} className="h-7 px-2.5 text-xs">
              Heures
            </Chip>
          </div>
        }
      >
        <ColumnChart
          series={[{ label: monthMetric === "count" ? "Titres terminés" : "Heures", color: "var(--viz-1)" }]}
          data={months.map((m) => ({
            id: String(m.month),
            label: MONTH_SHORT.format(monthStart(m.month)).replace(".", ""),
            title: MONTH_YEAR.format(monthStart(m.month)),
            values: [monthMetric === "count" ? m.count : Math.round(m.minutes / 6) / 10],
          }))}
          format={(v) => (monthMetric === "count" ? formatInteger(v) : formatDecimal(v))}
          onSelect={(d) =>
            onSelect({
              title: `Terminés en ${MONTH_YEAR.format(monthStart(Number(d.id)))}`,
              rows: rows.filter((r) => r.completedAt !== null && monthIndex(r.completedAt) === Number(d.id)),
            })
          }
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Saisonnalité" description="Titres terminés par mois de l'année, toutes années confondues.">
          <ColumnChart
            series={[{ label: "Titres terminés", color: "var(--viz-1)" }]}
            data={seasons.map((count, m) => ({ id: String(m), label: MONTHS[m]!.replace(".", ""), values: [count] }))}
            format={(v) => formatInteger(v)}
            height={130}
            onSelect={(d) =>
              onSelect({ title: `Terminés en ${MONTHS[Number(d.id)]}`, rows: completedIn((date) => date.getUTCMonth() === Number(d.id)) })
            }
          />
        </ChartCard>
        <ChartCard title="Jour de la semaine" description="Le jour où tu termines tes titres.">
          <ColumnChart
            series={[{ label: "Titres terminés", color: "var(--viz-1)" }]}
            data={weekdays.map((count, i) => ({ id: String(i), label: WEEKDAYS[i]!, values: [count] }))}
            format={(v) => formatInteger(v)}
            height={130}
            onSelect={(d) =>
              onSelect({
                title: `Terminés un ${WEEKDAYS[Number(d.id)]!.toLowerCase()}.`,
                rows: completedIn((date) => (date.getUTCDay() + 6) % 7 === Number(d.id)),
              })
            }
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Rythme"
          description={
            pace.titles > 0
              ? `Épisodes par jour entre le début et la fin, sur ${plural(pace.titles, "titre")} terminé${pace.titles > 1 ? "s" : ""} et daté${pace.titles > 1 ? "s" : ""}.`
              : "Il faut des dates de début et de fin."
          }
        >
          {pace.titles > 0 ? (
            <>
              <ColumnChart
                series={[{ label: "Titres", color: "var(--viz-1)" }]}
                data={pace.buckets.map((b) => ({ id: b.label, label: b.label, title: `${b.label} épisode(s) par jour`, values: [b.rows.length] }))}
                format={(v) => formatInteger(v)}
                height={120}
                onSelect={(d) =>
                  onSelect({
                    title: `Rythme : ${d.label} épisode(s) par jour`,
                    rows: pace.buckets.find((b) => b.label === d.id)?.rows ?? [],
                  })
                }
              />
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Tes marathons les plus rapides</h3>
                <ul className="flex flex-col">
                  {pace.fastest.map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => openTitle(r)}
                        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Cover src={r.cover} alt="" glow={false} sizes="36px" className="w-9 rounded-md" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{r.title}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {r.episodes} épisodes en {plural(r.days, "jour")}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatDecimal(Math.round(r.pace * 10) / 10)}/j</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <EmptyChart>Aucun titre terminé avec ses deux dates.</EmptyChart>
          )}
        </ChartCard>

        <ChartCard
          title="Simulcast ou rattrapage"
          description={
            live.dated > 0
              ? `Sur ${plural(live.dated, "titre")} dont on connaît ta date de début et les dates de diffusion.`
              : "Il faut des dates de début et les dates de diffusion AniList."
          }
        >
          {live.dated > 0 ? (
            <>
              <StackedBar
                segments={[
                  { id: "during", label: "En diffusion", value: live.during.length, color: "var(--viz-1)" },
                  { id: "after", label: "Après coup", value: live.after.length, color: "var(--viz-2)" },
                ]}
                format={formatInteger}
                onSelect={(s) =>
                  onSelect({ title: s.label, rows: s.id === "during" ? live.during : live.after })
                }
              />
              <p className="text-xs text-muted-foreground">Délai entre la sortie et le moment où tu commences</p>
              <ColumnChart
                series={[{ label: "Titres", color: "var(--viz-1)" }]}
                data={live.buckets.map((b) => ({ id: b.label, label: b.label, values: [b.rows.length] }))}
                format={(v) => formatInteger(v)}
                height={110}
                onSelect={(d) =>
                  onSelect({ title: `Délai après la sortie : ${d.label}`, rows: live.buckets.find((b) => b.label === d.id)?.rows ?? [] })
                }
              />
            </>
          ) : (
            <EmptyChart>Pas encore assez de dates.</EmptyChart>
          )}
        </ChartCard>
      </div>

    </div>
  );
}
