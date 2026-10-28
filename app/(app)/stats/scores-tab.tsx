"use client";

import * as React from "react";
import { Cover } from "@/components/entry-bits";
import { EmptyState } from "@/components/list-states";
import { useOverlay } from "@/components/overlay-context";
import { ChartCard, ColumnChart, Legend, Meter, StackedBar, StatTile } from "@/components/stats/charts";
import { ScoreScatter } from "@/components/stats/scatter";
import type { Selection } from "@/components/stats/titles-sheet";
import {
  AGREEMENT_LABELS,
  disagreements,
  GENEROSITY_LABELS,
  MIN_PAIRS,
  raterProfile,
  SPREAD_LABELS,
  type ScoreShares,
} from "@/lib/stats/gold";
import { formatDecimal, formatInteger, formatPercent, formatSigned } from "@/lib/stats/labels";
import { REFERENCE_MEAN, REFERENCE_SD } from "@/lib/stats/silver";
import type { Calibration, StatsRow } from "@/lib/stats/types";

const SHARE_SEGMENTS: { id: keyof ScoreShares; label: string; color: string }[] = [
  { id: "low", label: "Mauvaises (1-4)", color: "var(--viz-negative)" },
  { id: "mid", label: "Moyennes (5-7)", color: "var(--viz-neutral)" },
  { id: "high", label: "Bonnes (8-10)", color: "var(--viz-1)" },
];

const round1 = (v: number) => formatDecimal(Math.round(v * 10) / 10);

