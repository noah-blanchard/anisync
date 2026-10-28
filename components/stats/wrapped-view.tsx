"use client";

import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon, ShareIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Cover } from "@/components/entry-bits";
import { MedalBadge } from "@/components/stats/charts";
import { Button } from "@/components/ui/button";
import { useStats } from "@/hooks/use-stats";
import { formatDecimal, formatInteger, formatPercent, formatSigned, genreLabel } from "@/lib/stats/labels";
import { completionYears } from "@/lib/stats/time";
import { wrapped, type Wrapped } from "@/lib/stats/wrapped";
import { cn } from "@/lib/utils";
import { shareWrappedCard } from "./wrapped-image";

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });

/** Each slide's background, dark enough for white text. */
const BACKGROUNDS = [
  "from-[#0b1530] via-[#1c3f8f] to-[#2a78d6]",
  "from-[#1a0f2e] via-[#4a2a8a] to-[#6250d6]",
  "from-[#2a0f12] via-[#8a2a2a] to-[#d9542a]",
  "from-[#062420] via-[#0f5a48] to-[#199e70]",
  "from-[#25140a] via-[#7a4a10] to-[#c98500]",
  "from-[#2a0d1c] via-[#7a2450] to-[#d55181]",
];

interface Slide {
  id: string;
  content: React.ReactNode;
}

function Big({ children }: { children: React.ReactNode }) {
  return <p className="text-6xl font-bold tracking-tight md:text-7xl">{children}</p>;
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-semibold tracking-wide text-white/70 uppercase">{children}</p>;
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="text-lg text-white/85">{children}</p>;
}

function plural(n: number, word: string) {
  return `${formatInteger(n)} ${word}${n > 1 ? "s" : ""}`;
}

