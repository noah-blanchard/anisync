"use client";

import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import * as React from "react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import type { BoosterDefinition } from "@/lib/boosters";
import { PackBody, PackStrip, STRIP } from "./pack-art";

/** Tear progress past which letting go opens the pack. */
const COMMIT = 0.6;
/** Horizontal distance (share of the pack width) that tears the whole strip. */
const TEAR_DISTANCE = 0.85;


const TILT_SPRING = { stiffness: 220, damping: 22, mass: 0.6 };

/**
 * The sealed pack: tilts and shines under the finger, tears open with a left-to-right swipe across it.
 * `torn` is controlled by the parent so the "Ouvrir" button and the keyboard open it the same way.
 */
export function BoosterPack({
  booster,
  torn,
  onTear,
  className,
}: {
  booster: BoosterDefinition;
  torn: boolean;
  onTear: () => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const progress = useMotionValue(0);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const pressed = useMotionValue(1);
  const rotateX = useSpring(useTransform(py, [0, 1], [9, -9]), TILT_SPRING);
  const rotateY = useSpring(useTransform(px, [0, 1], [-13, 13]), TILT_SPRING);
  const scale = useSpring(pressed, { stiffness: 500, damping: 30 });
  const shineX = useTransform(px, [0, 1], ["-22%", "22%"]);
  const shineY = useTransform(py, [0, 1], ["-14%", "14%"]);
  const stripRotate = useTransform(progress, [0, 1], [0, 9]);
  const stripY = useTransform(progress, [0, 1], ["0%", "-1.2%"]);
  const ripScale = progress;
  const ripHead = useTransform(progress, (p) => `${p * 100}%`);
  const ripOpacity = useTransform(progress, [0, 0.03], [0, 1]);
  const [tearing, setTearing] = React.useState(false);

  const gesture = React.useRef<{
    id: number;
    startX: number;
    startY: number;
    rect: DOMRect;
    locked: boolean;
    step: number;
    samples: { x: number; t: number }[];
  } | null>(null);

  const track = (e: React.PointerEvent, rect: DOMRect) => {
    if (reduced) return;
    px.set(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
    py.set(Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)));
  };

  const release = () => {
    px.set(0.5);
    py.set(0.5);
    pressed.set(1);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (torn || gesture.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      rect,
      locked: false,
      step: 0,
      samples: [{ x: e.clientX, t: e.timeStamp }],
    };
    pressed.set(0.97);
    track(e, rect);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) {
      if (e.pointerType === "mouse" && !torn) track(e, e.currentTarget.getBoundingClientRect());
      return;
    }
    track(e, g.rect);
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.locked && dx > 8 && Math.abs(dx) > Math.abs(dy)) {
      g.locked = true;
      setTearing(true);
    }
    if (!g.locked) return;
    g.samples = [...g.samples.slice(-4), { x: e.clientX, t: e.timeStamp }];
    const p = Math.min(1, Math.max(0, dx / (g.rect.width * TEAR_DISTANCE)));
    progress.set(p);
    const step = Math.floor(p * 8);
    if (step > g.step) haptic("tick");
    g.step = step;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    release();
    if (!g.locked) {
      // A tap: nudge the strip to show where to tear.
      if (!reduced) animate(progress, [0, 0.12, 0], { duration: 0.6, ease: "easeInOut" });
      haptic("light");
      return;
    }
    const first = g.samples[0]!;
    const last = g.samples[g.samples.length - 1]!;
    const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const p = progress.get();
    if (p >= COMMIT || (velocity > 0.6 && p > 0.15)) {
      animate(progress, 1, { duration: 0.12, ease: "easeOut" });
      onTear();
    } else {
      setTearing(false);
      animate(progress, 0, { type: "spring", stiffness: 400, damping: 26 });
    }
  };

  const onPointerCancel = () => {
    gesture.current = null;
    release();
    setTearing(false);
    animate(progress, 0, { type: "spring", stiffness: 400, damping: 26 });
  };

  React.useEffect(() => {
    if (torn) {
      haptic("medium");
      if (progress.get() < 1) animate(progress, 1, { duration: 0.18, ease: "easeOut" });
    }
  }, [torn, progress]);

  return (
    // The float animation and the tilt sit on two elements: a CSS animation would override inline transforms.
    <div className={cn("[perspective:900px]", !tearing && !torn && "motion-safe:animate-pack-float", className)}>
      <motion.div
        role="img"
        aria-label={`Booster ${booster.name} scellé. Glisse ton doigt de gauche à droite sur le haut pour le déchirer.`}
        className="relative aspect-[5/8] w-full touch-none select-none [container-type:inline-size]"
        style={{ rotateX, rotateY, scale }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={(e) => e.pointerType === "mouse" && !gesture.current && release()}
      >
        <div className="absolute inset-[4%] top-[10%] translate-y-[4%] rounded-[10%] bg-black/50 blur-xl" aria-hidden />
        <div className="absolute inset-0 isolate overflow-hidden">
          <PackBody booster={booster} priority>
            <motion.div
              aria-hidden
              className="booster-shine pointer-events-none absolute inset-[-50%]"
              style={{ x: shineX, y: shineY }}
            />
          </PackBody>
        </div>

        {/* Rip line growing along the seam */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-[3px] origin-left bg-white shadow-[0_0_10px_2px_rgb(190_230_255/0.9)]"
          style={{ top: `${STRIP}%`, scaleX: ripScale, opacity: ripOpacity }}
        />
        <motion.div aria-hidden className="pointer-events-none absolute inset-x-0" style={{ top: `${STRIP}%`, x: ripHead, opacity: ripOpacity }}>
          <div className="absolute -top-[6px] -left-[6px] size-[14px] rounded-full bg-white shadow-[0_0_16px_6px_rgb(190_230_255/0.9)]" />
        </motion.div>

        <motion.div
          className="pointer-events-none absolute inset-0 will-change-transform"
          style={{ transformOrigin: `100% ${STRIP}%` }}
          initial={false}
          animate={
            torn
              ? reduced
                ? { opacity: 0, transition: { duration: 0.25 } }
                : {
                    x: "38%",
                    y: "-26%",
                    rotate: 38,
                    opacity: 0,
                    transition: { duration: 0.55, ease: [0.2, 0.7, 0.3, 1] },
                  }
              : { x: 0, y: 0, rotate: 0, opacity: 1 }
          }
        >
          <motion.div
            className="absolute inset-0 will-change-transform"
            style={{ rotate: stripRotate, y: stripY, transformOrigin: `100% ${STRIP}%` }}
          >
            <PackStrip hint={!tearing && !torn} />
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

/** The opened pack (strip gone) used while the cards come out. */
export function OpenedPack({ booster, className }: { booster: BoosterDefinition; className?: string }) {
  return (
    <div className={cn("relative aspect-[5/8] [container-type:inline-size]", className)}>
      <PackBody booster={booster} />
    </div>
  );
}
