"use client";

import { ArrowRightIcon } from "lucide-react";
import * as React from "react";
import { Cover } from "@/components/entry-bits";
import { EmptyState } from "@/components/list-states";
import { useOverlay } from "@/components/overlay-context";
import { BarList, ChartCard, EmptyChart, StatTile } from "@/components/stats/charts";
import type { Selection } from "@/components/stats/titles-sheet";
import { Button } from "@/components/ui/button";
import { backlogStats, FORGOTTEN_DAYS, forgotten, nextUp } from "@/lib/stats/backlog";
import { groupBy } from "@/lib/stats/gold";
import { formatDecimal, formatHours, formatInteger, formatPercent, formatSigned, genreLabel, statusLabel } from "@/lib/stats/labels";
import { DAY_MS } from "@/lib/stats/time";
import type { StatsRow } from "@/lib/stats/types";

const FORGOTTEN_SHOWN = 10;

/** "3 mois", "2,5 ans" */
function since(days: number): string {
  if (days < 60) return `${Math.max(1, Math.round(days))} j`;
  if (days < 730) return `${Math.round(days / 30.4)} mois`;
  return `${formatDecimal(Math.round((days / 365.25) * 10) / 10)} ans`;
}

function TitleRow({ row, detail, value }: { row: StatsRow; detail: React.ReactNode; value?: React.ReactNode }) {
  const { open } = useOverlay();
  return (
    <li>
      <button
        type="button"
        onClick={() => open({ type: "detail", key: row.key })}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Cover src={row.cover} alt="" glow={false} sizes="40px" className="w-10 rounded-lg" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{row.title}</span>
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        {value !== undefined ? <span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span> : null}
      </button>
    </li>
  );
}

export function BacklogTab({ rows, onSelect }: { rows: StatsRow[]; onSelect: (selection: Selection) => void }) {
  const now = React.useMemo(() => Date.now(), []);
  const b = React.useMemo(() => backlogStats(rows, now), [rows, now]);
  const stuck = React.useMemo(() => forgotten(rows, now), [rows, now]);
  const next = React.useMemo(() => nextUp(rows), [rows]);
  const planned = React.useMemo(() => rows.filter((r) => r.status === "plan_to_watch"), [rows]);
  const genres = React.useMemo(() => groupBy(planned, "genre"), [planned]);

  if (b.count === 0 && stuck.length === 0) {
    return <EmptyState title="Backlog vide" description="Rien à voir et rien d'oublié : ajoute des animes « À voir » pour les retrouver ici." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="À voir" value={formatInteger(b.count)} hint={b.count > 0 ? `${formatPercent(b.count / Math.max(1, rows.length))} de ta liste` : undefined} />
        <StatTile
          label="Durée"
          value={formatHours(b.minutes)}
          hint={b.unknownLength > 0 ? `+ ${b.unknownLength} de durée inconnue` : "épisodes connus"}
        />
        <StatTile label="Âge médian" value={b.medianAgeDays !== null ? since(b.medianAgeDays) : "—"} hint="depuis l'ajout (AniList)" />
        <StatTile label="Ton rythme" value={`${formatDecimal(Math.round(b.monthlyHours * 10) / 10)} h`} hint="par mois, sur les 12 derniers" />
        <StatTile
          label="Pour tout voir"
          value={b.monthsToClear !== null ? since(b.monthsToClear * 30.4) : "—"}
          hint="à ce rythme, sans rien ajouter"
        />
        <StatTile label="Oubliés" value={formatInteger(stuck.length)} hint={`en cours, rien depuis ${FORGOTTEN_DAYS} j`} />
      </div>

      <ChartCard
        title="À regarder ensuite"
        description="Ton backlog trié par note attendue : la note AniList, ajustée selon ce que tu penses des genres du titre."
      >
        {next.length > 0 ? (
          <ul className="grid gap-x-6 md:grid-cols-2">
            {next.map((s) => (
              <TitleRow
                key={s.row.key}
                row={s.row}
                detail={[
                  s.because ? `${genreLabel(s.because.genre)} ${formatSigned(s.because.affinity)}` : null,
                  s.row.community !== null ? `AniList ${formatDecimal(s.row.community)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={formatDecimal(s.predicted)}
              />
            ))}
          </ul>
        ) : (
          <EmptyChart>Rien dans ton backlog.</EmptyChart>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Genres du backlog" description="Ce qui t'attend.">
          <BarList
            items={genres.map((g) => ({
              id: g.value,
              label: genreLabel(g.value),
              value: g.count,
              display: formatInteger(g.count),
              secondary: formatPercent(g.share),
            }))}
            limit={8}
            onSelect={(item) =>
              onSelect({
                title: `À voir : ${item.label}`,
                rows: planned.filter((r) => r.genres.includes(item.id)),
                filter: { genres: [item.id], statuses: ["plan_to_watch"] },
              })
            }
            empty="Pas de genres connus dans le backlog."
          />
        </ChartCard>

        <ChartCard title="Les plus anciens" description="Ajoutés il y a le plus longtemps (dates d'ajout AniList).">
          {b.oldest.length > 0 ? (
            <ul className="flex flex-col">
              {b.oldest.map((r) => (
                <TitleRow
                  key={r.key}
                  row={r}
                  detail={`Ajouté il y a ${since((now - r.addedAt!) / DAY_MS)}`}
                  value={r.community !== null ? formatDecimal(r.community) : undefined}
                />
              ))}
            </ul>
          ) : (
            <EmptyChart>Pas de date d&apos;ajout connue.</EmptyChart>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Oubliés"
        description={`En cours ou en pause, sans mise à jour depuis plus de ${FORGOTTEN_DAYS} jours : à reprendre ou à abandonner.`}
        action={
          stuck.length > FORGOTTEN_SHOWN ? (
            <Button variant="ghost" size="sm" onClick={() => onSelect({ title: "Oubliés", rows: stuck })}>
              Voir les {stuck.length}
              <ArrowRightIcon />
            </Button>
          ) : null
        }
      >
        {stuck.length > 0 ? (
          <ul className="grid gap-x-6 md:grid-cols-2">
            {stuck.slice(0, FORGOTTEN_SHOWN).map((r) => (
              <TitleRow
                key={r.key}
                row={r}
                detail={`${statusLabel(r.status)} · ép. ${r.progress}${r.episodes ? `/${r.episodes}` : ""} · rien depuis ${since((now - r.updatedAt!) / DAY_MS)}`}
              />
            ))}
          </ul>
        ) : (
          <EmptyChart>Rien d&apos;oublié : tout ce qui est en cours bouge.</EmptyChart>
        )}
      </ChartCard>
    </div>
  );
}
