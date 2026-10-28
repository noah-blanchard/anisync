/**
 * Gold, viewer side: the profile (traits along axes) and the achievements, both with
 * bronze / silver / gold medals. Pure functions (no I/O), unit-tested in tests/stats.test.ts and tests/stats-v2.test.ts.
 */
import { decadeOf, GENEROSITY_LABELS, median, MIN_PAIRS, MIN_SAMPLE, raterProfile } from "./gold";
import { genreLabel } from "./labels";
import { paceOf, simulcast } from "./time";
import type { StatsRow } from "./types";

export type Medal = "bronze" | "silver" | "gold";

export function medalOf(score: number): Medal | null {
  if (score >= 85) return "gold";
  if (score >= 60) return "silver";
  if (score >= 35) return "bronze";
  return null;
}

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

export type TraitId =
  | "volume"
  | "finisher"
  | "curiosity"
  | "gems"
  | "retro"
  | "pace"
  | "generosity"
  | "simulcast"
  | "marathon"
  | "franchise"
  | "backlog";

export interface Trait {
  id: TraitId;
  /** The axis */
  name: string;
  /** Where I stand on it */
  label: string;
  /** 0-100 along the axis */
  score: number;
  medal: Medal | null;
  detail: string;
  /** The two ends of the axis */
  poles: [string, string];
  /** The medal measures the distance to the middle rather than the score */
  centered?: boolean;
}

const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
const log10 = Math.log10;
const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Number of AniList genres outside Hentai: the most a curious viewer can spread over. */
const GENRE_COUNT = 18;

function trait(t: Omit<Trait, "medal">): Trait {
  return { ...t, medal: medalOf(t.centered ? Math.abs(t.score - 50) * 2 : t.score) };
}

