"use client";

import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type PanInfo,
} from "motion/react";
import { HeartIcon, XIcon } from "lucide-react";
import * as React from "react";
import { RARITIES, type BoosterCard, type Rarity } from "@/lib/booster";
import { accentStyle } from "@/lib/color";
import { haptic, type HapticKind } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { BoosterCardView, CardBack } from "./card";

export type SwipeDir = 1 | -1;

/** Share of the card width past which letting go commits the swipe. */
const SWIPE_DISTANCE = 0.35;
/** px/s: a flick commits even when short. */
const SWIPE_VELOCITY = 500;
/** Vertical offset between stacked cards, in % of the card height. */
const DEPTH_OFFSET = 3;
const VISIBLE = 3;

/** Anticipation before the flip and flip duration, in seconds: rarer cards make you wait. */
const REVEAL: Record<Rarity, { charge: number; flip: number; haptic: HapticKind }> = {
  common: { charge: 0.12, flip: 0.45, haptic: "light" },
  rare: { charge: 0.3, flip: 0.55, haptic: "medium" },
  epic: { charge: 0.7, flip: 0.65, haptic: "heavy" },
  legendary: { charge: 1.15, flip: 0.85, haptic: "legendary" },
};

export const isHit = (rarity: Rarity) => RARITIES.indexOf(rarity) >= RARITIES.indexOf("epic");

function offscreen(): number {
  return typeof window === "undefined" ? 800 : window.innerWidth * 0.7 + 360;
}

const stackPose = (depth: number) => ({
  scale: 1 - Math.min(depth, VISIBLE - 1) * 0.05,
  y: `${Math.min(depth, VISIBLE - 1) * DEPTH_OFFSET}%`,
  opacity: depth < VISIBLE ? 1 : 0,
});

interface DeckCardProps {
  card: BoosterCard;
  depth: number;
  faceUp: boolean;
  slow: boolean;
  reduced: boolean;
  details: boolean;
  returning: SwipeDir | null;
  onDetails: (open: boolean) => void;
  onCharge: (card: BoosterCard, seconds: number) => void;
  onFlipped: (card: BoosterCard) => void;
  onSwipe: (dir: SwipeDir) => void;
}

