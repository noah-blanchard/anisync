"use client";

import { RefreshCwIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const THRESHOLD = 72;
const MAX_PULL = 110;

/** Touch-only pull-to-refresh, active when the page is scrolled to the top. */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const start = React.useRef<number | null>(null);
  const pullRef = React.useRef(0);

  React.useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || refreshing || e.touches.length !== 1) return;
      start.current = e.touches[0]?.clientY ?? null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const delta = (e.touches[0]?.clientY ?? 0) - start.current;
      if (delta <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Resistance curve so it feels elastic.
      const value = Math.min(MAX_PULL, delta * 0.5);
      pullRef.current = value;
      setPull(value);
    };
    const onEnd = async () => {
      if (start.current === null) return;
      start.current = null;
      const reached = pullRef.current >= THRESHOLD * 0.75;
      pullRef.current = 0;
      setPull(0);
      if (!reached) return;
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [onRefresh, refreshing]);

  const visible = pull > 4 || refreshing;
  const height = refreshing ? 48 : pull;

  return (
    <>
      <div
        aria-hidden={!refreshing}
        aria-live="polite"
        className="flex items-end justify-center overflow-hidden transition-[height] duration-200 ease-out md:hidden"
        style={{ height: visible ? height : 0 }}
      >
        <div className="mb-2 flex size-9 items-center justify-center rounded-full border border-border bg-card">
          <RefreshCwIcon
            className={cn("size-4 text-muted-foreground", refreshing && "motion-safe:animate-spin")}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          />
          {refreshing && <span className="sr-only">Actualisation…</span>}
        </div>
      </div>
      {children}
    </>
  );
}
