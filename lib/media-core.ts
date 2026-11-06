/**
 * Pure logic of the local show / movie tracking: episode arithmetic over TMDB seasons
 * and the state transition of an entry. Unit-tested in tests/media.test.ts.
 */
import { clampProgress, clampScore, normalizeTotal, type EntryPatch, type EntryState, type LocalKind } from "./mapping";
import type { EpisodeRef, NextAiring } from "./merge";
import { airDateToMs, type TmdbEpisodeInfo, type TmdbShowDetails } from "./tmdb-parse";

export interface SeasonCount {
  season: number;
  episodes: number;
}

/** Regular seasons only (specials, season 0, are skipped), without empty ones, sorted. */
export function regularSeasons(details: Pick<TmdbShowDetails, "seasons">): SeasonCount[] {
  return details.seasons
    .filter((s) => s.season >= 1 && s.episodes > 0)
    .map((s) => ({ season: s.season, episodes: s.episodes }))
    .sort((a, b) => a.season - b.season);
}

/** The n-th episode (1-based, broadcast order across seasons), null when out of range. */
export function episodeAt(seasons: readonly SeasonCount[], n: number): { season: number; episode: number } | null {
  if (!Number.isInteger(n) || n < 1) return null;
  let remaining = n;
  for (const s of seasons) {
    if (remaining <= s.episodes) return { season: s.season, episode: remaining };
    remaining -= s.episodes;
  }
  return null;
}

/** Absolute (1-based) index of an episode across seasons, null when it does not exist. */
export function absoluteIndex(seasons: readonly SeasonCount[], season: number, episode: number): number | null {
  if (!Number.isInteger(episode) || episode < 1) return null;
  let before = 0;
  for (const s of seasons) {
    if (s.season === season) return episode <= s.episodes ? before + episode : null;
    before += s.episodes;
  }
  return null;
}

/** Number of regular episodes already aired (absolute index of `last_episode_to_air`, 0 when unknown). */
export function airedCount(details: Pick<TmdbShowDetails, "seasons" | "lastEpisode">): number {
  const last = details.lastEpisode;
  if (!last) return 0;
  return absoluteIndex(regularSeasons(details), last.season, last.episode) ?? 0;
}

export interface ShowPointers {
  totalEpisodes: number | null;
  nextEpisode: EpisodeRef | null;
  lastEpisode: EpisodeRef | null;
  nextAiring: NextAiring | null;
}

function ref(found: { season: number; episode: number } | null): EpisodeRef | null {
  return found ? { ...found, title: null } : null;
}

function nextAiringOf(next: TmdbEpisodeInfo | null, seasons: readonly SeasonCount[], aired: number): NextAiring | null {
  if (!next || next.season < 1) return null;
  const airingAt = airDateToMs(next.airDate);
  if (airingAt === null) return null;
  return { episode: absoluteIndex(seasons, next.season, next.episode) ?? aired + 1, airingAt };
}

/**
 * Where the user is in a show. nextEpisode is null once everything aired has been watched
 * ("up to date") and lastEpisode is the episode of the current progress.
 */
export function showPointers(details: TmdbShowDetails, progress: number): ShowPointers {
  const seasons = regularSeasons(details);
  const aired = airedCount(details);
  const total = seasons.reduce((sum, s) => sum + s.episodes, 0);
  return {
    totalEpisodes: total > 0 ? total : null,
    nextEpisode: progress < aired ? ref(episodeAt(seasons, progress + 1)) : null,
    lastEpisode: ref(episodeAt(seasons, progress)),
    nextAiring: nextAiringOf(details.nextEpisode, seasons, aired),
  };
}

export interface LocalTimeline {
  /** epoch ms, null/undefined = not set yet */
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface LocalTransition {
  state: EntryState;
  /** Set only when it must be written now (first start / completion); undefined = leave as is */
  startedAt?: number;
  completedAt?: number;
}

/**
 * New state of a local entry after a patch.
 * - movies: progress is 1 when completed, 0 otherwise (patch.progress is ignored)
 * - shows: progress is clamped to the known total; completing without an explicit progress jumps to the total
 * - startedAt: first time the entry is watching / rewatching or has progress; completedAt: on entering completed
 */
export function nextLocalState(
  kind: LocalKind,
  current: (EntryState & LocalTimeline) | null,
  patch: EntryPatch,
  total: number | null,
  now: number,
): LocalTransition {
  const knownTotal = kind === "movie" ? 1 : normalizeTotal(total);
  const status = patch.status ?? current?.status ?? "plan_to_watch";
  const score = patch.score !== undefined ? clampScore(patch.score) : (current?.score ?? 0);

  let progress: number;
  if (kind === "movie") {
    progress = status === "completed" ? 1 : 0;
  } else if (patch.progress !== undefined) {
    progress = clampProgress(patch.progress, knownTotal);
  } else if (patch.status === "completed" && knownTotal !== null) {
    progress = knownTotal;
  } else {
    progress = clampProgress(current?.progress ?? 0, knownTotal);
  }

  const state: EntryState = { status, progress, score, updatedAt: now, entryId: null };
  const out: LocalTransition = { state };
  const active = status === "watching" || status === "rewatching";
  if (current?.startedAt == null && (active || progress > 0)) out.startedAt = now;
  if (status === "completed" && current?.status !== "completed") out.completedAt = now;
  return out;
}