function buildSlides(w: Wrapped, subject: string, onShare: () => void, sharing: boolean, years: number[], href: (y: number) => string): Slide[] {
  const hours = Math.round(w.minutes / 60);
  const slides: Slide[] = [
    {
      id: "intro",
      content: (
        <>
          <Kicker>AniSync Wrapped</Kicker>
          <p className="text-3xl font-semibold">{subject}</p>
          <Big>{formatInteger(hours)} h</Big>
          <Line>devant l&apos;écran, soit {formatDecimal(Math.round((w.minutes / 1440) * 10) / 10)} jours non-stop.</Line>
          {w.previous && w.previous.minutes > 0 ? (
            <Line>
              {formatSigned(Math.round(hours - w.previous.minutes / 60))} h par rapport à {w.year - 1}.
            </Line>
          ) : null}
        </>
      ),
    },
    {
      id: "titles",
      content: (
        <>
          <Kicker>Titres terminés</Kicker>
          <Big>{formatInteger(w.completed.length)}</Big>
          <Line>
            {plural(w.episodes, "épisode")}
            {w.started > 0 ? `, ${plural(w.started, "titre")} commencé${w.started > 1 ? "s" : ""}` : ""}.
          </Line>
          {w.topMonth ? (
            <Line>
              Mois record : {MONTH.format(Date.UTC(w.year, w.topMonth.month, 1))}, avec {plural(w.topMonth.count, "titre")}.
            </Line>
          ) : null}
          {w.previous ? (
            <Line>
              {w.previous.completed > 0
                ? `${formatSigned(w.completed.length - w.previous.completed)} titres par rapport à ${w.year - 1}.`
                : `Rien de terminé en ${w.year - 1}.`}
            </Line>
          ) : null}
        </>
      ),
    },
  ];

  if (w.topGenres.length > 0) {
    const max = w.topGenres[0]!.count;
    slides.push({
      id: "genres",
      content: (
        <>
          <Kicker>Genres de l&apos;année</Kicker>
          <ol className="flex w-full flex-col gap-3">
            {w.topGenres.map((g, i) => (
              <li key={g.genre} className="flex flex-col gap-1">
                <span className="flex justify-between text-lg">
                  <span className="font-semibold">
                    {i + 1}. {genreLabel(g.genre)}
                  </span>
                  <span className="text-white/80 tabular-nums">{g.count}</span>
                </span>
                <span aria-hidden className="h-2 rounded-r-[4px] bg-white/85" style={{ width: `${(g.count / max) * 100}%` }} />
              </li>
            ))}
          </ol>
        </>
      ),
    });
  }

  if (w.favourite) {
    slides.push({
      id: "favourite",
      content: (
        <>
          <Kicker>Coup de cœur</Kicker>
          <Cover src={w.favourite.cover} alt="" glow={false} sizes="200px" className="w-40 rounded-2xl" />
          <p className="text-3xl font-bold">{w.favourite.title}</p>
          <Line>
            {w.favourite.score}/10{w.favourite.community !== null ? ` · AniList ${formatDecimal(w.favourite.community)}` : ""}
          </Line>
        </>
      ),
    });
  }

  if (w.topStudio || w.gem) {
    slides.push({
      id: "discoveries",
      content: (
        <>
          {w.topStudio ? (
            <>
              <Kicker>Studio de l&apos;année</Kicker>
              <p className="text-4xl font-bold">{w.topStudio.studio}</p>
              <Line>{plural(w.topStudio.count, "titre")} terminé{w.topStudio.count > 1 ? "s" : ""}.</Line>
            </>
          ) : null}
          {w.gem ? (
            <div className="mt-6 flex items-center gap-4">
              <Cover src={w.gem.cover} alt="" glow={false} sizes="80px" className="w-20 rounded-xl" />
              <div className="min-w-0">
                <Kicker>Pépite</Kicker>
                <p className="text-xl font-bold">{w.gem.title}</p>
                <p className="text-white/80">
                  {w.gem.score}/10 · seulement {formatInteger(w.gem.popularity ?? 0)} membres AniList
                </p>
              </div>
            </div>
          ) : null}
        </>
      ),
    });
  }

  if (w.generous || w.harsh) {
    slides.push({
      id: "disagreements",
      content: (
        <>
          <Kicker>Contre l&apos;avis général</Kicker>
          {[w.generous, w.harsh].map((g, i) =>
            g ? (
              <div key={i} className="flex items-center gap-4">
                <Cover src={g.row.cover} alt="" glow={false} sizes="72px" className="w-16 rounded-xl" />
                <div className="min-w-0">
                  <p className="text-white/70">{i === 0 ? "Plus haut que tout le monde" : "Plus bas que tout le monde"}</p>
                  <p className="text-xl font-bold">{g.row.title}</p>
                  <p className="text-white/85 tabular-nums">
                    {g.row.score}/10 contre {formatDecimal(g.row.community!)} ({formatSigned(g.gap)})
                  </p>
                </div>
              </div>
            ) : null,
          )}
          {w.meanScore !== null ? <Line>Note moyenne de l&apos;année : {formatDecimal(Math.round(w.meanScore * 10) / 10)}.</Line> : null}
        </>
      ),
    });
  }

  if (w.fastest || w.simulcastShare !== null || w.medianDays !== null) {
    slides.push({
      id: "pace",
      content: (
        <>
          <Kicker>Rythme</Kicker>
          {w.fastest ? (
            <>
              <p className="text-3xl font-bold">{w.fastest.row.title}</p>
              <Line>
                {plural(w.fastest.row.episodes ?? 0, "épisode")} en {plural(w.fastest.days, "jour")} : le marathon de l&apos;année.
              </Line>
            </>
          ) : null}
          {w.medianDays !== null ? <Line>{plural(Math.round(w.medianDays), "jour")} en médiane pour finir un titre.</Line> : null}
          {w.simulcastShare !== null ? <Line>{formatPercent(w.simulcastShare)} des titres commencés pendant leur diffusion.</Line> : null}
        </>
      ),
    });
  }

  if (w.newMedals.length > 0) {
    slides.push({
      id: "medals",
      content: (
        <>
          <Kicker>Succès de l&apos;année</Kicker>
          <ul className="flex w-full flex-col gap-3">
            {w.newMedals.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-semibold">{a.name}</span>
                  <span className="block text-sm text-white/75">{a.description}</span>
                </span>
                {a.medal ? <MedalBadge medal={a.medal} /> : null}
              </li>
            ))}
          </ul>
        </>
      ),
    });
  }

  if (w.traits.length > 0) {
    slides.push({
      id: "profile",
      content: (
        <>
          <Kicker>Profil de l&apos;année</Kicker>
          <ul className="flex flex-wrap gap-2">
            {w.traits.map((t) => (
              <li key={t.id} className="rounded-full bg-white/15 px-4 py-2 text-lg font-semibold">
                {t.label}
              </li>
            ))}
          </ul>
        </>
      ),
    });
  }

  slides.push({
    id: "summary",
    content: (
      <>
        <Kicker>En résumé</Kicker>
        <Big>{w.year}</Big>
        <dl className="grid w-full grid-cols-2 gap-4">
          {[
            ["Heures", `${formatInteger(hours)} h`],
            ["Titres terminés", formatInteger(w.completed.length)],
            ["Genre n°1", w.topGenres[0] ? genreLabel(w.topGenres[0].genre) : "—"],
            ["Coup de cœur", w.favourite?.title ?? "—"],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-white/70">{label}</dt>
              <dd className="truncate text-xl font-bold">{value}</dd>
            </div>
          ))}
        </dl>
        <Button onClick={onShare} disabled={sharing} className="bg-white text-black hover:bg-white/90">
          {sharing ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <ShareIcon />}
          Partager l&apos;image
        </Button>
        {years.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {years
              .filter((y) => y !== w.year)
              .map((y) => (
                <Link key={y} href={href(y)} className="rounded-full bg-white/15 px-3 py-1 text-sm hover:bg-white/25">
                  {y}
                </Link>
              ))}
          </div>
        ) : null}
      </>
    ),
  });
  return slides;
}

