"use client";

import {
  ArrowRightLeftIcon,
  CheckIcon,
  ChevronsRightIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  StarIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Cover } from "@/components/entry-bits";
import { ChartCard, ColumnChart, EmptyChart, StatTile } from "@/components/stats/charts";
import { Chip } from "@/components/stats/filters";
import { LineChart } from "@/components/stats/line-chart";
import { useOpenTitle } from "@/components/stats/open-title";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHistory } from "@/hooks/use-stats";
import type { CanonicalStatus } from "@/lib/mapping";
import { backlogTrend, cumulativeByMonth, scoresByYear, type HistoryEvent, type HistoryEventKind } from "@/lib/stats/history";
import { formatDecimal, formatInteger, formatSigned, statusLabel } from "@/lib/stats/labels";
import { DAY_MS, monthStart } from "@/lib/stats/time";
import type { StatsRow } from "@/lib/stats/types";

const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const COMPACT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const EVENTS_STEP = 30;

const EVENT_ICONS: Record<HistoryEventKind, LucideIcon> = {
  added: PlusIcon,
  removed: MinusIcon,
  started: PlayIcon,
  completed: CheckIcon,
  dropped: XIcon,
  paused: PauseIcon,
  status: ArrowRightLeftIcon,
  rated: StarIcon,
  progressed: ChevronsRightIcon,
};

function describe(e: HistoryEvent): string {
  const status = (s: number | CanonicalStatus | undefined) => statusLabel(String(s));
  switch (e.kind) {
    case "added":
      return `Ajouté (${status(e.to).toLowerCase()})`;
    case "removed":
      return "Retiré de la liste";
    case "started":
      return e.from === "plan_to_watch" ? "Commencé" : `${status(e.from)} → ${status(e.to)}`;
    case "completed":
      return "Terminé";
    case "dropped":
      return "Abandonné";
    case "paused":
      return "Mis en pause";
    case "status":
      return `${status(e.from)} → ${status(e.to)}`;
    case "rated":
      return e.from ? `Note ${e.from} → ${e.to}` : `Noté ${e.to}/10`;
    case "progressed":
      return `Ép. ${e.from} → ${e.to}`;
  }
}

