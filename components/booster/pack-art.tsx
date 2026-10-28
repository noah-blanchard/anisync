import type * as React from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

/** Pack visuals without motion, so the home page shelf does not load the animation library. */

/** Height of the tear-off strip, in % of the pack height. */
export const STRIP = 13;
const TEETH = 18;
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/** Zig-zag edge at height `y` (in %), every other point shifted by `depth`, left to right. */
function zigzag(y: number, depth: number): string[] {
  const teeth = TEETH * 2;
  return Array.from({ length: teeth + 1 }, (_, i) => `${pct((i / teeth) * 100)} ${pct(i % 2 ? y + depth : y)}`);
}

/** Perforated seam between the strip and the body. */
const SEAM = zigzag(STRIP, 0.9);

/** Crimped edge, teeth pointing inwards by `depth`. */
function crimp(y: number, depth: number, rightToLeft: boolean): string[] {
  const points = zigzag(y, depth);
  return rightToLeft ? points.reverse() : points;
}

// Static clip paths: they never animate, so they cost nothing per frame.
const BODY_CLIP = `polygon(${[...SEAM, ...crimp(100, -1.4, true)].join(", ")})`;
const STRIP_CLIP = `polygon(${[...crimp(0, 1.4, false), ...[...SEAM].reverse()].join(", ")})`;

export function PackBody({ children }: { children?: React.ReactNode }) {
  return (
    <div className="booster-foil absolute inset-0" style={{ clipPath: BODY_CLIP }}>
      <div className="booster-crimp absolute inset-x-0 bottom-0 h-[6%] opacity-80" />
      <div className="absolute inset-x-0 top-[24%] flex flex-col items-center text-white select-none">
        <span className="text-[4.2cqw] font-semibold tracking-[0.45em] text-white/80">ANISYNC</span>
        <div className="relative mt-[5cqw] grid place-items-center">
          <div className="absolute size-[46cqw] rounded-full bg-[radial-gradient(circle,rgb(124_200_255/0.55),transparent_65%)]" />
          <Logo className="relative size-[30cqw] drop-shadow-[0_6px_14px_rgb(0_0_0/0.45)]" />
        </div>
        <span className="booster-title mt-[4cqw] text-[15cqw] leading-none font-black tracking-tight italic">BOOSTER</span>
        <span className="mt-[2.5cqw] text-[3.6cqw] font-medium tracking-[0.3em] text-white/75">ÉDITION DÉCOUVERTE</span>
        <span className="mt-[7cqw] rounded-full bg-black/30 px-[4cqw] py-[1.2cqw] text-[3.6cqw] font-semibold tracking-[0.2em] text-white/90 ring-1 ring-white/20">
          5 CARTES
        </span>
      </div>
      {children}
    </div>
  );
}

export function PackStrip({ hint }: { hint?: boolean }) {
  return (
    <div className="booster-foil absolute inset-0" style={{ clipPath: STRIP_CLIP }}>
      <div className="booster-crimp absolute inset-x-0 top-0 h-[6%] opacity-80" />
      {hint && (
        <div className="absolute inset-x-[6%] top-[8.6%] flex h-[4%] items-center gap-[1.5cqw] text-[3.3cqw] font-semibold tracking-[0.25em] text-white/85">
          <span className="relative h-full w-[16cqw] overflow-hidden" style={{ "--tear-hint-distance": "12cqw" } as React.CSSProperties}>
            <span className="absolute inset-y-0 left-0 flex items-center motion-safe:animate-tear-hint">»</span>
          </span>
          DÉCHIRER ICI
        </div>
      )}
    </div>
  );
}

/** Static pack art (home page shelf). */
export function PackArt({ className }: { className?: string }) {
  return (
    <div className={cn("relative aspect-[5/8] [container-type:inline-size]", className)}>
      <PackBody />
      <PackStrip />
    </div>
  );
}

