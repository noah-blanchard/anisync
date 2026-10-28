import type { Rarity } from "@/lib/booster";

type Burst = "open" | Rarity;

const COLORS: Partial<Record<Burst, string[]>> = {
  open: ["#ffffff", "#bfe3ff", "#d9c2ff"],
  epic: ["#c084fc", "#ec4899", "#6366f1", "#22d3ee", "#ffffff"],
  legendary: ["#ffe08a", "#ffc843", "#fff6d5", "#e0a82e", "#ffffff"],
};

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Particles, loaded on demand (the library only ships with the first burst). Nothing under reduced motion. */
export async function sparkle(kind: Burst, origin: { x: number; y: number }): Promise<void> {
  const colors = COLORS[kind];
  if (!colors || reducedMotion()) return;
  const { default: confetti } = await import("canvas-confetti");
  const base = { origin, colors, disableForReducedMotion: true, zIndex: 60 };
  if (kind === "open") {
    void confetti({ ...base, particleCount: 36, spread: 75, startVelocity: 26, scalar: 0.7, gravity: 0.8, ticks: 140 });
  } else if (kind === "epic") {
    void confetti({ ...base, particleCount: 70, spread: 95, startVelocity: 34, ticks: 180 });
  } else {
    const stars = { ...base, shapes: ["star" as const] };
    void confetti({ ...base, shapes: ["star", "circle"], particleCount: 90, spread: 110, startVelocity: 42 });
    setTimeout(() => {
      void confetti({ ...stars, particleCount: 50, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } });
      void confetti({ ...stars, particleCount: 50, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } });
    }, 180);
  }
}

/** Viewport-relative point (0-1) of an element's top or center, for confetti origins. */
export function originOf(element: Element | null, at: "top" | "center" = "center"): { x: number; y: number } {
  if (!element) return { x: 0.5, y: 0.5 };
  const rect = element.getBoundingClientRect();
  return {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (at === "top" ? rect.top + rect.height * 0.12 : rect.top + rect.height / 2) / window.innerHeight,
  };
}