function SnapshotsHistory({ user, rows }: { user?: string; rows: StatsRow[] }) {
  const openTitle = useOpenTitle();
  const { data, isPending, error } = useHistory(user);
  const [shown, setShown] = React.useState(EVENTS_STEP);

  const byId = React.useMemo(() => {
    const map = new Map<number, StatsRow>();
    for (const r of rows) {
      const id = data?.service === "mal" ? r.malId : r.anilistId;
      if (id !== null) map.set(id, r);
    }
    return map;
  }, [rows, data?.service]);

  if (isPending) return <Skeleton className="h-64 w-full rounded-3xl" />;
  if (error) return <EmptyChart>Historique indisponible : {error.message}</EmptyChart>;

  const points = data.points;
  if (points.length < 2) {
    return (
      <ChartCard title="Historique jour par jour" description="En construction.">
        <p className="text-sm">
          Une copie de la liste est enregistrée chaque jour où les stats sont ouvertes
          {points[0] ? `, depuis le ${SHORT.format(Date.parse(points[0].day))}` : ""}. Dès la deuxième, cette section montre
          l&apos;évolution jour par jour et le journal des changements : ajouts, titres terminés, notes modifiées…
        </p>
      </ChartCard>
    );
  }

  const last = Date.parse(points.at(-1)!.day);
  const recent = data.events.filter((e) => last - Date.parse(e.day) < 30 * DAY_MS);
  const trend = backlogTrend(points);
  const series = (pick: (p: (typeof points)[number]) => number | null) =>
    points.flatMap((p) => {
      const y = pick(p);
      return y === null ? [] : [{ x: Date.parse(p.day), y }];
    });
  const days = [...new Set(data.events.slice(0, shown).map((e) => e.day))];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Suivi depuis" value={COMPACT.format(Date.parse(points[0]!.day))} hint={`${points.length} copies`} />
        <StatTile label="Ajoutés" value={formatInteger(recent.filter((e) => e.kind === "added").length)} hint="sur 30 jours" />
        <StatTile label="Terminés" value={formatInteger(recent.filter((e) => e.kind === "completed").length)} hint="sur 30 jours" />
        <StatTile
          label="Backlog"
          value={trend.perMonth !== null ? `${formatSigned(trend.perMonth)}/mois` : "—"}
          hint={
            trend.emptyAt !== null
              ? `vide vers le ${SHORT.format(trend.emptyAt)} à ce rythme`
              : trend.perMonth !== null
                ? trend.perMonth > 0
                  ? "il grossit"
                  : "stable"
                : "tendance sur 60 jours"
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Titres dans la liste">
          <LineChart points={series((p) => p.total)} label="Titres dans la liste" format={formatInteger} height={140} />
        </ChartCard>
        <ChartCard title="Terminés">
          <LineChart points={series((p) => p.byStatus.completed)} label="Titres terminés" format={formatInteger} height={140} />
        </ChartCard>
        <ChartCard title="À voir">
          <LineChart points={series((p) => p.byStatus.plan_to_watch)} label="Titres à voir" format={formatInteger} height={140} />
        </ChartCard>
        <ChartCard title="Note moyenne">
          <LineChart
            points={series((p) => p.meanScore)}
            label="Note moyenne"
            format={(v) => formatDecimal(Math.round(v * 10) / 10)}
            height={140}
            zero={false}
          />
        </ChartCard>
      </div>

      <ChartCard title="Journal" description="Ce qui a changé d'une copie à l'autre, du plus récent au plus ancien.">
        {data.events.length === 0 ? (
          <EmptyChart>Rien n&apos;a bougé depuis le début du suivi.</EmptyChart>
        ) : (
          <div className="flex flex-col gap-5">
            {days.map((day) => (
              <section key={day} className="flex flex-col gap-1">
                <h3 className="text-xs font-medium text-muted-foreground first-letter:uppercase">{DAY.format(Date.parse(day))}</h3>
                <ul className="grid gap-x-6 md:grid-cols-2">
                  {data.events
                    .slice(0, shown)
                    .filter((e) => e.day === day)
                    .map((e, i) => {
                      const row = byId.get(e.id);
                      const Icon = EVENT_ICONS[e.kind];
                      return (
                        <li key={`${e.id}-${e.kind}-${i}`}>
                          <button
                            type="button"
                            disabled={!row}
                            onClick={() => row && openTitle(row)}
                            className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none enabled:hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Cover src={row?.cover ?? null} alt="" glow={false} sizes="32px" className="w-8 rounded-md" />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm font-medium">{row?.title ?? `Titre n°${e.id}`}</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Icon aria-hidden className="size-3.5 shrink-0" />
                                {describe(e)}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
            {data.events.length > shown ? (
              <Button variant="ghost" className="self-start" onClick={() => setShown((n) => n + EVENTS_STEP)}>
                Voir plus
              </Button>
            ) : null}
          </div>
        )}
      </ChartCard>
    </>
  );
}

export function HistoryTab({ rows, allRows, user }: { rows: StatsRow[]; allRows: StatsRow[]; user?: string }) {
  const [cumulative, setCumulative] = React.useState<"completed" | "added">("completed");
  const months = React.useMemo(() => cumulativeByMonth(rows), [rows]);
  const years = React.useMemo(() => scoresByYear(rows), [rows]);
  const hasAdded = months.length > 0 && months.at(-1)!.added > 0;
  const first = years[0];
  const latest = years.at(-1);

  return (
    <div className="flex flex-col gap-4">
      <ChartCard
        title="Ta liste depuis le début"
        description={
          cumulative === "completed"
            ? "Titres terminés, cumulés mois après mois, d'après tes dates de fin."
            : "Titres ajoutés, cumulés mois après mois, d'après les dates d'ajout AniList."
        }
        action={
          hasAdded ? (
            <div className="flex gap-1.5">
              <Chip pressed={cumulative === "completed"} onClick={() => setCumulative("completed")} className="h-7 px-2.5 text-xs">
                Terminés
              </Chip>
              <Chip pressed={cumulative === "added"} onClick={() => setCumulative("added")} className="h-7 px-2.5 text-xs">
                Ajoutés
              </Chip>
            </div>
          ) : null
        }
      >
        <LineChart
          points={months.map((m) => ({ x: monthStart(m.month), y: m[cumulative] }))}
          label={cumulative === "completed" ? "Titres terminés, cumulés" : "Titres ajoutés, cumulés"}
          format={formatInteger}
          monthly
          height={200}
        />
      </ChartCard>

      <ChartCard
        title="Tes notes au fil des ans"
        description={
          first && latest && first !== latest && first.bias !== null && latest.bias !== null
            ? `Écart avec la communauté : ${formatSigned(first.bias)} en ${first.year}, ${formatSigned(latest.bias)} en ${latest.year}. ${
                latest.bias < first.bias - 0.2 ? "Tu notes de plus en plus bas." : latest.bias > first.bias + 0.2 ? "Tu notes de plus en plus haut." : "Ta façon de noter reste stable."
              }`
            : "Ta note moyenne et celle de la communauté sur les titres terminés chaque année."
        }
      >
        <ColumnChart
          series={[
            { label: "Toi", color: "var(--viz-1)" },
            { label: "Communauté", color: "var(--viz-2)" },
          ]}
          data={years.map((y) => ({
            id: String(y.year),
            label: String(y.year),
            title: `${y.year} · ${y.rated} titre${y.rated > 1 ? "s" : ""} noté${y.rated > 1 ? "s" : ""}`,
            values: [y.mine, y.community ?? 0],
          }))}
          format={(v) => formatDecimal(v)}
        />
      </ChartCard>

      <SnapshotsHistory user={user} rows={allRows} />

      <p className="text-xs text-muted-foreground">
        Les deux premières sections suivent les filtres ; l&apos;historique jour par jour porte sur toute la liste.
      </p>
    </div>
  );
}