/** A year of watching as full-screen cards: tap the sides (or ← →) to move, Escape to leave. */
export function WrappedView({ user }: { user?: string }) {
  const { data, isPending, error } = useStats(user);
  const params = useSearchParams();
  const router = useRouter();
  const [index, setIndex] = React.useState(0);
  const [sharing, setSharing] = React.useState(false);
  const base = user ? `/stats/u/${encodeURIComponent(user)}` : "/stats";

  const years = React.useMemo(() => completionYears(data?.rows ?? []), [data]);
  const asked = Number(params.get("year"));
  const year = years.includes(asked) ? asked : years[0];
  const w = React.useMemo(() => (data && year !== undefined ? wrapped(data.rows, year) : null), [data, year]);
  const subject = data?.user ? `L'année ${year} de ${data.user.name}` : `Ton année ${year} en anime`;

  React.useEffect(() => setIndex(0), [year]);

  const share = React.useCallback(async () => {
    if (!w) return;
    setSharing(true);
    try {
      const result = await shareWrappedCard({
        title: data?.user ? `Wrapped de ${data.user.name}` : "Mon AniSync Wrapped",
        year: w.year,
        lines: [
          { label: "Heures devant l'écran", value: `${formatInteger(Math.round(w.minutes / 60))} h` },
          { label: "Titres terminés", value: `${formatInteger(w.completed.length)} · ${plural(w.episodes, "épisode")}` },
          ...(w.topGenres[0] ? [{ label: "Genre n°1", value: genreLabel(w.topGenres[0].genre) }] : []),
          ...(w.favourite ? [{ label: "Coup de cœur", value: `${w.favourite.title} · ${w.favourite.score}/10` }] : []),
          ...(w.traits.length > 0 ? [{ label: "Profil", value: w.traits.slice(0, 3).map((t) => t.label).join(" · ") }] : []),
        ],
        footer: "AniSync",
      });
      if (result === "downloaded") toast.success("Image enregistrée");
    } catch (e) {
      toast.error((e as Error).message || "Partage impossible");
    } finally {
      setSharing(false);
    }
  }, [w, data?.user]);

  const slides = React.useMemo(
    () => (w ? buildSlides(w, subject, share, sharing, years, (y) => `${base}/wrapped?year=${y}`) : []),
    [w, subject, share, sharing, years, base],
  );
  const last = slides.length - 1;
  const go = React.useCallback((delta: number) => setIndex((i) => Math.min(last, Math.max(0, i + delta))), [last]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") router.push(base);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, router, base]);

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0b1530] text-white">
        <LoaderCircleIcon aria-label="Chargement" className="size-8 motion-safe:animate-spin" />
      </div>
    );
  }
  if (error || !w) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#0b1530] px-6 text-center text-white">
        <p className="text-xl font-semibold">{error ? error.message : "Pas encore d'année à raconter"}</p>
        <p className="text-white/75">Le Wrapped se base sur les dates de fin de visionnage renseignées sur AniList ou MAL.</p>
        <Button asChild variant="secondary">
          <Link href={base}>Retour aux stats</Link>
        </Button>
      </div>
    );
  }

  const slide = slides[Math.min(index, last)]!;
  return (
    <div className={cn("relative flex min-h-dvh flex-col bg-gradient-to-br text-white transition-colors duration-500", BACKGROUNDS[index % BACKGROUNDS.length])}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex gap-1" aria-hidden>
          {slides.map((s, i) => (
            <span key={s.id} className={cn("h-1 flex-1 rounded-full", i <= index ? "bg-white" : "bg-white/30")} />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/80">
            {index + 1} / {slides.length}
          </p>
          <Link href={base} aria-label="Fermer le Wrapped" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-white/15">
            <XIcon className="size-5" />
          </Link>
        </div>
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-1">
        {/* Tap zones: left third goes back, the rest goes forward. Interactive content stays above them. */}
        <button type="button" tabIndex={-1} aria-hidden onClick={() => go(-1)} className="absolute inset-y-0 left-0 z-0 w-1/3 cursor-default" />
        <button type="button" tabIndex={-1} aria-hidden onClick={() => go(1)} className="absolute inset-y-0 right-0 z-0 w-2/3 cursor-default" />
        <section
          key={slide.id}
          aria-live="polite"
          className="pointer-events-none relative z-10 flex w-full flex-col justify-center gap-4 px-6 py-10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 [&_a]:pointer-events-auto [&_button]:pointer-events-auto"
        >
          {slide.content}
        </section>
      </div>

      <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" onClick={() => go(-1)} disabled={index === 0} className="text-white hover:bg-white/15 hover:text-white">
          <ChevronLeftIcon />
          Précédent
        </Button>
        <Button variant="ghost" onClick={() => go(1)} disabled={index === last} className="text-white hover:bg-white/15 hover:text-white">
          Suivant
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}
