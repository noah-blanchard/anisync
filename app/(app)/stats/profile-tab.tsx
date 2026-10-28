"use client";

import * as React from "react";
import { EmptyState } from "@/components/list-states";
import { ChartCard, MedalBadge, Meter } from "@/components/stats/charts";
import { formatInteger } from "@/lib/stats/labels";
import { achievements, traits, type Achievement, type Medal, type Trait } from "@/lib/stats/profile";
import type { StatsRow } from "@/lib/stats/types";
import { cn } from "@/lib/utils";

const HOW: Record<Trait["id"], string> = {
  volume: "Heures de visionnage, sur une échelle logarithmique : 2 000 h donnent 100.",
  finisher: "Part des titres terminés parmi ceux que tu as terminés ou abandonnés.",
  curiosity: "Diversité des genres regardés (entropie) : 100 = tous les genres à parts égales.",
  gems: "Popularité médiane de tes titres : moins ils sont connus, plus le score monte.",
  retro: "Âge médian de tes titres à aujourd'hui : 25 ans donnent 100.",
  pace: "Épisodes par jour entre tes dates de début et de fin, sur une échelle logarithmique.",
  generosity: "Écart moyen entre ta note et celle de la communauté : 50 = comme tout le monde.",
  simulcast: "Part des titres commencés pendant leur diffusion, d'après tes dates de début.",
  marathon: "Part de ton temps passée sur des séries de plus de 26 épisodes.",
  franchise: "Part de suites et de dérivés dans ce que tu regardes : 50 % donnent 100.",
  backlog: "Titres à voir par rapport aux titres terminés : autant de l'un que de l'autre donnent 100.",
};

const MEDAL_ORDER: Medal[] = ["gold", "silver", "bronze"];
const TIER_NAMES = ["bronze", "argent", "or"];

function AchievementCard({ a }: { a: Achievement }) {
  const nextTier = a.next !== null ? a.tiers.indexOf(a.next) : -1;
  return (
    <li className={cn("flex flex-col gap-2 rounded-2xl border border-border p-4", !a.medal && "opacity-70")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{a.name}</p>
          <p className="text-xs text-muted-foreground">{a.description}</p>
        </div>
        {a.medal ? <MedalBadge medal={a.medal} /> : <span className="shrink-0 text-xs text-muted-foreground">À débloquer</span>}
      </div>
      <p className="text-2xl font-semibold tracking-tight">{formatInteger(a.value)}</p>
      <Meter
        value={a.progress * 100}
        label={a.next !== null ? `${a.name} : ${formatInteger(a.value)} sur ${formatInteger(a.next)}` : `${a.name} : or atteint`}
      />
      <p className="text-xs text-muted-foreground tabular-nums">
        {a.next !== null
          ? `Prochain palier : ${formatInteger(a.next)} (${TIER_NAMES[nextTier]})`
          : "Tous les paliers atteints"}{" "}
        · {a.tiers.map(formatInteger).join(" / ")}
      </p>
    </li>
  );
}

export function ProfileTab({ rows }: { rows: StatsRow[] }) {
  const list = React.useMemo(() => traits(rows), [rows]);
  const badges = React.useMemo(
    () => [...achievements(rows)].sort((a, b) => Number(b.medal !== null) - Number(a.medal !== null) || b.progress - a.progress),
    [rows],
  );
  if (list.length === 0) {
    return <EmptyState title="Profil indisponible" description="Regarde et note quelques titres pour dessiner ton profil." />;
  }
  const medals = MEDAL_ORDER.map((m) => ({
    medal: m,
    count: list.filter((t) => t.medal === m).length + badges.filter((a) => a.medal === m).length,
  })).filter((m) => m.count > 0);
  const unlocked = badges.filter((a) => a.medal !== null).length;

  return (
    <div className="flex flex-col gap-4">
      <ChartCard title="Ton profil de spectateur" description="Chaque axe te situe entre deux pôles ; la médaille mesure l'intensité du trait.">
        <p className="text-xl font-semibold tracking-tight md:text-2xl">{list.map((t) => t.label).join(" · ")}</p>
        {medals.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            {medals.map(({ medal, count }) => (
              <span key={medal} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MedalBadge medal={medal} />× {count}
              </span>
            ))}
            <span className="text-xs text-muted-foreground">axes et succès confondus</span>
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
            <Meter value={t.score} poles={t.poles} centered={t.centered} label={`${t.name} : ${t.label}, ${t.score} sur 100`} />
            <p className="text-sm">{t.detail}</p>
            <p className="text-xs text-muted-foreground">{HOW[t.id]}</p>
          </li>
        ))}
      </ul>

      <ChartCard title="Succès" description={`${unlocked} débloqué${unlocked > 1 ? "s" : ""} sur ${badges.length}, chacun en trois paliers : bronze, argent, or.`}>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {badges.map((a) => (
            <AchievementCard key={a.id} a={a} />
          ))}
        </ul>
      </ChartCard>

      <p className="text-xs text-muted-foreground">
        Médailles des axes : bronze à partir de 35, argent à 60, or à 85. Pour la générosité, c&apos;est l&apos;écart à la
        neutralité qui compte.
      </p>
    </div>
  );
}
