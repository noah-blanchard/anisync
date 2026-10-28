"use client";

import { CompareView } from "@/components/compare-view";
import { CompleteView } from "@/components/complete-view";
import { EntryDetail } from "@/components/entry-detail";
import { useOverlay } from "@/components/overlay-context";
import { ResponsiveOverlay } from "@/components/responsive-overlay";
import { SyncCheckView } from "@/components/sync-check-view";
import { useEntry } from "@/hooks/use-list";

/** Renders whichever overlay is open; entries are read live from the query cache. */
export function EntryOverlays() {
  const { overlay, close } = useOverlay();
  const key = overlay && overlay.type !== "check" ? overlay.key : null;
  const entry = useEntry(key);
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };

  return (
    <>
      <ResponsiveOverlay
        open={overlay?.type === "detail" && !!entry}
        onOpenChange={onOpenChange}
        title={entry?.title ?? "Détail"}
        description="Progression, statut et note sur MAL et AniList"
      >
        {overlay?.type === "detail" && entry ? <EntryDetail entry={entry} /> : null}
      </ResponsiveOverlay>

      <ResponsiveOverlay
        variant="dialog"
        open={overlay?.type === "compare" && !!entry}
        onOpenChange={onOpenChange}
        title="Comparer MAL et AniList"
        description={entry?.title}
      >
        {overlay?.type === "compare" && entry ? <CompareView entry={entry} /> : null}
      </ResponsiveOverlay>

      <ResponsiveOverlay
        variant="dialog"
        open={overlay?.type === "complete" && !!entry}
        onOpenChange={onOpenChange}
        title="Marquer comme terminé"
        description={entry?.title}
      >
        {overlay?.type === "complete" && entry ? <CompleteView entry={entry} /> : null}
      </ResponsiveOverlay>

      <ResponsiveOverlay
        variant="dialog"
        open={overlay?.type === "check"}
        onOpenChange={onOpenChange}
        title="Vérification de la synchronisation"
        description="Entrées qui diffèrent entre MAL et AniList"
      >
        {overlay?.type === "check" ? <SyncCheckView /> : null}
      </ResponsiveOverlay>
    </>
  );
}
