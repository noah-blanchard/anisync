"use client";

import { AnimatePresence, motion, useTransform, type MotionValue } from "motion/react";
import Image from "next/image";
import {
  CircleIcon,
  DiamondIcon,
  GemIcon,
  InfoIcon,
  SparklesIcon,
  StarIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Logo } from "@/components/logo";
import { RARITY_LABELS, scoreOutOfTen, type BoosterCard, type Rarity } from "@/lib/booster";
import { accentStyle } from "@/lib/color";
import { episodesLabel, formatLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

const RARITY_ICONS: Record<Rarity, LucideIcon> = {
  common: CircleIcon,
  rare: DiamondIcon,
  epic: GemIcon,
  legendary: SparklesIcon,
};

const HOLO_OPACITY: Record<Rarity, number> = { common: 0, rare: 0.22, epic: 0.42, legendary: 0.34 };

export function cardMeta(card: BoosterCard): string {
  return [card.year, formatLabel(card.format), card.format === "MOVIE" ? null : episodesLabel(card.episodes)]
    .filter(Boolean)
    .join(" · ");
}

export function CardBack({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[6cqw] bg-[linear-gradient(145deg,#e9edf5,#9aa3b5_50%,#f4f6fa)] p-[2.6cqw] shadow-[0_18px_40px_-14px_rgb(0_0_0/0.6)]",
        className,
      )}
    >
      <div className="card-back relative flex h-full flex-col items-center justify-center overflow-hidden rounded-[4cqw]">
        <div className="absolute inset-[6cqw] rounded-[3cqw] border border-white/15" />
        <div className="grid size-[42cqw] place-items-center rounded-full bg-black/25 ring-2 ring-white/20">
          <Logo className="size-[26cqw]" />
        </div>
        <span className="mt-[5cqw] text-[4.4cqw] font-semibold tracking-[0.45em] text-white/80">ANISYNC</span>
      </div>
    </div>
  );
}

function CardFront({
  card,
  shine,
  details,
  onDetails,
  priority,
}: {
  card: BoosterCard;
  shine: MotionValue<number>;
  details: boolean;
  onDetails?: (open: boolean) => void;
  priority?: boolean;
}) {
  const holoX = useTransform(shine, [0, 1], ["-18%", "18%"]);
  const sheenX = useTransform(shine, [0, 1], ["-45%", "45%"]);
  const Icon = RARITY_ICONS[card.rarity];
  const score = scoreOutOfTen(card.score);

  return (
    <div className="rounded-[6cqw] p-[2.6cqw] shadow-[0_18px_40px_-14px_rgb(0_0_0/0.6)] [background:var(--frame)]">
      <div className="relative flex h-full flex-col overflow-hidden rounded-[4cqw] bg-card text-card-foreground">
        <div className="relative isolate min-h-0 flex-1 overflow-hidden bg-muted">
          <Image
            src={card.cover}
            alt=""
            fill
            sizes="(min-width: 640px) 330px, 80vw"
            priority={priority}
            draggable={false}
            className="object-cover"
          />
          {card.rarity !== "common" && (
            <motion.div
              aria-hidden
              className="card-holo pointer-events-none absolute inset-[-40%]"
              style={{ x: holoX, opacity: HOLO_OPACITY[card.rarity] }}
            />
          )}
          {card.rarity === "legendary" && (
            <div aria-hidden className="card-sparkle pointer-events-none absolute inset-0 opacity-80" />
          )}
          <motion.div aria-hidden className="card-sheen pointer-events-none absolute inset-[-40%]" style={{ x: sheenX }} />
          <div className="absolute inset-x-0 top-0 flex items-start justify-between p-[3cqw]">
            <span className="inline-flex items-center gap-[1.2cqw] rounded-full bg-black/60 px-[2.8cqw] py-[1.1cqw] text-[3.9cqw] font-semibold text-white">
              <Icon className="size-[4cqw]" aria-hidden />
              {RARITY_LABELS[card.rarity]}
            </span>
            {score && (
              <span className="inline-flex items-center gap-[1cqw] rounded-full bg-black/60 px-[2.8cqw] py-[1.1cqw] text-[3.9cqw] font-semibold text-white tabular-nums">
                <StarIcon className="size-[3.8cqw] fill-current text-amber-300" aria-hidden />
                {score}
              </span>
            )}
          </div>
          {onDetails && card.synopsis && (
            <button
              type="button"
              onClick={() => onDetails(true)}
              aria-label={`Synopsis de ${card.title}`}
              className="absolute right-[2cqw] bottom-[2cqw] grid size-11 place-items-center rounded-full bg-black/55 text-white outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <InfoIcon className="size-5" aria-hidden />
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-[1.6cqw] p-[4cqw] pt-[3.4cqw]">
          <h3 className="line-clamp-2 text-[5.8cqw] leading-tight font-semibold">{card.title}</h3>
          <p className="text-[4.2cqw] text-muted-foreground">{cardMeta(card)}</p>
          {card.genres.length > 0 && (
            <ul className="flex flex-wrap gap-[1.4cqw]" aria-label="Genres">
              {card.genres.slice(0, 3).map((genre) => (
                <li key={genre} className="rounded-full bg-muted px-[2.4cqw] py-[0.7cqw] text-[3.7cqw] text-muted-foreground">
                  {genre}
                </li>
              ))}
            </ul>
          )}
        </div>

        <AnimatePresence>
          {details && (
            <motion.div
              key="details"
              role="dialog"
              aria-label={`Synopsis de ${card.title}`}
              className="absolute inset-0 z-10 flex flex-col bg-card"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <div className="flex items-start gap-2 border-b border-border p-[4cqw] pr-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[5cqw] leading-tight font-semibold">{card.title}</h3>
                  {card.englishTitle && card.englishTitle !== card.title && (
                    <p className="mt-[1cqw] text-[3.6cqw] text-muted-foreground">{card.englishTitle}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDetails?.(false)}
                  aria-label="Fermer le synopsis"
                  className="grid size-11 shrink-0 place-items-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon className="size-5" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-[4cqw] text-[4.4cqw] leading-relaxed whitespace-pre-line">
                {card.synopsis}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * A booster card with both faces. `flip` goes from 1 (face down) to 0 (face up):
 * a 3D turn normally, a crossfade under reduced motion.
 */
export function BoosterCardView({
  card,
  flip,
  shine,
  reduced,
  details = false,
  onDetails,
  priority,
  className,
}: {
  card: BoosterCard;
  flip: MotionValue<number>;
  shine: MotionValue<number>;
  reduced: boolean;
  details?: boolean;
  onDetails?: (open: boolean) => void;
  priority?: boolean;
  className?: string;
}) {
  const rotateY = useTransform(flip, (f) => (reduced ? 0 : f * 180));
  const frontOpacity = useTransform(flip, (f) => (reduced ? 1 - f : f > 0.5 ? 0 : 1));
  const backOpacity = useTransform(flip, (f) => (reduced ? f : f > 0.5 ? 1 : 0));

  return (
    <div
      className={cn(`entry-accent rarity-${card.rarity} relative aspect-[5/7] [container-type:inline-size]`, className)}
      style={accentStyle(card.color)}
    >
      <motion.div className="absolute inset-0 transform-3d" style={{ rotateY }}>
        <motion.div className="absolute inset-0 backface-hidden [&>div]:h-full" style={{ opacity: frontOpacity }}>
          <CardFront card={card} shine={shine} details={details} onDetails={onDetails} priority={priority} />
        </motion.div>
        <motion.div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 backface-hidden [&>div]:h-full",
            !reduced && "[transform:rotateY(180deg)]",
          )}
          style={{ opacity: backOpacity }}
        >
          <CardBack />
        </motion.div>
      </motion.div>
    </div>
  );
}