function Verdict({ name, label, children }: { name: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-muted/50 p-4">
      <p className="text-xs text-muted-foreground">{name}</p>
      <p className="text-lg font-semibold">{label}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function GapList({ title, rows }: { title: string; rows: (StatsRow & { gap: number })[] }) {
  const { open } = useOverlay();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucun</p> : null}
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => open({ type: "detail", key: r.key })}
              className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Cover src={r.cover} alt="" glow={false} sizes="36px" className="w-9 rounded-md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{r.title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Toi {r.score} · communauté {round1(r.community!)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatSigned(r.gap)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScoresTab({
  rows,
  calibration,
  onSelect,
}: {
  rows: StatsRow[];
  /** Measured on the whole list: the normalization does not move with the filters */
  calibration: Calibration;
  onSelect: (selection: Selection) => void;
}) {
  const { open } = useOverlay();
  const p = React.useMemo(() => raterProfile(rows), [rows]);
  const gaps = React.useMemo(() => disagreements(rows), [rows]);

  if (p.rated === 0) {
    return <EmptyState title="Aucune note" description="Note quelques titres pour découvrir ton profil de noteur." />;
  }

  const eight = calibration.translation.find((t) => t.score === 8) ?? calibration.translation.at(-1);

  return (
    <div className="flex flex-col gap-4">
      <ChartCard
        title="Ton profil de noteur"
        description={`Comparé à la note moyenne AniList des mêmes titres (${formatInteger(p.pairs)} titres notés des deux côtés).`}
      >
        {p.generosityIndex !== null && p.bias !== null ? (
          <div className="flex flex-col gap-2">
            <Meter value={p.generosityIndex} centered poles={["Sévère", "Généreux"]} label="Générosité" />
            <p className="text-sm">
              En moyenne, tu mets <strong className="font-semibold tabular-nums">{formatSigned(p.bias)}</strong> point
              {Math.abs(p.bias) >= 2 ? "s" : ""} par rapport à la communauté.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Il faut au moins {MIN_PAIRS} titres notés avec une note AniList pour te comparer à la communauté.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {p.generosity ? (
            <Verdict name="Générosité" label={GENEROSITY_LABELS[p.generosity]}>
              {p.bias! >= 0.35
                ? "Tu notes plus haut que la moyenne des gens : chez toi, un 8 est une note courante."
                : p.bias! <= -0.35
                  ? "Tu notes plus bas que la moyenne des gens : un 8 de ta part vaut cher."
                  : "Tes notes collent à celles de la communauté."}
            </Verdict>
          ) : null}
          {p.spread && p.sd !== null ? (
            <Verdict name="Amplitude" label={SPREAD_LABELS[p.spread]}>
              Écart-type de {round1(p.sd)} :{" "}
              {p.spread === "cautious"
                ? "tes notes restent groupées, tu nuances peu."
                : p.spread === "nuanced"
                  ? "tu utilises une bonne partie de l'échelle."
                  : "tu n'hésites pas à aller aux extrêmes."}
            </Verdict>
          ) : null}
          {p.agreement && p.correlation !== null ? (
            <Verdict name="Accord avec la communauté" label={AGREEMENT_LABELS[p.agreement]}>
              Corrélation de {formatDecimal(Math.round(p.correlation * 100) / 100)} entre tes notes et les leurs (1 = même
              classement).
            </Verdict>
          ) : null}
        </div>
      </ChartCard>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Moyenne" value={p.mean !== null ? round1(p.mean) : "—"} hint={`sur ${formatInteger(p.rated)} notes`} />
        <StatTile label="Médiane" value={p.median !== null ? round1(p.median) : "—"} />
        <StatTile label="Écart-type" value={p.sd !== null ? round1(p.sd) : "—"} hint="dispersion de tes notes" />
        <StatTile
          label="Plage habituelle"
          value={p.p10 !== null && p.p90 !== null ? `${round1(p.p10)} – ${round1(p.p90)}` : "—"}
          hint="80 % de tes notes"
        />
        <StatTile label="Notes utilisées" value={`${p.distinct}/10`} hint={`de ${p.min} à ${p.max}`} />
        <StatTile
          label="Non notés"
          value={formatInteger(p.unrated)}
          hint={formatPercent(p.unrated / Math.max(1, p.rated + p.unrated))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Distribution des notes" description="Tes notes et la moyenne AniList arrondie des mêmes titres.">
          <ColumnChart
            series={[
              { label: "Toi", color: "var(--viz-1)" },
              { label: "Communauté", color: "var(--viz-2)" },
            ]}
            data={p.histogram.map((h) => ({ id: String(h.score), label: String(h.score), title: `Note ${h.score}`, values: [h.mine, h.community] }))}
            format={(v) => formatInteger(v)}
            onSelect={(d) =>
              onSelect({
                title: `Notés ${d.id}/10`,
                rows: rows.filter((r) => r.score === Number(d.id)),
                filter: { scoreMin: Number(d.id), scoreMax: Number(d.id) },
              })
            }
          />
        </ChartCard>

        <ChartCard title="Bonnes, moyennes, mauvaises" description="Comment tu répartis tes notes, comparé à la communauté sur les mêmes titres.">
          {p.shares ? (
            <div className="flex flex-col gap-4">
              {(["mine", "community"] as const).map((side) => (
                <div key={side} className="flex flex-col gap-1.5">
                  <p className="flex justify-between text-sm">
                    <span className="font-medium">{side === "mine" ? "Toi" : "Communauté"}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatPercent(p.shares![side].high)} de bonnes · {formatPercent(p.shares![side].low)} de mauvaises
                    </span>
                  </p>
                  <StackedBar
                    legend={false}
                    label={`${side === "mine" ? "Toi" : "Communauté"} : ${SHARE_SEGMENTS.map((s) => `${s.label} ${formatPercent(p.shares![side][s.id])}`).join(", ")}`}
                    segments={SHARE_SEGMENTS.map((s) => ({ ...s, value: p.shares![side][s.id] }))}
                    format={formatPercent}
                  />
                </div>
              ))}
              <Legend series={SHARE_SEGMENTS} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pas assez de titres notés des deux côtés.</p>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Toi contre la communauté"
        description="Un point par titre : ta note (verticale) contre la moyenne AniList (horizontale). Au-dessus de la diagonale, tu as noté plus haut."
      >
        <ScoreScatter rows={rows} onSelect={(r) => open({ type: "detail", key: r.key })} />
      </ChartCard>

      <ChartCard
        title="Tes notes sur une base commune"
        description={`On retire ta générosité et ton amplitude pour ramener tes notes sur un noteur type (moyenne ${REFERENCE_MEAN}, écart-type ${formatDecimal(REFERENCE_SD)}). Calculé sur toute ta liste, quels que soient les filtres.`}
      >
        {eight ? (
          <p className="text-sm">
            Ton <strong className="font-semibold">{eight.score}</strong> te place au-dessus de{" "}
            <strong className="font-semibold tabular-nums">{formatPercent(eight.percentile / 100)}</strong> de tes notes et vaut un{" "}
            <strong className="font-semibold tabular-nums">{round1(eight.normalized)}</strong> chez un noteur type.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">Ta note</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Titres</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Rang</th>
                <th scope="col" className="py-2 text-right font-medium">Base commune</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...calibration.translation].reverse().map((t) => (
                <tr key={t.score} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-semibold">
                    {t.score}/10
                  </th>
                  <td className="py-2 pr-3 text-right text-muted-foreground">{formatInteger(t.count)}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">top {formatPercent(1 - t.percentile / 100)}</td>
                  <td className="py-2 text-right font-medium">{round1(t.normalized)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard title="Tes plus gros désaccords" description="Les titres où ta note s'éloigne le plus de la moyenne AniList.">
        <div className="grid gap-6 md:grid-cols-2">
          <GapList title="Tu as surnoté" rows={gaps.over} />
          <GapList title="Tu as sous-noté" rows={gaps.under} />
        </div>
      </ChartCard>
    </div>
  );
}
