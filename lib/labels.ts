import type { CanonicalStatus, ServiceName } from "./mapping";
import type { NextAiring } from "./merge";

export const STATUS_LABELS: Record<CanonicalStatus, string> = {
  watching: "En cours",
  rewatching: "Revisionnage",
  completed: "Terminé",
  on_hold: "En pause",
  dropped: "Abandonné",
  plan_to_watch: "À voir",
};

export const STATUS_ORDER: CanonicalStatus[] = [
  "watching",
  "rewatching",
  "plan_to_watch",
  "on_hold",
  "completed",
  "dropped",
];

export const SERVICE_LABELS: Record<ServiceName, string> = { mal: "MAL", anilist: "AniList" };

const FORMAT_LABELS: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TV court",
  MOVIE: "Film",
  SPECIAL: "Spécial",
  TV_SPECIAL: "Spécial",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Clip",
  CM: "Pub",
  PV: "PV",
};

export function formatLabel(format: string | null | undefined): string | null {
  if (!format) return null;
  return FORMAT_LABELS[format.toUpperCase()] ?? format.toUpperCase();
}

export function episodesLabel(total: number | null): string {
  if (total === null) return "? ép.";
  return `${total} ép.`;
}

/** "dans 45 min", "dans 5 h", "dans 2 j" */
export function relativeFuture(timestamp: number, now = Date.now()): string {
  const diff = timestamp - now;
  if (diff <= 0) return "maintenant";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `dans ${Math.max(1, minutes)} min`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `dans ${hours} h`;
  return `dans ${Math.round(diff / 86_400_000)} j`;
}

export function nextAiringLabel(next: NextAiring | null, now = Date.now()): string | null {
  if (!next) return null;
  return `Ép. ${next.episode} ${relativeFuture(next.airingAt, now)}`;
}

export function scoreLabel(score: number): string {
  return score > 0 ? `${score}/10` : "Pas de note";
}

export function daysUntil(timestamp: number, now = Date.now()): number {
  return Math.ceil((timestamp - now) / 86_400_000);
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(timestamp);
}
