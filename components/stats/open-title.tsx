"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useOverlay } from "@/components/overlay-context";
import { getEntry } from "@/hooks/use-list";
import type { StatsRow } from "@/lib/stats/types";

const OpenTitleContext = React.createContext<(row: StatsRow) => void>(() => {});

/**
 * What a click on a title does: its detail sheet when it is in my list, otherwise
 * (someone else's stats) its AniList page in a new tab.
 */
export function OpenTitleProvider({ children }: { children: React.ReactNode }) {
  const { open } = useOverlay();
  const qc = useQueryClient();
  const openTitle = React.useCallback(
    (row: StatsRow) => {
      if (getEntry(qc, row.key)) open({ type: "detail", key: row.key });
      else if (row.anilistId !== null) window.open(`https://anilist.co/anime/${row.anilistId}`, "_blank", "noopener");
    },
    [open, qc],
  );
  return <OpenTitleContext.Provider value={openTitle}>{children}</OpenTitleContext.Provider>;
}

export function useOpenTitle(): (row: StatsRow) => void {
  return React.useContext(OpenTitleContext);
}
