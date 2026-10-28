"use client";

import Link from "next/link";
import { ChevronRightIcon, InfinityIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { currentRound, useBoosterAdult, usePrefetchBooster } from "@/hooks/use-booster";
import { PackArt } from "./pack-art";

const FAN = [
  { rotate: -12, x: "-34%", y: "4%" },
  { rotate: 12, x: "34%", y: "4%" },
  { rotate: 0, x: "0%", y: "0%" },
];

/** Home page entry point: the packs waiting to be opened. Warms the next pack so it opens instantly. */
export function BoosterShelf() {
  const [adult] = useBoosterAdult();
  const prefetch = usePrefetchBooster();
  const warm = React.useCallback(() => prefetch(currentRound(), adult), [prefetch, adult]);

  React.useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(warm);
    return () => cancel(id);
  }, [warm]);

  return (
    <Link
      href="/booster"
      onPointerDown={warm}
      onFocus={warm}
      className="group relative mb-6 flex items-center gap-4 overflow-hidden rounded-3xl border border-border bg-card p-3 pr-4 outline-none focus-visible:ring-2 focus-visible:ring-ring md:max-w-xl"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_12%_50%,color-mix(in_oklab,var(--primary)_20%,transparent),transparent_60%)]"
      />
      <div aria-hidden className="relative h-24 w-24 shrink-0 transition-transform duration-300 ease-out motion-safe:group-hover:-translate-y-0.5 motion-safe:group-active:scale-95">
        {FAN.map((pose, i) => (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 w-[3.2rem]"
            style={{ transform: `translate(-50%, -50%) translate(${pose.x}, ${pose.y}) rotate(${pose.rotate}deg)` }}
          >
            <PackArt className="w-full drop-shadow-[0_6px_10px_rgb(0_0_0/0.35)]" />
          </div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Boosters</h2>
          <Badge>
            <InfinityIcon aria-hidden />
            Illimités
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">Ouvre un paquet et découvre 5 animes à ajouter à ta liste.</p>
      </div>
      <ChevronRightIcon
        className="relative size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
