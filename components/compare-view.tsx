"use client";

import { ArrowUpWideNarrowIcon } from "lucide-react";
import { useOverlay } from "@/components/overlay-context";
import { Button } from "@/components/ui/button";
import { useEntryActions } from "@/hooks/use-entry-actions";
import { scoreLabel, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import type { EntryState, ServiceName, SyncField } from "@/lib/mapping";
import type { MergedEntry } from "@/lib/merge";
import { cn } from "@/lib/utils";

const FIELDS: { field: SyncField; label: string; format: (s: EntryState) => string }[] = [
  { field: "status", label: "Statut", format: (s) => STATUS_LABELS[s.status] },
  { field: "progress", label: "Progression", format: (s) => `Ép. ${s.progress}` },
  { field: "score", label: "Note", format: (s) => scoreLabel(s.score) },
];

function Column({ service, state, diff }: { service: ServiceName; state: EntryState | null; diff: SyncField[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
      <div className="text-sm font-semibold">{SERVICE_LABELS[service]}</div>
      {state ? (
        FIELDS.map(({ field, label, format }) => (
          <div key={field} className="flex flex-col">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={cn("text-sm tabular-nums", diff.includes(field) && "font-semibold text-warning")}>
              {format(state)}
            </span>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">Absent de la liste</p>
      )}
    </div>
  );
}

/** MAL vs AniList side by side with the three alignment choices. */
export function CompareView({ entry }: { entry: MergedEntry }) {
  const { close } = useOverlay();
  const { align, aligning } = useEntryActions(entry.key);
  const run = (source: "mal" | "anilist" | "max") => {
    align({ source });
    close();
  };

  return (
    <div className="flex flex-col gap-4 p-5 pt-2 md:p-0">
      <div className="grid grid-cols-2 gap-3">
        <Column service="mal" state={entry.mal} diff={entry.diff} />
        <Column service="anilist" state={entry.anilist} diff={entry.diff} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Button variant="outline" disabled={aligning || !entry.mal} onClick={() => run("mal")}>
          Garder MAL
        </Button>
        <Button variant="outline" disabled={aligning || !entry.anilist} onClick={() => run("anilist")}>
          Garder AniList
        </Button>
        <Button disabled={aligning} onClick={() => run("max")}>
          <ArrowUpWideNarrowIcon />
          Prendre le max
        </Button>
      </div>
    </div>
  );
}
