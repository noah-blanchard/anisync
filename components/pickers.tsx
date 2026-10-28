"use client";

import { STATUS_LABELS, STATUS_ORDER } from "@/lib/labels";
import type { CanonicalStatus } from "@/lib/mapping";
import { cn } from "@/lib/utils";

const pill =
  "inline-flex min-h-11 items-center justify-center rounded-xl border text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:active:scale-95 disabled:opacity-50";

export function StatusPicker({
  value,
  onChange,
  disabled,
}: {
  value: CanonicalStatus | null;
  onChange: (status: CanonicalStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Statut" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {STATUS_ORDER.map((status) => {
        const active = value === status;
        return (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(status)}
            className={cn(
              pill,
              "px-3",
              active
                ? "border-transparent bg-entry-accent/15 text-foreground ring-1 ring-entry-accent/50"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {STATUS_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}

/** 10 tappable pills. Tapping the current score clears it. */
export function ScorePicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (score: number) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Note sur 10" className="grid grid-cols-5 gap-2 sm:grid-cols-10">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((score) => {
        const active = value === score;
        return (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={active ? `Note ${score}, toucher pour retirer` : `Note ${score}`}
            disabled={disabled}
            onClick={() => onChange(active ? 0 : score)}
            className={cn(
              pill,
              "tabular-nums",
              active
                ? "border-transparent bg-entry-accent text-background"
                : value > 0 && score < value
                  ? "border-transparent bg-entry-accent/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {score}
          </button>
        );
      })}
    </div>
  );
}
