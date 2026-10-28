"use client";

import * as React from "react";

export type Overlay =
  | { type: "detail"; key: string }
  | { type: "compare"; key: string }
  | { type: "complete"; key: string }
  | { type: "check" }
  | null;

interface OverlayContextValue {
  overlay: Overlay;
  open: (overlay: Exclude<Overlay, null>) => void;
  close: () => void;
}

const OverlayContext = React.createContext<OverlayContextValue | null>(null);

/** One overlay at a time (detail, compare, complete or bulk check), driven from anywhere. */
export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [overlay, setOverlay] = React.useState<Overlay>(null);
  const value = React.useMemo<OverlayContextValue>(
    () => ({ overlay, open: setOverlay, close: () => setOverlay(null) }),
    [overlay],
  );
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlay(): OverlayContextValue {
  const ctx = React.useContext(OverlayContext);
  if (!ctx) throw new Error("useOverlay doit être utilisé dans <OverlayProvider>");
  return ctx;
}
