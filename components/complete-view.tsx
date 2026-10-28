"use client";

import { CheckIcon } from "lucide-react";
import * as React from "react";
import { useOverlay } from "@/components/overlay-context";
import { ScorePicker } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { useEntryActions } from "@/hooks/use-entry-actions";
import { accentStyle } from "@/lib/color";
import type { EntryPatch } from "@/lib/mapping";
import { displayState, type MergedEntry } from "@/lib/merge";

/** "Marquer comme terminé" with an optional score. */
export function CompleteView({ entry }: { entry: MergedEntry }) {
  const { close } = useOverlay();
  const { update } = useEntryActions(entry.key);
  const current = displayState(entry);
  const [score, setScore] = React.useState(current?.score ?? 0);

  const confirm = () => {
    const patch: EntryPatch = { status: "completed" };
    if (entry.totalEpisodes) patch.progress = entry.totalEpisodes;
    if (score !== (current?.score ?? 0)) patch.score = score;
    update(patch);
    close();
  };

  return (
    <div className="entry-accent flex flex-col gap-5 p-5 pt-2 md:p-0" style={accentStyle(entry.color)}>
      <div className="flex flex-col gap-2.5">
        <span className="text-sm text-muted-foreground">Ta note (optionnelle)</span>
        <ScorePicker value={score} onChange={setScore} />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={close}>
          Plus tard
        </Button>
        <Button onClick={confirm}>
          <CheckIcon />
          Marquer comme terminé
        </Button>
      </div>
    </div>
  );
}
