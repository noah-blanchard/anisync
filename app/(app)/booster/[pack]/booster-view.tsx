"use client";

import { useQuery } from "@tanstack/react-query";
import { motion, useAnimate, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { CheckIcon, LayersIcon, Loader2Icon, LockIcon, PackageOpenIcon, Undo2Icon, XIcon } from "lucide-react";
import * as React from "react";
import { cardMeta } from "@/components/booster/card";
import { Burst, Deck, DeckActions, isHit, type SwipeDir } from "@/components/booster/deck";
import { originOf, sparkle } from "@/components/booster/effects";
import { BoosterPack, OpenedPack } from "@/components/booster/pack";
import { Button } from "@/components/ui/button";
import {
  boosterQuery,
  consumeRound,
  currentRound,
  useBoosterAdult,
  useBoosterBlur,
  useBoosterSwipes,
  usePrefetchBooster,
  type Decision,
} from "@/hooks/use-booster";
import { RARITY_LABELS, scoreOutOfTen, type BoosterCard } from "@/lib/booster";
import { boosterStyle, getBooster } from "@/lib/boosters";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/** sealed → (waiting) → burst → deck → recap */
type Phase = "sealed" | "waiting" | "burst" | "deck" | "recap";

interface Swipe {
  card: BoosterCard;
  decision: Decision;
}

const DIM = { none: 0, stage: 0.4, hit: 0.7 };

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
const subscribeNothing = () => () => {};

function describe(card: BoosterCard, position: number, total: number): string {
  const score = scoreOutOfTen(card.score);
  return [
    `Carte ${position} sur ${total}, ${RARITY_LABELS[card.rarity]} : ${card.title}`,
    cardMeta(card),
    score ? `note ${score} sur 10` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function ProgressDots({ total, history, index }: { total: number; history: Swipe[]; index: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Carte ${Math.min(index + 1, total)} sur ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const swipe = history[i];
        return (
          <li
            key={i}
            className={cn(
              "size-2 rounded-full transition-colors",
              swipe?.decision === "added" && "bg-success",
              swipe?.decision === "skipped" && "bg-muted-foreground/40",
              !swipe && i === index && "bg-primary ring-2 ring-primary/30",
              !swipe && i !== index && "bg-border",
            )}
          />
        );
      })}
    </ol>
  );
}

function Recap({
  history,
  blur,
  onAnother,
  onUndo,
}: {
  history: Swipe[];
  blur: boolean;
  onAnother: () => void;
  onUndo: () => void;
}) {
  const added = history.filter((s) => s.decision === "added").length;
  const skipped = history.length - added;
  const anotherRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => anotherRef.current?.focus(), []);

  return (
    <motion.section
      aria-labelledby="booster-recap-title"
      className="flex w-full max-w-md flex-col items-center gap-6 text-center"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <div>
        <h1 id="booster-recap-title" className="text-2xl font-semibold tracking-tight">
          Booster terminé
        </h1>
        <p className="mt-1 text-muted-foreground">
          <span className="font-medium text-success">{plural(added, "ajouté")}</span> · {plural(skipped, "passé")}
        </p>
      </div>
      <ul className="grid w-full grid-cols-5 gap-2">
        {history.map(({ card, decision }) => (
          <li key={card.anilistId} className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-muted",
                decision === "added" ? "ring-2 ring-success" : "opacity-45 grayscale",
              )}
            >
              <Image
                src={card.cover}
                alt=""
                fill
                sizes="80px"
                className={cn("object-cover", blur && card.isAdult && "scale-110 blur-md")}
              />
            </div>
            <span className="sr-only">
              {card.title} : {decision === "added" ? "ajouté" : "passé"}
            </span>
            {decision === "added" ? (
              <CheckIcon className="size-4 text-success" aria-hidden />
            ) : (
              <XIcon className="size-4 text-muted-foreground" aria-hidden />
            )}
          </li>
        ))}
      </ul>
      <div className="flex w-full flex-col gap-2">
        <Button ref={anotherRef} size="lg" onClick={onAnother}>
          <PackageOpenIcon />
          Ouvrir un autre booster
        </Button>
        <div className="flex flex-wrap justify-center gap-x-2">
          <Button variant="ghost" onClick={onUndo}>
            <Undo2Icon />
            Annuler le dernier choix
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/booster">
              <LayersIcon />
              Changer de booster
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/library">Voir ma liste</Link>
          </Button>
        </div>
      </div>
    </motion.section>
  );
}

