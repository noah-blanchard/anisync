"use client";

import Image from "next/image";
import { AlertTriangleIcon, ImageOffIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import type { MergedEntry } from "@/lib/merge";
import { cn } from "@/lib/utils";

/** Cover art with a soft glow in the entry accent colour. */
export function Cover({
  src,
  alt,
  className,
  glow = true,
  sizes = "(min-width: 768px) 240px, 80px",
  priority = false,
}: {
  src: string | null;
  alt: string;
  className?: string;
  glow?: boolean;
  sizes?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  return (
    <div className={cn("relative aspect-[2/3] shrink-0", className)}>
      {glow && (
        <div
          aria-hidden
          className="absolute inset-2 -z-0 translate-y-2 rounded-2xl bg-entry-accent opacity-35 blur-xl transition-opacity dark:opacity-30"
        />
      )}
      <div className="relative h-full w-full overflow-hidden rounded-[inherit] bg-muted ring-1 ring-black/5 dark:ring-white/10">
        {src && !failed ? (
          <Image
            src={src}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className="object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOffIcon className="size-5" aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}

/** Number that slides in when it changes (disabled with reduced motion). */
export function TickNumber({ value, className }: { value: number | string; className?: string }) {
  return (
    <span className={cn("inline-flex overflow-hidden tabular-nums", className)}>
      <span key={value} className="inline-block motion-safe:animate-tick">
        {value}
      </span>
    </span>
  );
}

export function ProgressBar({ value, total, className }: { value: number; total: number | null; className?: string }) {
  const ratio = total ? Math.min(1, value / total) : value > 0 ? 0.5 : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total ?? undefined}
      aria-valuenow={value}
      aria-label="Progression"
      className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-entry-accent transition-[width] duration-500 ease-out",
          !total && value > 0 && "opacity-50",
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

/** Sync state badges: "Désynchronisé" (clickable), "MAL uniquement", "AniList uniquement". */
export function SyncBadges({
  entry,
  onCompare,
  className,
}: {
  entry: MergedEntry;
  onCompare?: () => void;
  className?: string;
}) {
  const badges: React.ReactNode[] = [];
  if (!entry.inSync) {
    const label = entry.missingOn
      ? `Absent sur ${entry.missingOn === "mal" ? "MAL" : "AniList"}`
      : "Désynchronisé";
    badges.push(
      onCompare ? (
        <Badge key="sync" variant="warning" asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCompare();
            }}
            className="pointer-events-auto relative z-10 min-h-6"
            aria-label={`${label} : comparer MAL et AniList pour ${entry.title}`}
          >
            <AlertTriangleIcon aria-hidden />
            {label}
          </button>
        </Badge>
      ) : (
        <Badge key="sync" variant="warning">
          <AlertTriangleIcon aria-hidden />
          {label}
        </Badge>
      ),
    );
  }
  if (entry.availability === "mal_only") badges.push(<Badge key="only" variant="secondary">MAL uniquement</Badge>);
  if (entry.availability === "anilist_only") {
    badges.push(<Badge key="only" variant="secondary">AniList uniquement</Badge>);
  }
  if (badges.length === 0) return null;
  return <div className={cn("flex flex-wrap items-center gap-1.5", className)}>{badges}</div>;
}
