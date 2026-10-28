"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, ChevronRightIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Cover } from "@/components/entry-bits";
import { useOverlay } from "@/components/overlay-context";
import { Button } from "@/components/ui/button";
import { setEntry, useList } from "@/hooks/use-list";
import { api, type WriteResult } from "@/lib/client-api";
import { accentStyle } from "@/lib/color";
import type { MergedEntry } from "@/lib/merge";

const DELAY_MS = 1100;

function describe(entry: MergedEntry): string {
  if (entry.missingOn) return `Absent sur ${entry.missingOn === "mal" ? "MAL" : "AniList"}`;
  const labels = { status: "statut", progress: "progression", score: "note" } as const;
  return `Diffère : ${entry.diff.map((d) => labels[d]).join(", ")}`;
}

/** "Tout vérifier": every out-of-sync entry, with a rate-limited bulk "Aligner sur le max". */
export function SyncCheckView() {
  const qc = useQueryClient();
  const { open } = useOverlay();
  const { data } = useList();
  const outOfSync = React.useMemo(() => data?.entries.filter((e) => !e.inSync && e.malId !== null) ?? [], [data]);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const alignAll = async () => {
    const queue = [...outOfSync];
    cancelled.current = false;
    setProgress({ done: 0, total: queue.length });
    let failures = 0;
    for (const [index, entry] of queue.entries()) {
      if (cancelled.current) break;
      try {
        const result = await api<WriteResult>("/api/entry/align", {
          method: "POST",
          body: JSON.stringify({ malId: entry.malId, source: "max" }),
        });
        setEntry(qc, entry.key, (current) => ({
          ...current,
          mal: result.mal.ok && !result.mal.skipped && result.mal.entry !== undefined ? result.mal.entry : current.mal,
          anilist:
            result.anilist.ok && !result.anilist.skipped && result.anilist.entry !== undefined
              ? result.anilist.entry
              : current.anilist,
        }));
        if (!result.mal.ok || !result.anilist.ok) failures++;
      } catch {
        failures++;
      }
      setProgress({ done: index + 1, total: queue.length });
      if (index < queue.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    setProgress(null);
    if (failures > 0) toast.error(`${failures} entrée(s) n'ont pas pu être alignées`);
    else if (!cancelled.current) toast.success("Tout est synchronisé");
  };

  if (outOfSync.length === 0 && !progress) {
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-10 text-center md:px-0">
        <CheckCircle2Icon className="size-10 text-success" aria-hidden />
        <p className="font-medium">Tout est synchronisé</p>
        <p className="text-sm text-muted-foreground">MAL et AniList affichent la même chose partout.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5 pt-2 md:p-0">
      {progress ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <div className="flex justify-between text-sm">
            <span>Alignement en cours…</span>
            <span className="tabular-nums">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
          <Button variant="outline" onClick={() => (cancelled.current = true)}>
            Arrêter
          </Button>
        </div>
      ) : (
        <Button onClick={alignAll}>Aligner sur le max ({outOfSync.length})</Button>
      )}

      <ul className="flex max-h-[50dvh] flex-col gap-1.5 overflow-y-auto">
        {outOfSync.map((entry) => (
          <li key={entry.key} className="entry-accent" style={accentStyle(entry.color)}>
            <button
              type="button"
              disabled={progress !== null}
              onClick={() => open({ type: "compare", key: entry.key })}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <Cover src={entry.cover} alt="" glow={false} className="w-10 rounded-lg" sizes="40px" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{entry.title}</span>
                <span className="block truncate text-xs text-warning">{describe(entry)}</span>
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