/** The viewer profile. `rows` may include titles to watch: they only count for the backlog axis. */
export function traits(rows: readonly StatsRow[], now = Date.now()): Trait[] {
  const out: Trait[] = [];
  const watched = rows.filter((r) => r.status !== "plan_to_watch");
  const completed = watched.filter((r) => r.status === "completed");

  const hours = watched.reduce((sum, r) => sum + r.minutesWatched, 0) / 60;
  if (watched.length > 0) {
    out.push(
      trait({
        id: "volume",
        name: "Assiduité",
        label: hours < 50 ? "Occasionnel" : hours < 250 ? "Régulier" : hours < 1000 ? "Assidu" : "Légende",
        score: Math.round(clamp((100 * log10(1 + hours)) / log10(1 + 2000))),
        detail: `${fmt.format(Math.round(hours))} h de visionnage`,
        poles: ["Occasionnel", "Légende"],
      }),
    );
  }

  const dropped = watched.filter((r) => r.status === "dropped").length;
  if (completed.length + dropped >= MIN_SAMPLE) {
    const rate = completed.length / (completed.length + dropped);
    out.push(
      trait({
        id: "finisher",
        name: "Persévérance",
        label: rate < 0.6 ? "Zappeur" : rate < 0.85 ? "Sélectif" : "Finisseur",
        score: Math.round(rate * 100),
        detail: `${completed.length} terminés pour ${dropped} abandonnés`,
        poles: ["Zappeur", "Finisseur"],
      }),
    );
  }

  const genreCounts = new Map<string, number>();
  for (const r of watched) for (const g of r.genres) if (g !== "Hentai") genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  const total = [...genreCounts.values()].reduce((a, b) => a + b, 0);
  if (genreCounts.size >= 2 && watched.length >= MIN_SAMPLE) {
    let entropy = 0;
    for (const c of genreCounts.values()) entropy -= (c / total) * Math.log(c / total);
    const score = Math.round(clamp((100 * entropy) / Math.log(GENRE_COUNT)));
    const top = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    out.push(
      trait({
        id: "curiosity",
        name: "Curiosité",
        label: score < 70 ? "Spécialiste" : score < 85 ? "Curieux" : "Explorateur",
        score,
        detail: `${genreCounts.size} genres, surtout ${genreLabel(top)}`,
        poles: ["Spécialiste", "Explorateur"],
      }),
    );
  }

  const popularity = median(watched.map((r) => r.popularity).filter((p): p is number => p !== null && p > 0));
  if (popularity !== null) {
    const score = Math.round(clamp((100 * (log10(400_000) - log10(popularity))) / (log10(400_000) - log10(4_000))));
    out.push(
      trait({
        id: "gems",
        name: "Flair",
        label: score < 35 ? "Mainstream" : score < 65 ? "Équilibré" : "Défricheur",
        score,
        detail: `Popularité médiane : ${fmt.format(Math.round(popularity))} membres AniList`,
        poles: ["Mainstream", "Défricheur"],
      }),
    );
  }

  const year = median(watched.map((r) => r.year).filter((y): y is number => y !== null));
  if (year !== null) {
    const age = new Date(now).getUTCFullYear() - year;
    out.push(
      trait({
        id: "retro",
        name: "Époque",
        label: age < 5 ? "Chasseur de nouveautés" : age < 12 ? "Éclectique" : "Archéologue",
        score: Math.round(clamp((100 * age) / 25)),
        detail: `Année médiane de sortie : ${Math.round(year)}`,
        poles: ["Nouveautés", "Archéologue"],
      }),
    );
  }

  const paces = watched.map(paceOf).filter((p): p is number => p !== null);
  const pace = median(paces);
  if (pace !== null && paces.length >= MIN_PAIRS) {
    // 0.25 episode a day -> 0, 6 a day -> 100, on a log scale.
    const score = Math.round(clamp((100 * (log10(pace) - log10(0.25))) / (log10(6) - log10(0.25))));
    out.push(
      trait({
        id: "pace",
        name: "Rythme",
        label: score < 35 ? "Contemplatif" : score < 65 ? "Régulier" : "Binge-watcher",
        score,
        detail: `${fmt.format(Math.round(pace * 10) / 10)} épisodes par jour en médiane (${paces.length} titres datés)`,
        poles: ["Contemplatif", "Binge-watcher"],
      }),
    );
  }

  const live = simulcast(watched);
  if (live.share !== null && live.dated >= MIN_PAIRS) {
    const score = Math.round(live.share * 100);
    out.push(
      trait({
        id: "simulcast",
        name: "Diffusion",
        label: score < 25 ? "Rattrapeur" : score < 60 ? "Hybride" : "Simulcast",
        score,
        detail: `${pct.format(live.share)} des titres commencés pendant leur diffusion`,
        poles: ["Rattrapeur", "Simulcast"],
      }),
    );
  }

  const minutes = watched.reduce((sum, r) => sum + r.minutesWatched, 0);
  const longMinutes = watched
    .filter((r) => r.length === "long" || r.length === "saga")
    .reduce((sum, r) => sum + r.minutesWatched, 0);
  if (minutes > 0 && watched.length >= MIN_SAMPLE) {
    const share = longMinutes / minutes;
    out.push(
      trait({
        id: "marathon",
        name: "Format",
        label: share < 0.3 ? "Formats courts" : share < 0.6 ? "Polyvalent" : "Marathonien",
        score: Math.round(share * 100),
        detail: `${pct.format(share)} de ton temps sur des séries de plus de 26 épisodes`,
        poles: ["Formats courts", "Marathonien"],
      }),
    );
  }

  const withMeta = watched.filter((r) => r.hasMeta);
  if (withMeta.length >= MIN_SAMPLE) {
    const share = withMeta.filter((r) => r.isSequel).length / withMeta.length;
    out.push(
      trait({
        id: "franchise",
        name: "Fidélité",
        label: share < 0.15 ? "Picoreur" : share < 0.35 ? "Mixte" : "Fidèle aux sagas",
        score: Math.round(clamp(share * 200)),
        detail: `${pct.format(share)} de suites et dérivés`,
        poles: ["Picoreur", "Fidèle aux sagas"],
      }),
    );
  }

  const planned = rows.filter((r) => r.status === "plan_to_watch").length;
  if (completed.length >= MIN_SAMPLE) {
    const ratio = planned / completed.length;
    out.push(
      trait({
        id: "backlog",
        name: "Backlog",
        label: ratio < 0.25 ? "Raisonnable" : ratio < 0.75 ? "Collectionneur" : "Accumulateur",
        score: Math.round(clamp(ratio * 100)),
        detail: `${planned} titres à voir pour ${completed.length} terminés`,
        poles: ["Raisonnable", "Accumulateur"],
      }),
    );
  }

  const rater = raterProfile(watched);
  if (rater.bias !== null && rater.generosityIndex !== null && rater.generosity) {
    out.push(
      trait({
        id: "generosity",
        name: "Générosité",
        label: GENEROSITY_LABELS[rater.generosity],
        score: rater.generosityIndex,
        detail: `${rater.bias >= 0 ? "+" : "−"}${fmt.format(Math.abs(Math.round(rater.bias * 10) / 10))} pt en moyenne par rapport à la communauté`,
        poles: ["Sévère", "Généreux"],
        centered: true,
      }),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export interface Achievement {
  id: string;
  name: string;
  /** What is counted */
  description: string;
  value: number;
  /** Bronze, silver and gold thresholds */
  tiers: [number, number, number];
  medal: Medal | null;
  /** Next threshold to reach, null once gold */
  next: number | null;
  /** 0-1 towards the next threshold (1 once gold) */
  progress: number;
}

const MEDALS: Medal[] = ["bronze", "silver", "gold"];

export function achievement(
  id: string,
  name: string,
  description: string,
  value: number,
  tiers: [number, number, number],
): Achievement {
  const reached = tiers.filter((t) => value >= t).length;
  const next = reached < 3 ? tiers[reached]! : null;
  const previous = reached > 0 ? tiers[reached - 1]! : 0;
  return {
    id,
    name,
    description,
    value,
    tiers,
    medal: reached > 0 ? MEDALS[reached - 1]! : null,
    next,
    progress: next === null ? 1 : Math.max(0, Math.min(1, (value - previous) / (next - previous))),
  };
}

/** A hidden gem: rated 8+ with fewer AniList members than this. */
const GEM_POPULARITY = 20_000;

export function achievements(rows: readonly StatsRow[]): Achievement[] {
  const watched = rows.filter((r) => r.status !== "plan_to_watch");
  const completed = watched.filter((r) => r.status === "completed");
  const distinct = (values: Iterable<string | number>) => new Set(values).size;

  return [
    achievement(
      "episodes",
      "Bouffeur d'épisodes",
      "Épisodes vus, revisionnages compris",
      watched.reduce((sum, r) => sum + r.progress + r.repeat * (r.episodes ?? r.progress), 0),
      [100, 1_000, 5_000],
    ),
    achievement("hours", "Heures de vol", "Heures de visionnage", Math.round(watched.reduce((s, r) => s + r.minutesWatched, 0) / 60), [100, 500, 2_000]),
    achievement("completed", "Finisseur", "Titres terminés", completed.length, [25, 100, 500]),
    achievement("rated", "Critique", "Titres notés", watched.filter((r) => r.score !== null).length, [25, 150, 500]),
    achievement("movies", "Cinéphile", "Films terminés", completed.filter((r) => r.format === "MOVIE").length, [5, 25, 100]),
    achievement("genres", "Touche-à-tout", "Genres différents parmi les titres terminés", distinct(completed.flatMap((r) => r.genres)), [8, 13, 17]),
    achievement(
      "decades",
      "Voyageur temporel",
      "Décennies couvertes par les titres terminés",
      distinct(completed.filter((r) => r.year !== null).map((r) => decadeOf(r.year!))),
      [3, 5, 7],
    ),
    achievement(
      "gems",
      "Chercheur de pépites",
      "Titres notés 8+ avec moins de 20 000 membres AniList",
      watched.filter((r) => r.score !== null && r.score >= 8 && r.popularity !== null && r.popularity < GEM_POPULARITY).length,
      [1, 5, 20],
    ),
    achievement("sagas", "Marathonien", "Séries de 100 épisodes ou plus terminées", completed.filter((r) => (r.episodes ?? 0) >= 100).length, [1, 3, 10]),
    achievement("studios", "Tour des studios", "Studios différents parmi les titres terminés", distinct(completed.flatMap((r) => r.studios)), [10, 30, 75]),
    achievement(
      "binge",
      "Binge-watcher",
      "Séries de 10 épisodes ou plus terminées à 6 épisodes par jour ou plus",
      completed.filter((r) => (r.episodes ?? 0) >= 10 && (paceOf(r) ?? 0) >= 6).length,
      [1, 5, 20],
    ),
    achievement("simulcast", "En direct du Japon", "Titres commencés pendant leur diffusion", simulcast(watched).during.length, [5, 25, 100]),
    achievement("retro", "Archéologue", "Titres d'avant 1990 terminés", completed.filter((r) => r.year !== null && r.year < 1990).length, [1, 5, 15]),
    achievement("rewatch", "Fidèle", "Revisionnages", watched.reduce((sum, r) => sum + r.repeat, 0), [1, 5, 20]),
  ];
}