function DeckCard({
  card,
  depth,
  faceUp,
  slow,
  reduced,
  details,
  returning,
  onDetails,
  onCharge,
  onFlipped,
  onSwipe,
}: DeckCardProps) {
  const isTop = depth === 0;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const flip = useMotionValue(faceUp ? 0 : 1);
  const pointer = useMotionValue(0.5);
  const rotate = useTransform(x, [-300, 300], [-20, 20]);
  const shine = useTransform([x, pointer], ([dx, p]: number[]) => Math.min(1, Math.max(0, p! + dx! / 500)));
  const addStamp = useTransform(x, [20, 110], [0, 1]);
  const skipStamp = useTransform(x, [-110, -20], [1, 0]);
  const [stage, setStage] = React.useState<"waiting" | "charging" | "flipping" | "ready">(faceUp ? "ready" : "waiting");
  const width = React.useRef(300);
  const beyond = React.useRef(false);

  const callbacks = React.useRef({ onCharge, onFlipped });
  React.useEffect(() => {
    callbacks.current = { onCharge, onFlipped };
  });

  // Reveal choreography, once, when the card reaches the top of the deck.
  const started = React.useRef(faceUp);
  React.useEffect(() => {
    if (!isTop || started.current) return;
    started.current = true;
    const timing = REVEAL[card.rarity];
    const k = slow ? 1.7 : 1;
    // Calm version: a short, still anticipation (the aura only fades in).
    const charge = reduced ? Math.min(timing.charge, 0.4) : timing.charge * k;
    let finished = false;
    let controls: ReturnType<typeof animate> | null = null;
    setStage("charging");
    callbacks.current.onCharge(card, charge);
    const timer = setTimeout(() => {
      setStage("flipping");
      haptic(timing.haptic);
      controls = animate(flip, 0, {
        duration: reduced ? 0.3 : timing.flip * k,
        ease: reduced ? "easeOut" : [0.3, 1.25, 0.5, 1],
        onComplete: () => {
          finished = true;
          setStage("ready");
          callbacks.current.onFlipped(card);
        },
      });
    }, charge * 1000);
    return () => {
      clearTimeout(timer);
      controls?.stop();
      // Strict Mode remounts effects: let the next run start the reveal again.
      if (!finished) {
        started.current = false;
        flip.set(1);
      }
    };
  }, [isTop, card, slow, reduced, flip]);

  useMotionValueEvent(x, "change", (value) => {
    const over = Math.abs(value) > width.current * SWIPE_DISTANCE;
    if (over && !beyond.current) haptic("tick");
    beyond.current = over;
  });

  const onDragStart = (e: PointerEvent | MouseEvent | TouchEvent) => {
    const target = e.target instanceof Element ? e.target.closest("[data-deck-card]") : null;
    if (target instanceof HTMLElement) width.current = target.offsetWidth;
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const distance = width.current * SWIPE_DISTANCE;
    const { x: dx } = info.offset;
    const vx = info.velocity.x;
    const right = dx > distance || (vx > SWIPE_VELOCITY && dx > 24);
    const left = dx < -distance || (vx < -SWIPE_VELOCITY && dx < -24);
    const dir: SwipeDir | 0 = right ? 1 : left ? -1 : 0;
    if (dir) {
      haptic("medium");
      // The card keeps flying from the finger's momentum while React updates the deck.
      animate(x, x.get() + dir * offscreen(), { duration: 0.4, ease: [0.25, 0.6, 0.35, 1] });
      onSwipe(dir);
      return;
    }
    const spring = { type: "spring" as const, stiffness: 520, damping: 30 };
    animate(x, 0, spring);
    animate(y, 0, spring);
  };

  const ready = isTop && stage === "ready";
  const glowing = isTop && (stage === "charging" || stage === "flipping") && card.rarity !== "common";

  return (
    <motion.div
      className={cn(`rarity-${card.rarity} entry-accent absolute inset-0 will-change-transform`, !isTop && "pointer-events-none")}
      style={{ zIndex: 10 - depth, ...accentStyle(card.color) }}
      initial={
        returning
          ? { x: returning * offscreen(), rotate: returning * 24, opacity: 0, scale: 1, y: "0%" }
          : { ...stackPose(VISIBLE), scale: 0.85 }
      }
      animate={{ x: 0, rotate: 0, ...stackPose(depth) }}
      exit="exit"
      variants={{
        // dir 0: a card pushed off the back of the deck by an undo.
        exit: (dir: SwipeDir | 0) =>
          dir === 0
            ? { opacity: 0, transition: { duration: 0.2 } }
            : reduced
            ? { x: dir * 60, opacity: 0, transition: { duration: 0.25 } }
            : {
                x: dir * offscreen(),
                rotate: dir * 24,
                opacity: 0.6,
                transition: { duration: 0.4, ease: [0.25, 0.6, 0.35, 1] },
              },
      }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      {/* Rarity aura: builds up before the flip, stays soft behind rare and better cards. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-[-14%] rounded-[30%] bg-[radial-gradient(closest-side,var(--glow),transparent)]"
        initial={false}
        animate={
          glowing
            ? reduced
              ? { opacity: 0.8 }
              : { opacity: [0.2, 1, 0.75, 1], scale: [0.85, 1.08, 1, 1.12] }
            : { opacity: isTop && stage === "ready" && card.rarity !== "common" ? 0.4 : 0, scale: 1 }
        }
        transition={glowing ? { duration: REVEAL[card.rarity].charge * (slow ? 1.7 : 1) + 0.3 } : { duration: 0.5 }}
      />
      <motion.div
        data-deck-card
        className={cn(
          "absolute inset-0 [perspective:1200px]",
          isTop && "will-change-transform",
          ready && !details && "cursor-grab active:cursor-grabbing",
        )}
        style={{ x, y, rotate, touchAction: "none" }}
        drag={ready && !details}
        dragMomentum={false}
        whileDrag={reduced ? undefined : { scale: 1.03 }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onPointerMove={(e) => {
          if (reduced || !ready) return;
          const rect = e.currentTarget.getBoundingClientRect();
          pointer.set((e.clientX - rect.left) / rect.width);
        }}
        onPointerLeave={() => animate(pointer, 0.5, { duration: 0.4 })}
        onTap={(e) => {
          if (!ready || (e.target instanceof Element && e.target.closest("button"))) return;
          if (card.synopsis) onDetails(!details);
        }}
        animate={
          isTop && stage === "charging" && card.rarity === "legendary" && !reduced
            ? { rotateZ: [0, -1.5, 1.5, -1, 1, 0], transition: { duration: 0.5, repeat: Infinity } }
            : { rotateZ: 0 }
        }
      >
        <BoosterCardView
          card={card}
          flip={flip}
          shine={shine}
          reduced={reduced}
          details={isTop && details}
          onDetails={ready ? onDetails : undefined}
          priority={depth < 2}
          className="h-full w-full"
        />
        {ready && (
          <>
            <motion.div
              aria-hidden
              className="pointer-events-none absolute top-[7%] left-[7%] -rotate-12 rounded-xl border-4 border-success bg-black/35 px-3 py-1 text-2xl font-black tracking-wider text-success"
              style={{ opacity: addStamp }}
            >
              À VOIR
            </motion.div>
            <motion.div
              aria-hidden
              className="pointer-events-none absolute top-[7%] right-[7%] rotate-12 rounded-xl border-4 border-destructive bg-black/35 px-3 py-1 text-2xl font-black tracking-wider text-destructive"
              style={{ opacity: skipStamp }}
            >
              PASSER
            </motion.div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

export function Deck({
  cards,
  index,
  revealed,
  exitDir,
  returning,
  details,
  reduced,
  onDetails,
  onCharge,
  onFlipped,
  onSwipe,
}: {
  cards: BoosterCard[];
  index: number;
  revealed: ReadonlySet<number>;
  exitDir: SwipeDir | 0;
  returning: { id: number; dir: SwipeDir } | null;
  details: boolean;
  reduced: boolean;
  onDetails: (open: boolean) => void;
  onCharge: (card: BoosterCard, seconds: number) => void;
  onFlipped: (card: BoosterCard) => void;
  onSwipe: (dir: SwipeDir) => void;
}) {
  const visible = cards.slice(index, index + VISIBLE);
  return (
    <AnimatePresence custom={exitDir} initial={false}>
      {visible.map((card, depth) => (
        <DeckCard
          key={card.anilistId}
          card={card}
          depth={depth}
          faceUp={revealed.has(card.anilistId)}
          slow={index + depth === cards.length - 1 && isHit(card.rarity)}
          reduced={reduced}
          details={details}
          returning={returning?.id === card.anilistId ? returning.dir : null}
          onDetails={onDetails}
          onCharge={onCharge}
          onFlipped={onFlipped}
          onSwipe={onSwipe}
        />
      ))}
    </AnimatePresence>
  );
}

/** Face-down cards rising out of the opened pack, then settling into the deck. */
export function Burst({ count, reduced, onDone }: { count: number; reduced: boolean; onDone: () => void }) {
  const done = React.useRef(onDone);
  React.useEffect(() => {
    done.current = onDone;
  });
  React.useEffect(() => {
    const timer = setTimeout(() => done.current(), reduced ? 350 : 1300);
    return () => clearTimeout(timer);
  }, [reduced]);

  const mid = (count - 1) / 2;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const depth = Math.min(i, VISIBLE - 1);
        const final = stackPose(depth);
        return (
          <motion.div
            key={i}
            aria-hidden
            className="absolute inset-0 will-change-transform [container-type:inline-size]"
            style={{ zIndex: 10 - i }}
            // Starts small and centered, fully hidden behind the opened pack.
            initial={reduced ? { ...final, opacity: 0 } : { y: "4%", scale: 0.84, x: "0%", rotate: 0 }}
            animate={
              reduced
                ? { opacity: final.opacity }
                : {
                    y: ["4%", `${-56 - i * 1.5}%`, final.y],
                    x: ["0%", `${(i - mid) * 10}%`, "0%"],
                    rotate: [0, (i - mid) * 7, 0],
                    scale: [0.84, 0.96, final.scale],
                    opacity: [1, 1, final.opacity],
                  }
            }
            transition={
              reduced
                ? { duration: 0.3 }
                : {
                    duration: 1.1,
                    times: [0, 0.5, 1],
                    ease: ["easeOut", [0.45, 0, 0.2, 1]],
                    delay: (count - 1 - i) * 0.04,
                  }
            }
          >
            <CardBack className="h-full w-full" />
          </motion.div>
        );
      })}
    </>
  );
}

/** ✕ and ♥ buttons, the accessible alternative to swiping. */
export function DeckActions({
  disabled,
  title,
  onSwipe,
  children,
}: {
  disabled: boolean;
  title: string;
  onSwipe: (dir: SwipeDir) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-center gap-6">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSwipe(-1)}
        aria-label={`Passer ${title}`}
        className="grid size-16 place-items-center rounded-full border border-border bg-card text-destructive shadow-lg transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 motion-safe:active:scale-90"
      >
        <XIcon className="size-7" strokeWidth={2.5} aria-hidden />
      </button>
      {children}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSwipe(1)}
        aria-label={`Ajouter ${title} à ta liste (À voir)`}
        className="grid size-16 place-items-center rounded-full border border-border bg-card text-success shadow-lg transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 motion-safe:active:scale-90"
      >
        <HeartIcon className="size-7 fill-current" aria-hidden />
      </button>
    </div>
  );
}
