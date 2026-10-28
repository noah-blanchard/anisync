"use client";

import * as React from "react";
import { EmptyState } from "@/components/list-states";
import { ChartCard, MedalBadge, Meter } from "@/components/stats/charts";
import { traits, type Medal, type Trait } from "@/lib/stats/gold";
import type { StatsRow } from "@/lib/stats/types";

const HOW: Record<Trait["id"], string> = {
  volume: "Heures de visionnage, sur une échelle logarithmique : 2 000 h donnent 100.",
  finisher: "Part des titres terminés parmi ceux que tu as terminés ou abandonnés.",
  curiosity: "Diversité des genres regardés (entropie) : 100 = tous les genres à parts égales.",
  gems: "Popularité médiane de tes titres : moins ils sont connus, plus le score monte.",
  retro: "Âge médian de tes titres à aujourd'hui : 25 ans donnent 100.",
  pace: "Épisodes par jour entre tes dates de début et de fin, sur une échelle logarithmique.",
  generosity: "Écart moyen entre ta note et celle de la communauté : 50 = comme tout le monde.",
};

const MEDAL_ORDER: Medal[] = ["gold", "silver", "bronze"];

export function ProfileTab({ rows }: { rows: StatsRow[] }) {
  const list = React.useMemo(() => traits(rows), [rows]);
  if (list.length === 0) {
    return <EmptyState title="Profil indisponible" description="Regarde et note quelques titres pour dessiner ton profil." />;
  }
  const medals = MEDAL_ORDER.map((m) => ({ medal: m, count: list.filter((t) => t.medal === m).length })).filter((m) => m.count > 0);

  return (
    <div className="flex flex-col gap-4">
      <ChartCard title="Ton profil de spectateur" description="Chaque axe te situe entre deux pôles ; la médaille mesure l'intensité du trait.">
        <p className="text-xl font-semibold tracking-tight md:text-2xl">{list.map((t) => t.label).join(" · ")}</p>
        {medals.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {medals.map(({ medal, count }) => (
              <span key={medal} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MedalBadge medal={medal} />× {count}
              </span>
            ))}
          </div>
        ) : null}
      </ChartCard>

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <li key={t.id} className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 md:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t.name}</p>
                <p className="text-lg font-semibold">{t.label}</p>
              </div>
              {t.medal ? <MedalBadge medal={t.medal} /> : null}
            </div>
            <Meter value={t.score} poles={t.poles} centered={t.id === "generosity"} label={`${t.name} : ${t.label}, ${t.score} sur 100`} />
            <p className="text-sm">{t.detail}</p>
            <p className="text-xs text-muted-foreground">{HOW[t.id]}</p>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        Médailles : bronze à partir de 35 sur l&apos;axe, argent à 60, or à 85. Pour la générosité, c&apos;est l&apos;écart à la
        neutralité qui compte.
      </p>
    </div>
  );
}
