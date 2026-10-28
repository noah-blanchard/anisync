"use client";

import * as React from "react";
import { EmptyChart } from "@/components/stats/charts";
import { useElementWidth } from "@/hooks/use-element-width";
import { formatDecimal } from "@/lib/stats/labels";
import type { StatsRow } from "@/lib/stats/types";

const HEIGHT = 300;
const PAD = { top: 12, right: 12, bottom: 34, left: 36 };

/** Stable pseudo-random offset in [-1, 1] from a key, so overlapping points spread the same way every render. */
function jitter(key: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * My score against AniList's average, one dot per title. Above the diagonal, I rated it higher.
 * Hover a dot for its title, click it for the detail.
 */
export function ScoreScatter({ rows, onSelect }: { rows: StatsRow[]; onSelect: (row: StatsRow) => void }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<string | null>(null);
  const points = React.useMemo(
    () =>
      rows
        .filter((r): r is StatsRow & { score: number; community: number } => r.score !== null && r.community !== null)
        .map((r) => ({ row: r, x: r.community + jitter(r.key, 1) * 0.05, y: r.score + jitter(r.key, 2) * 0.3 })),
    [rows],
  );
  if (points.length === 0) return <EmptyChart>Pas de titre noté avec une note AniList.</EmptyChart>;

  const lowest = Math.min(...points.map((p) => Math.min(p.row.score, p.row.community)));
  const lo = Math.max(0, Math.floor(lowest) - 0.5);
  const hi = 10.5;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const sx = (v: number) => PAD.left + ((v - lo) / (hi - lo)) * plotW;
  const sy = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;
  const ticks: number[] = [];
  const step = plotW < 320 ? 2 : 1;
  for (let t = Math.ceil(lo); t <= 10; t += 1) if ((10 - t) % step === 0) ticks.push(t);
  const current = points.find((p) => p.row.key === active);

  return (
    <div ref={ref} className="relative w-full" style={{ height: HEIGHT }}>
      {width > 0 ? (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Nuage de ${points.length} titres : ta note en fonction de la note AniList`}
          className="overflow-visible"
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--viz-grid)" />
              <line x1={PAD.left} x2={PAD.left + plotW} y1={sy(t)} y2={sy(t)} stroke="var(--viz-grid)" />
              <text x={sx(t)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                {t}
              </text>
              <text x={PAD.left - 8} y={sy(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {t}
              </text>
            </g>
          ))}
          <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} stroke="var(--viz-neutral)" strokeWidth={1.5} />
          <text x={PAD.left + 6} y={PAD.top + 14} className="fill-muted-foreground text-[11px]">
            Tu notes plus haut
          </text>
          <text x={PAD.left + plotW - 6} y={PAD.top + plotH - 8} textAnchor="end" className="fill-muted-foreground text-[11px]">
            Tu notes plus bas
          </text>
          <text x={PAD.left + plotW / 2} y={HEIGHT - 2} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            Note AniList
          </text>
          {points.map((p) => (
            <g
              key={p.row.key}
              className="cursor-pointer"
              onPointerEnter={() => setActive(p.row.key)}
              onClick={() => onSelect(p.row)}
            >
              <circle cx={sx(p.x)} cy={sy(p.y)} r={11} fill="transparent" />
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={active === p.row.key ? 6 : 4}
                fill="var(--viz-1)"
                fillOpacity={active === null || active === p.row.key ? 0.8 : 0.35}
                stroke="var(--card)"
                strokeWidth={2}
              />
            </g>
          ))}
        </svg>
      ) : null}
      {current ? (
        <div
          role="status"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(sx(current.x), 80), width - 80), top: sy(current.y) - 10 }}
        >
          <p className="max-w-48 truncate font-medium">{current.row.title}</p>
          <p className="text-muted-foreground tabular-nums">
            Toi <span className="font-semibold text-foreground">{current.row.score}</span> · AniList{" "}
            <span className="font-semibold text-foreground">{formatDecimal(current.row.community)}</span>
          </p>
        </div>
      ) : null}
      <span className="sr-only">Ta note en ordonnée, la note AniList en abscisse.</span>
    </div>
  );
}
