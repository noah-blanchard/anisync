"use client";

import * as React from "react";
import type { StatsRow } from "@/lib/stats/types";
import { cn } from "@/lib/utils";

const CELL = 11;
const GAP = 2;
const LEVELS = ["bg-muted", "bg-[var(--viz-seq-1)]", "bg-[var(--viz-seq-2)]", "bg-[var(--viz-seq-3)]", "bg-[var(--viz-seq-4)]"];
const WEEKDAYS = ["Lun", "", "Mer", "", "Ven", "", ""];
const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const levelOf = (count: number) => Math.min(count, LEVELS.length - 1);

/**
 * GitHub-style year calendar: one cell a day, Monday on top, darker = more titles finished.
 * The grid scrolls sideways on narrow screens; the monthly chart carries the same data for keyboards.
 */
export function CalendarHeatmap({
  year,
  days,
  onSelect,
}: {
  year: number;
  days: Map<string, StatsRow[]>;
  onSelect: (date: string, rows: StatsRow[]) => void;
}) {
  const cells = React.useMemo(() => {
    const first = Date.UTC(year, 0, 1);
    const offset = (new Date(first).getUTCDay() + 6) % 7;
    const count = (Date.UTC(year + 1, 0, 1) - first) / 86_400_000;
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(first + i * 86_400_000).toISOString().slice(0, 10);
      return { date, index: i + offset, rows: days.get(date) ?? [] };
    });
  }, [year, days]);

  const months = Array.from({ length: 12 }, (_, m) => {
    const cell = cells.find((c) => c.date === `${year}-${String(m + 1).padStart(2, "0")}-01`)!;
    return { label: MONTH.format(Date.UTC(year, m, 1)), week: Math.floor(cell.index / 7) };
  });
  const weeks = Math.ceil((cells.at(-1)!.index + 1) / 7);
  const total = cells.reduce((sum, c) => sum + c.rows.length, 0);
  const active = cells.filter((c) => c.rows.length > 0).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto pb-1">
        <div aria-hidden className="relative inline-flex flex-col gap-1.5" style={{ paddingLeft: 30 }}>
          <div className="relative h-4 text-[11px] text-muted-foreground">
            {months.map((m) => (
              <span key={m.label} className="absolute" style={{ left: m.week * (CELL + GAP) }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="relative">
            <div className="absolute top-0 -left-[30px] grid text-[10px] leading-none text-muted-foreground" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}>
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="flex items-center">
                  {d}
                </span>
              ))}
            </div>
            <div
              className="grid grid-flow-col"
              style={{
                gridTemplateRows: `repeat(7, ${CELL}px)`,
                gridAutoColumns: `${CELL}px`,
                gap: GAP,
                width: weeks * (CELL + GAP) - GAP,
              }}
            >
              {cells.map((c) => {
                const n = c.rows.length;
                return (
                  <button
                    key={c.date}
                    type="button"
                    tabIndex={-1}
                    title={`${DATE.format(Date.parse(c.date))} : ${n === 0 ? "rien de terminé" : `${n} titre${n > 1 ? "s" : ""} terminé${n > 1 ? "s" : ""}`}`}
                    onClick={n > 0 ? () => onSelect(c.date, c.rows) : undefined}
                    className={cn("rounded-[2px]", LEVELS[levelOf(n)], n > 0 ? "hover:ring-2 hover:ring-ring" : "cursor-default")}
                    style={{ gridRowStart: (c.index % 7) + 1, gridColumnStart: Math.floor(c.index / 7) + 1 }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p role="status">
          {total} titre{total > 1 ? "s" : ""} terminé{total > 1 ? "s" : ""} en {year}, sur {active} jour{active > 1 ? "s" : ""}
        </p>
        <div aria-hidden className="flex items-center gap-1">
          Moins
          {LEVELS.map((l) => (
            <span key={l} className={cn("size-[11px] rounded-[2px]", l)} />
          ))}
          Plus
        </div>
      </div>
    </div>
  );
}
