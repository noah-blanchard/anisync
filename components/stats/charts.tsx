"use client";

import { MedalIcon } from "lucide-react";
import * as React from "react";
import type { Medal } from "@/lib/stats/profile";
import { cn } from "@/lib/utils";

/**
 * Hand-made charts for the stats page. Shared rules: thin marks with a rounded data end,
 * 2px surface gaps between touching fills, one hue per series (validated --viz-* slots, fixed order),
 * text in text colours only, and every value readable without hovering.
 */

export function ChartCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4 rounded-3xl border border-border bg-card p-4 md:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function EmptyChart({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// Horizontal bars
// ---------------------------------------------------------------------------

export interface BarItem {
  id: string;
  label: string;
  value: number;
  /** Formatted value shown at the end of the row */
  display: string;
  /** Muted context next to the value ("12 titres") */
  secondary?: string;
}

/**
 * One row per item: label and value on top, the bar below. `diverging` draws from a centre line:
 * --viz-1 above zero, --viz-negative below.
 */
export function BarList({
  items,
  domain,
  diverging = false,
  onSelect,
  limit = 12,
  empty = "Pas assez de données",
}: {
  items: BarItem[];
  /** Largest value of the scale (default: largest value) */
  domain?: number;
  diverging?: boolean;
  onSelect?: (item: BarItem) => void;
  limit?: number;
  empty?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (items.length === 0) return <EmptyChart>{empty}</EmptyChart>;
  const max = domain ?? Math.max(...items.map((i) => Math.abs(i.value)), Number.EPSILON);
  const shown = expanded ? items : items.slice(0, limit);

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {shown.map((item) => {
          const ratio = Math.min(1, Math.abs(item.value) / max);
          const content = (
            <>
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm">{item.label}</span>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {item.display}
                  {item.secondary ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">{item.secondary}</span>
                  ) : null}
                </span>
              </span>
              <span aria-hidden className="relative mt-1.5 block h-2 w-full">
                {diverging ? (
                  <>
                    <span className="absolute inset-y-[-2px] left-1/2 w-px bg-viz-neutral" />
                    <span
                      className={cn(
                        "absolute inset-y-0",
                        item.value >= 0 ? "left-[calc(50%+1px)] rounded-r-[4px] bg-viz-1" : "right-[calc(50%+1px)] rounded-l-[4px] bg-viz-negative",
                      )}
                      style={{ width: `calc(${ratio * 50}% - 1px)` }}
                    />
                  </>
                ) : (
                  <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-viz-1" style={{ width: `${Math.max(ratio * 100, 0.5)}%` }} />
                )}
              </span>
            </>
          );
          return (
            <li key={item.id}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="-mx-2 flex w-[calc(100%+1rem)] flex-col rounded-xl px-2 py-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                <div className="flex flex-col py-2">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > limit ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 self-start rounded-lg px-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? "Réduire" : `Voir les ${items.length} valeurs`}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns (histograms, years)
// ---------------------------------------------------------------------------

export interface ColumnSeries {
  label: string;
  /** CSS colour, a --viz-* slot */
  color: string;
}

export interface ColumnDatum {
  id: string;
  /** Axis label */
  label: string;
  /** Longer label for the tooltip */
  title?: string;
  /** One value per series */
  values: number[];
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  // Even steps, so the middle gridline of integer data stays an integer.
  const step = [1, 2, 4, 6, 8, 10].find((s) => s * magnitude >= value)!;
  return step * magnitude;
}

export function Legend({ series }: { series: ColumnSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns, grouped when there are several series. Hover or focus a column for its values. */
export function ColumnChart({
  series,
  data,
  format = (v) => String(v),
  height = 160,
  onSelect,
}: {
  series: ColumnSeries[];
  data: ColumnDatum[];
  format?: (value: number) => string;
  height?: number;
  onSelect?: (datum: ColumnDatum) => void;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  if (data.length === 0) return <EmptyChart>Pas assez de données</EmptyChart>;

  const max = niceMax(Math.max(...data.flatMap((d) => d.values)));
  // Keep axis labels readable: with many columns, label one in N.
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));
  const ticks = [0, 0.5, 1];
  const current = active !== null ? data[active] : undefined;

  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 ? <Legend series={series} /> : null}
      <div className="flex gap-2">
        <div aria-hidden className="relative w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>
              {format(Math.round(max * t * 10) / 10)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative" style={{ height }}>
            {ticks.map((t) => (
              <span
                key={t}
                aria-hidden
                className={cn("absolute inset-x-0 h-px", t === 0 ? "bg-viz-neutral" : "bg-viz-grid")}
                style={{ top: `${(1 - t) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end">
              {data.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  aria-label={`${d.title ?? d.label} : ${d.values.map((v, s) => `${series[s]?.label} ${format(v)}`).join(", ")}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  onClick={onSelect ? () => onSelect(d) : undefined}
                  className={cn(
                    "flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] px-[1px] outline-none focus-visible:bg-muted/60",
                    active === i && "bg-muted/50",
                    !onSelect && "cursor-default",
                  )}
                >
                  {d.values.map((v, s) => (
                    <span
                      key={s}
                      className="block w-full max-w-6 rounded-t-[4px]"
                      style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: series[s]?.color }}
                    />
                  ))}
                </button>
              ))}
            </div>
            {current ? (
              <div
                role="status"
                className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg"
                style={{ left: `clamp(4rem, ${((active! + 0.5) / data.length) * 100}%, calc(100% - 4rem))` }}
              >
                <p className="mb-1 text-muted-foreground">{current.title ?? current.label}</p>
                {current.values.map((v, s) => (
                  <p key={s} className="flex items-center gap-2 whitespace-nowrap">
                    <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: series[s]?.color }} />
                    <span className="font-semibold tabular-nums">{format(v)}</span>
                    {series.length > 1 ? <span className="text-muted-foreground">{series[s]?.label}</span> : null}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <div aria-hidden className="mt-1.5 flex text-[11px] text-muted-foreground">
            {data.map((d, i) => (
              <span key={d.id} className="min-w-0 flex-1 truncate text-center tabular-nums">
                {i % labelEvery === 0 ? d.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">Valeur</th>
            {series.map((s) => (
              <th key={s.label} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id}>
              <th scope="row">{d.title ?? d.label}</th>
              {d.values.map((v, s) => (
                <td key={s}>{format(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Part to whole
// ---------------------------------------------------------------------------

export interface Segment {
  id: string;
  label: string;
  value: number;
  color: string;
}

/** One horizontal bar split in parts (2px gaps), with a legend carrying every value. */
export function StackedBar({
  segments,
  onSelect,
  format = (v) => String(v),
  legend = true,
  label,
}: {
  segments: Segment[];
  onSelect?: (segment: Segment) => void;
  format?: (value: number) => string;
  legend?: boolean;
  /** Accessible name of the bar */
  label?: string;
}) {
  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <EmptyChart>Pas assez de données</EmptyChart>;
  const percent = (v: number) => `${Math.round((v / total) * 100)} %`;

  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={label ?? visible.map((s) => `${s.label} ${percent(s.value)}`).join(", ")} className="flex h-4 w-full gap-[2px]">
        {visible.map((s, i) => (
          <span
            key={s.id}
            title={`${s.label} : ${format(s.value)} (${percent(s.value)})`}
            className={cn("h-full min-w-[3px]", i === 0 && "rounded-l-[4px]", i === visible.length - 1 && "rounded-r-[4px]")}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      {legend ? (
        <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {visible.map((s) => {
            const content = (
              <>
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="font-medium tabular-nums">{format(s.value)}</span>
                <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{percent(s.value)}</span>
              </>
            );
            return (
              <li key={s.id}>
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(s)}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 py-1.5 text-sm">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meters and medals
// ---------------------------------------------------------------------------

/** A 0-100 position on an axis; `centered` fills from the middle (50 = neutral). */
export function Meter({
  value,
  poles,
  centered = false,
  label,
}: {
  value: number;
  poles?: [string, string];
  centered?: boolean;
  label: string;
}) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v)}
        className="relative h-2 w-full rounded-[4px] bg-viz-track"
      >
        {centered ? (
          <>
            <span
              className={cn("absolute inset-y-0", v >= 50 ? "left-1/2 rounded-r-[4px]" : "right-1/2 rounded-l-[4px]", "bg-viz-1")}
              style={{ width: `${Math.abs(v - 50)}%` }}
            />
            <span aria-hidden className="absolute inset-y-[-3px] left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-foreground/60" />
          </>
        ) : (
          <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-viz-1" style={{ width: `${v}%` }} />
        )}
      </div>
      {poles ? (
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{poles[0]}</span>
          <span>{poles[1]}</span>
        </div>
      ) : null}
    </div>
  );
}

const MEDALS: Record<Medal, { label: string; className: string }> = {
  bronze: { label: "Bronze", className: "text-medal-bronze bg-medal-bronze/12 border-medal-bronze/30" },
  silver: { label: "Argent", className: "text-medal-silver bg-medal-silver/12 border-medal-silver/30" },
  gold: { label: "Or", className: "text-medal-gold bg-medal-gold/12 border-medal-gold/30" },
};

export function MedalBadge({ medal }: { medal: Medal }) {
  const { label, className } = MEDALS[medal];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", className)}>
      <MedalIcon aria-hidden className="size-3.5" />
      <span className="text-foreground">{label}</span>
    </span>
  );
}