export function BoosterView({ packId }: { packId: string }) {
  const booster = getBooster(packId)!;
  const reduced = useReducedMotion() ?? false;
  const [adult] = useBoosterAdult();
  const [blur] = useBoosterBlur();
  // The preference lives in localStorage: wait for it, or the server render would fetch a pack for nothing.
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false);
  const locked = Boolean(booster.adult) && !adult;
  const [packRound, setPackRound] = React.useState(() => currentRound(booster.id));
  const { data, error, refetch, isFetching } = useQuery({
    ...boosterQuery(booster.id, packRound, adult),
    enabled: hydrated && !locked,
  });
  const prefetch = usePrefetchBooster();
  const { decide, undo } = useBoosterSwipes();
  const [scope, animateScope] = useAnimate<HTMLDivElement>();
  const stageRef = React.useRef<HTMLDivElement>(null);

  const [phase, setPhase] = React.useState<Phase>("sealed");
  const [torn, setTorn] = React.useState(false);
  const [cards, setCards] = React.useState<BoosterCard[]>([]);
  const [index, setIndex] = React.useState(0);
  const [history, setHistory] = React.useState<Swipe[]>([]);
  const [revealed, setRevealed] = React.useState<ReadonlySet<number>>(() => new Set());
  const [exitDir, setExitDir] = React.useState<SwipeDir | 0>(1);
  const [returning, setReturning] = React.useState<{ id: number; dir: SwipeDir } | null>(null);
  const [details, setDetails] = React.useState(false);
  const [dim, setDim] = React.useState(DIM.none);
  const [announcement, setAnnouncement] = React.useState("");
  /** Index of the card being decided, until the deck re-renders: a second press must not decide it twice. */
  const deciding = React.useRef(-1);

  const top = phase === "deck" ? cards[index] : undefined;
  const topReady = top !== undefined && revealed.has(top.anilistId);

  const tear = React.useCallback(() => {
    if (torn) return;
    setTorn(true);
    // This pack is spent: the next visit (or "another pack") gets a fresh one, fetched now.
    prefetch(booster.id, consumeRound(booster.id), adult);
    void sparkle("open", originOf(stageRef.current, "top"));
    setAnnouncement("Booster ouvert");
    setTimeout(() => setPhase("waiting"), reduced ? 250 : 520);
  }, [torn, prefetch, adult, reduced, booster.id]);

  React.useEffect(() => {
    if (phase !== "waiting" || !data) return;
    setCards(data);
    setDim(DIM.stage);
    setPhase("burst");
  }, [phase, data]);

  // The burst cards already sit where the deck draws them: mount the deck in the background, no dropped frame.
  const onBurstDone = React.useCallback(() => {
    React.startTransition(() => setPhase("deck"));
  }, []);

  const onCharge = React.useCallback((card: BoosterCard) => {
    setDim(isHit(card.rarity) ? DIM.hit : DIM.stage);
  }, []);

  const onFlipped = React.useCallback(
    (card: BoosterCard) => {
      setRevealed((prev) => new Set(prev).add(card.anilistId));
      setDim(DIM.stage);
      const position = cards.indexOf(card) + 1;
      setAnnouncement(describe(card, position, cards.length));
      if (card.rarity === "epic") void sparkle("epic", originOf(stageRef.current));
      if (card.rarity === "legendary") {
        void sparkle("legendary", originOf(stageRef.current));
        if (!reduced && scope.current) {
          void animateScope(scope.current, { x: [0, -12, 10, -8, 6, -3, 0] }, { duration: 0.5, ease: "easeOut" });
        }
      }
    },
    [cards, reduced, scope, animateScope],
  );

  const swipe = React.useCallback(
    (dir: SwipeDir, fromGesture = false) => {
      const card = cards[index];
      if (phase !== "deck" || !card || !revealed.has(card.anilistId) || deciding.current === index) return;
      deciding.current = index;
      if (!fromGesture) haptic("medium");
      const decision: Decision = dir === 1 ? "added" : "skipped";
      decide(card, decision);
      const update = () => {
        setExitDir(dir);
        setReturning(null);
        setDetails(false);
        setHistory((h) => [...h, { card, decision }]);
        setIndex(index + 1);
        setAnnouncement(decision === "added" ? `Ajouté à ta liste : ${card.title}` : `Passé : ${card.title}`);
      };
      // A swiped card is already flying on its own: let React update the deck without blocking its frames.
      if (fromGesture) React.startTransition(update);
      else update();
      if (index + 1 >= cards.length) {
        setTimeout(() => {
          setPhase("recap");
          setDim(DIM.none);
        }, reduced ? 200 : 450);
      }
    },
    [cards, index, phase, revealed, decide, reduced],
  );

  const rewind = React.useCallback(() => {
    const last = history[history.length - 1];
    if (!last || (phase !== "deck" && phase !== "recap")) return;
    haptic("light");
    deciding.current = -1;
    void undo(last.card, last.decision);
    setHistory((h) => h.slice(0, -1));
    setExitDir(0);
    setReturning({ id: last.card.anilistId, dir: last.decision === "added" ? 1 : -1 });
    setDetails(false);
    setIndex((i) => i - 1);
    setPhase("deck");
    setDim(DIM.stage);
    setAnnouncement(
      last.decision === "added"
        ? `${last.card.title} est retiré de ta liste et revient`
        : `${last.card.title} revient`,
    );
  }, [history, phase, undo]);

  const another = React.useCallback(() => {
    deciding.current = -1;
    setPackRound(currentRound(booster.id));
    setPhase("sealed");
    setTorn(false);
    setCards([]);
    setIndex(0);
    setHistory([]);
    setRevealed(new Set());
    setReturning(null);
    setDim(DIM.none);
    setAnnouncement("Nouveau booster scellé");
  }, [booster.id]);

  // ← / → swipe, Backspace undoes, Enter or Space opens the pack, Escape closes the synopsis.
  const keys = React.useRef({ tear, swipe, rewind, phase, details });
  React.useEffect(() => {
    keys.current = { tear, swipe, rewind, phase, details };
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const k = keys.current;
      if (k.phase === "sealed" && (e.key === "Enter" || e.key === " ") && !target?.closest("button, a")) {
        e.preventDefault();
        k.tear();
      } else if (k.phase === "deck") {
        if (e.key === "Escape" && k.details) setDetails(false);
        else if (e.key === "ArrowLeft") k.swipe(-1);
        else if (e.key === "ArrowRight") k.swipe(1);
        else if (e.key === "Backspace") k.rewind();
        else return;
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = cards.length || 5;

  if (hydrated && locked) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <LockIcon className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold">Booster {booster.name} verrouillé</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Active le contenu adulte dans les paramètres pour ouvrir ce booster.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/settings">Paramètres</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/booster">Autres boosters</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scope}
      style={boosterStyle(booster)}
      className="fixed inset-0 flex flex-col overflow-hidden bg-background select-none [--card-w:min(80vw,340px,calc((100dvh-16rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))*5/7))]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,color-mix(in_oklab,var(--primary)_24%,transparent),transparent_62%)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30 dark:opacity-100">
        <motion.div
          className="absolute inset-0 bg-[#07080c]"
          initial={false}
          animate={{ opacity: dim }}
          transition={{ duration: reduced ? 0 : 0.6, ease: "easeOut" }}
        />
      </div>

      <header className="relative z-20 flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button asChild variant="ghost" size="icon-lg" className="rounded-full">
          <Link href="/booster" aria-label="Fermer le booster">
            <XIcon className="size-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-semibold">Booster {booster.name}</p>
          <p className="truncate text-xs text-muted-foreground">{booster.tagline}</p>
        </div>
        <div className="flex w-11 justify-end">
          {(phase === "deck" || phase === "recap") && <ProgressDots total={total} history={history} index={index} />}
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4">
        {phase === "recap" ? (
          <Recap history={history} blur={blur} onAnother={another} onUndo={rewind} />
        ) : (
          <div ref={stageRef} className="relative aspect-[5/7] w-[var(--card-w)]">
            {(phase === "sealed" || phase === "waiting") && (
              <div className="absolute top-1/2 left-1/2 w-[88%] -translate-x-1/2 -translate-y-1/2">
                {phase === "sealed" ? (
                  <BoosterPack key={packRound} booster={booster} torn={torn} onTear={tear} />
                ) : (
                  <div className={cn(!error && "motion-safe:animate-pulse")}>
                    <OpenedPack booster={booster} className="w-full" />
                  </div>
                )}
              </div>
            )}

            {phase === "burst" && (
              <>
                <Burst count={cards.length} reduced={reduced} onDone={onBurstDone} />
                <motion.div
                  aria-hidden
                  className="absolute top-1/2 left-1/2 z-20 w-[88%] -translate-x-1/2 -translate-y-1/2 will-change-transform"
                  initial={{ opacity: 1 }}
                  animate={reduced ? { opacity: 0 } : { y: ["0%", "0%", "115%"], opacity: [1, 1, 0] }}
                  transition={reduced ? { duration: 0.3 } : { duration: 1, times: [0, 0.42, 0.85], ease: "easeIn" }}
                >
                  <OpenedPack booster={booster} className="w-full" />
                  {!reduced && (
                    <motion.div
                      className="absolute inset-x-[-10%] top-[6%] h-[22%] bg-[radial-gradient(closest-side,rgb(255_255_255/0.95),rgb(170_215_255/0.4)_55%,transparent)]"
                      initial={{ opacity: 0, scaleX: 0.4 }}
                      animate={{ opacity: [0, 1, 0], scaleX: [0.4, 1.2, 1.4] }}
                      transition={{ duration: 0.6, times: [0, 0.3, 1] }}
                    />
                  )}
                </motion.div>
              </>
            )}

            {phase === "deck" && (
              <Deck
                cards={cards}
                index={index}
                revealed={revealed}
                exitDir={exitDir}
                returning={returning}
                details={details}
                reduced={reduced}
                blur={blur}
                onDetails={setDetails}
                onCharge={onCharge}
                onFlipped={onFlipped}
                onSwipe={(dir) => swipe(dir, true)}
              />
            )}
          </div>
        )}
      </main>

      <footer className="relative z-20 flex min-h-36 flex-col items-center justify-center gap-3 px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {phase === "sealed" && (
          <>
            <p className="text-center text-sm text-muted-foreground">Glisse ton doigt sur le haut du paquet pour le déchirer</p>
            <Button size="lg" variant="secondary" onClick={tear} className="rounded-full">
              <PackageOpenIcon />
              Ouvrir le booster
            </Button>
            {error && <LoadError message={error.message} onRetry={() => refetch()} retrying={isFetching} />}
          </>
        )}
        {phase === "waiting" &&
          (error ? (
            <LoadError message={error.message} onRetry={() => refetch()} retrying={isFetching} />
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden />
              Préparation des cartes…
            </p>
          ))}
        {(phase === "burst" || phase === "deck") && (
          <DeckActions disabled={phase !== "deck" || !topReady} title={top?.title ?? ""} onSwipe={(dir) => swipe(dir)}>
            <button
              type="button"
              onClick={rewind}
              disabled={history.length === 0}
              aria-label="Annuler le dernier choix"
              className="grid size-12 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 motion-safe:active:scale-90"
            >
              <Undo2Icon className="size-5" aria-hidden />
            </button>
          </DeckActions>
        )}
      </footer>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function LoadError({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 text-center text-sm">
      <p className="text-destructive">Impossible de préparer le booster : {message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying && <Loader2Icon className="motion-safe:animate-spin" />}
        Réessayer
      </Button>
    </div>
  );
}
