"use client";

import { ArrowUpWideNarrowIcon } from "lucide-react";
import { useOverlay } from "@/components/overlay-context";
import { Button } from "@/components/ui/button";
import { useList } from "@/hooks/use-list";
import { useEntryActions } from "@/hooks/use-entry-actions";
import { scoreLabel, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { ALL_SERVICES, type EntryState, type ServiceName, type SyncField } from "@/lib/mapping";
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

/** Anime states side by side (2 or 3 services) with one "keep" button per available state, plus "max". */
export function CompareView({ entry }: { entry: MergedEntry }) {
  const { close } = useOverlay();
  const { align, aligning } = useEntryActions(entry.key);
  const { data } = useList();
  // One column per service that holds the anime or is connected.
  const services = ALL_SERVICES.filter((s) => entry[s] !== null || Boolean(data?.connections[s]));
  const run = (source: ServiceName | "max") => {
    align({ source });
    close();
  };

  return (
    <div className="flex flex-col gap-4 p-5 pt-2 md:p-0">
      <div className={cn("grid gap-3", services.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2")}>
        {services.map((service) => (
          <Column key={service} service={service} state={entry[service]} diff={entry.diff} />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {services
          .filter((service) => entry[service] !== null)
          .map((service) => (
            <Button key={service} variant="outline" disabled={aligning} onClick={() => run(service)}>
              Garder {SERVICE_LABELS[service]}
            </Button>
          ))}
        <Button disabled={aligning} onClick={() => run("max")}>
          <ArrowUpWideNarrowIcon />
          Prendre le max
        </Button>
      </div>
    </div>
  );
}
