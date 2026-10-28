"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, InfinityIcon, PackageOpenIcon } from "lucide-react";
import * as React from "react";
import { PageHeader } from "@/components/app-shell";
import { PackArt } from "@/components/booster/pack-art";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentRound, useBoosterAdult, usePrefetchBooster } from "@/hooks/use-booster";
import { availableBoosters, BOOSTERS, boosterStyle, DEFAULT_BOOSTER } from "@/lib/boosters";
import { cn } from "@/lib/utils";

const LAST_KEY = "anisync-booster-last";

function readLast(): string {
  try {
    return localStorage.getItem(LAST_KEY) ?? DEFAULT_BOOSTER;
  } catch {
    return DEFAULT_BOOSTER;
  }
}

/** The booster shop: a snap carousel of packs, the centered one opens. */
export function CatalogView() {
  const router = useRouter();
  const [adult] = useBoosterAdult();
  const boosters = React.useMemo(() => availableBoosters(adult), [adult]);
  const prefetch = usePrefetchBooster();
  const track = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(0);
  const booster = boosters[Math.min(active, boosters.length - 1)]!;
  const locked = BOOSTERS.length - boosters.length;

  const scrollTo = React.useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    const item = track.current?.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ behavior, inline: "center", block: "nearest" });
  }, []);

  // Start on the last opened booster.
  React.useEffect(() => {
    const index = boosters.findIndex((b) => b.id === readLast());
    if (index > 0) {
      setActive(index);
      scrollTo(index, "instant");
    }
  }, [boosters, scrollTo]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let distance = Infinity;
    Array.from(el.children).forEach((child, i) => {
      const c = child as HTMLElement;
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center);
      if (d < distance) {
        distance = d;
        best = i;
      }
    });
    setActive(best);
  };

  // Once the carousel rests on a pack, prepare its next opening so it starts instantly.
  React.useEffect(() => {
    const timer = setTimeout(() => prefetch(booster.id, currentRound(booster.id), adult), 900);
    return () => clearTimeout(timer);
  }, [booster.id, adult, prefetch]);

  const open = (id: string) => {
    try {
      localStorage.setItem(LAST_KEY, id);
    } catch {
      // Private mode: the carousel just starts on the first pack next time.
    }
    router.push(`/booster/${id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      scrollTo(Math.max(0, Math.min(boosters.length - 1, active + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(booster.id);
    }
  };

  return (
    <>
      <PageHeader
        title="Boosters"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {boosters.length} paquets · <InfinityIcon className="size-4" aria-label="ouvertures illimitées" />
          </span>
        }
      />

      <section aria-roledescription="carrousel" aria-label="Boosters disponibles" className="-mx-4 md:-mx-6 lg:mx-0">
        <div className="relative">
          <div
            ref={track}
            role="listbox"
            tabIndex={0}
            aria-label="Choisis un booster"
            aria-activedescendant={`booster-${booster.id}`}
            onScroll={onScroll}
            onKeyDown={onKeyDown}
            className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-[calc(50%-var(--pack-w)/2)] py-4 outline-none [--pack-w:clamp(8.5rem,calc((100dvh-30rem)*0.625),min(46vw,14rem))] focus-visible:ring-2 focus-visible:ring-ring"
          >
            {boosters.map((b, i) => (
              <button
                key={b.id}
                id={`booster-${b.id}`}
                type="button"
                role="option"
                aria-selected={i === active}
                aria-label={`${b.name} : ${b.tagline}`}
                tabIndex={-1}
                onClick={() => (i === active ? open(b.id) : scrollTo(i))}
                className="w-[var(--pack-w)] shrink-0 snap-center outline-none"
              >
                <PackArt
                  booster={b}
                  className={cn(
                    "w-full drop-shadow-[0_14px_22px_rgb(0_0_0/0.4)] transition-[scale,opacity] duration-300 ease-out",
                    i === active ? "scale-100" : "scale-[0.86] opacity-55",
                  )}
                />
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Booster précédent"
            disabled={active === 0}
            onClick={() => scrollTo(active - 1)}
            className="absolute top-1/2 left-4 hidden -translate-y-1/2 rounded-full bg-background/80 md:inline-flex"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Booster suivant"
            disabled={active === boosters.length - 1}
            onClick={() => scrollTo(active + 1)}
            className="absolute top-1/2 right-4 hidden -translate-y-1/2 rounded-full bg-background/80 md:inline-flex"
          >
            <ChevronRightIcon />
          </Button>
        </div>

        <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 text-center">
          <ol className="flex items-center gap-1.5" aria-hidden>
            {boosters.map((b, i) => (
              <li key={b.id}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => scrollTo(i)}
                  className={cn(
                    "block h-2 rounded-full transition-[width,background-color] duration-300",
                    i === active ? "w-5 bg-foreground" : "w-2 bg-border",
                  )}
                />
              </li>
            ))}
          </ol>
          <div aria-live="polite" className="min-h-16">
            <h2 className="flex items-center justify-center gap-2 text-xl font-semibold">
              {booster.name}
              {booster.adult && <Badge variant="warning">18+</Badge>}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{booster.tagline}</p>
          </div>
          <Button
            size="lg"
            onClick={() => open(booster.id)}
            style={boosterStyle(booster)}
            className="w-full rounded-full bg-[linear-gradient(120deg,var(--foil-a),var(--foil-b),var(--foil-c))] text-white shadow-lg hover:opacity-90"
          >
            <PackageOpenIcon />
            Ouvrir le booster {booster.name}
          </Button>
          {locked > 0 && (
            <p className="text-xs text-muted-foreground">
              {locked} boosters de plus avec le contenu adulte, à activer dans les{" "}
              <Link href="/settings" className="underline underline-offset-4 hover:text-foreground">
                paramètres
              </Link>
              .
            </p>
          )}
        </div>
      </section>
    </>
  );
}
