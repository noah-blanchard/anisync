"use client";

import * as React from "react";
import { EmptyChart } from "@/components/stats/charts";
import { useElementWidth } from "@/hooks/use-element-width";

const PAD = { top: 10, right: 12, bottom: 24, left: 40 };
const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" });

export interface LinePoint {
  /** epoch ms */
  x: number;
  y: number;
}

function niceRange(min: number, max: number, zero: boolean): [number, number] {
  const lo = zero ? Math.min(0, min) : min;
  if (max === lo) return [lo - 1, max + 1];
  const pad = zero ? 0 : (max - lo) * 0.1;
  return [Math.floor(lo - pad), Math.ceil(max + pad)];
}

/**
 * One series over time: a 2px line over a light wash. The crosshair snaps to the nearest date
 * and the readout shows its value; first and last values are labelled.
 */
export function LineChart({
  points,
  label,
  format = (v) => String(v),
  height = 160,
  zero = true,
  monthly = false,
}: {
  points: LinePoint[];
  /** Name of the series, for the accessible summary */
  label: string;
  format?: (value: number) => string;
  height?: number;
  /** Start the axis at zero (counts) or fit the data (means) */
  zero?: boolean;
  /** Points are months: date labels show the month */
  monthly?: boolean;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<number | null>(null);
  if (points.length < 2) return <EmptyChart>Pas encore assez de points.</EmptyChart>;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = niceRange(Math.min(...ys), Math.max(...ys), zero);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const sx = (x: number) => PAD.left + ((x - x0) / Math.max(1, x1 - x0)) * plotW;
  const sy = (y: number) => PAD.top + (1 - (y - y0) / (y1 - y0)) * plotH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const area = `${path}L${sx(x1).toFixed(1)},${sy(y0)}L${sx(x0).toFixed(1)},${sy(y0)}Z`;
  const dateLabel = (x: number) => (monthly ? MONTH.format(x) : DATE.format(x));
  const current = active !== null ? points[active] : undefined;

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = x0 + ((e.clientX - box.left - PAD.left) / Math.max(1, plotW)) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.x - x) < Math.abs(points[best]!.x - x)) best = i;
    setActive(best);
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label} : de ${format(ys[0]!)} le ${dateLabel(xs[0]!)} à ${format(ys.at(-1)!)} le ${dateLabel(xs.at(-1)!)}`}
          onPointerMove={onPointer}
          onPointerLeave={() => setActive(null)}
          className="touch-pan-y overflow-visible"
        >
          {[y0, (y0 + y1) / 2, y1].map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={sy(t)} y2={sy(t)} stroke={t === y0 ? "var(--viz-neutral)" : "var(--viz-grid)"} />
              <text x={PAD.left - 8} y={sy(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {format(Math.round(t * 10) / 10)}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={height - 4} className="fill-muted-foreground text-[11px]">
            {dateLabel(x0)}
          </text>
          <text x={PAD.left + plotW} y={height - 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
            {dateLabel(x1)}
          </text>
          <path d={area} fill="var(--viz-1)" fillOpacity={0.1} />
          <path d={path} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={sx(xs.at(-1)!)} cy={sy(ys.at(-1)!)} r={4} fill="var(--viz-1)" stroke="var(--card)" strokeWidth={2} />
          {current ? (
            <g>
              <line x1={sx(current.x)} x2={sx(current.x)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--viz-neutral)" />
              <circle cx={sx(current.x)} cy={sy(current.y)} r={5} fill="var(--viz-1)" stroke="var(--card)" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
      {current ? (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(sx(current.x), 70), width - 70) }}
        >
          <p className="font-semibold tabular-nums">{format(current.y)}</p>
          <p className="text-muted-foreground">{dateLabel(current.x)}</p>
        </div>
      ) : null}
    </div>
  );
}
