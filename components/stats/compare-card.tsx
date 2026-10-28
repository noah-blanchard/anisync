"use client";

import * as React from "react";
import { Cover } from "@/components/entry-bits";
import { ChartCard, EmptyChart, Meter } from "@/components/stats/charts";
import { useOpenTitle } from "@/components/stats/open-title";
import { compare, COMPATIBILITY_LABELS, compatibilityLevel, MIN_SHARED_RATINGS, type Pair } from "@/lib/stats/compare";
import { formatDecimal, formatInteger, formatSigned } from "@/lib/stats/labels";
import type { StatsRow } from "@/lib/stats/types";

function PairRow({ pair, name }: { pair: Pair; name: string }) {
  const openTitle = useOpenTitle();
  return (
    <li>
      <button
        type="button"
        onClick={() => openTitle(pair.mine)}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Cover src={pair.mine.cover} alt="" glow={false} sizes="36px" className="w-9 rounded-md" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{pair.mine.title}</span>
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            Toi {pair.mine.score} · {name} {pair.theirs.score}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatSigned(pair.gap)}</span>
      </button>
    </li>
  );
}

/** How my tastes compare with the profile being viewed (whole lists, not the filtered slice). */
export function CompareCard({ mine, theirs, name }: { mine: StatsRow[]; theirs: StatsRow[]; name: string }) {
  const openTitle = useOpenTitle();
  const c = React.useMemo(() => compare(mine, theirs), [mine, theirs]);

  return (
    <ChartCard
      title={`Toi et ${name}`}
      description={`${formatInteger(c.shared)} titre${c.shared > 1 ? "s" : ""} vu${c.shared > 1 ? "s" : ""} tous les deux, ${formatInteger(c.bothRated)} noté${c.bothRated > 1 ? "s" : ""} des deux côtés. Les notes sont comparées sur la base commune : la générosité de chacun ne compte pas.`}
    >
      {c.compatibility !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <p className="text-4xl font-semibold tracking-tight">{c.compatibility} %</p>
            <p className="text-lg font-semibold">{COMPATIBILITY_LABELS[compatibilityLevel(c.compatibility)]}</p>
          </div>
          <Meter value={c.compatibility} poles={["Goûts opposés", "Âmes sœurs"]} label={`Compatibilité ${c.compatibility} sur 100`} />
          {c.meanGap !== null ? (
            <p className="text-sm text-muted-foreground">
              Sur vos titres communs, {name} note en moyenne {formatSigned(c.meanGap)} point
              {Math.abs(c.meanGap) >= 2 ? "s" : ""} par rapport à toi (base commune).
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Il faut au moins {MIN_SHARED_RATINGS} titres notés tous les deux pour calculer une compatibilité.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold">Vos plus gros désaccords</h3>
          {c.disagreements.length > 0 ? (
            <ul className="flex flex-col">
              {c.disagreements.map((p) => (
                <PairRow key={p.mine.key} pair={p} name={name} />
              ))}
            </ul>
          ) : (
            <EmptyChart>Aucun titre noté en commun.</EmptyChart>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold">Vos coups de cœur communs</h3>
          {c.agreements.length > 0 ? (
            <ul className="flex flex-col">
              {c.agreements.map((p) => (
                <PairRow key={p.mine.key} pair={p} name={name} />
              ))}
            </ul>
          ) : (
            <EmptyChart>Pas encore de note identique.</EmptyChart>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold">Ses favoris que tu n&apos;as pas</h3>
          {c.theirFavourites.length > 0 ? (
            <ul className="flex flex-col">
              {c.theirFavourites.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => openTitle(r)}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Cover src={r.cover} alt="" glow={false} sizes="36px" className="w-9 rounded-md" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{r.title}</span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {name} {r.score}
                        {r.community !== null ? ` · AniList ${formatDecimal(r.community)}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyChart>Tu as déjà tous ses favoris.</EmptyChart>
          )}
        </div>
      </div>
    </ChartCard>
  );
}
