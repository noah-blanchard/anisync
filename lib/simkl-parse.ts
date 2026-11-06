/**
 * Pure parsing of the Simkl library responses (no server-only import, unit-tested in tests/simkl.test.ts).
 * Parsing is tolerant: one malformed item is skipped instead of failing the whole list.
 */
import { z } from "zod";
import { fromSimklStatus, SIMKL_STATUSES, type EntryState, type MediaKind } from "./mapping";
import type { EpisodeRef, SimklListItem } from "./merge";

/** Simkl sends external ids as strings ("1") but its own id as a number. */
const looseId = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value): number | null => {
    if (value === null || value === undefined) return null;
    const n = typeof value === "number" ? value : Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  });

const mediaSchema = z.object({
  title: z.string().nullish(),
  poster: z.string().nullish(),
  year: z.number().nullish(),
  ids: z.object({ simkl: z.number(), mal: looseId, anilist: looseId }),
});

const itemSchema = z.object({
  added_to_watchlist_at: z.string().nullish(),
  last_watched_at: z.string().nullish(),
  user_rated_at: z.string().nullish(),
  user_rating: z.number().nullish(),
  status: z.enum(SIMKL_STATUSES),
  last_watched: z.string().nullish(),
  next_to_watch: z.string().nullish(),
  watched_episodes_count: z.number().nullish(),
  total_episodes_count: z.number().nullish(),
  anime_type: z.string().nullish(),
  show: mediaSchema.nullish(),
  movie: mediaSchema.nullish(),
  next_to_watch_info: z
    .object({
      title: z.string().nullish(),
      season: z.number().nullish(),
      episode: z.number().nullish(),
    })
    .nullish(),
});

const allItemsSchema = z
  .object({
    shows: z.array(z.unknown()).optional(),
    anime: z.array(z.unknown()).optional(),
    movies: z.array(z.unknown()).optional(),
  })
  .nullable();

const activitiesSchema = z.object({ all: z.string().nullish() });

/** Poster path ("18/18421459bbf0f06beb") -> cached image URL recommended by Simkl. */
export function simklPosterUrl(poster: string | null | undefined): string | null {
  if (!poster) return null;
  return `https://wsrv.nl/?url=https://simkl.in/posters/${poster}_m.webp&q=90`;
}

/** "S08E03" -> { season: 8, episode: 3 }. Anime codes without season ("E12") default to season 1. */
export function parseEpisodeCode(code: string | null | undefined): { season: number; episode: number } | null {
  if (!code) return null;
  const match = /^(?:S(\d+))?E(\d+)$/i.exec(code.trim());
  if (!match) return null;
  return { season: match[1] ? Number(match[1]) : 1, episode: Number(match[2]) };
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

type ParsedItem = z.infer<typeof itemSchema>;

function nextEpisodeOf(item: ParsedItem): EpisodeRef | null {
  const info = item.next_to_watch_info;
  const code = parseEpisodeCode(item.next_to_watch);
  if (code) return { ...code, title: info?.title ?? null };
  if (info?.episode != null) return { season: info.season ?? 1, episode: info.episode, title: info.title ?? null };
  return null;
}

function toListItem(item: ParsedItem, kind: MediaKind): SimklListItem | null {
  const media = kind === "movie" ? (item.movie ?? item.show) : (item.show ?? item.movie);
  if (!media) return null;

  const status = fromSimklStatus(item.status);
  const total = item.total_episodes_count && item.total_episodes_count > 0 ? item.total_episodes_count : null;
  // A movie has a single "episode": watched or not.
  const progress = kind === "movie" ? (status === "completed" ? 1 : 0) : Math.max(0, item.watched_episodes_count ?? 0);
  const updatedAt =
    Math.max(timestamp(item.last_watched_at), timestamp(item.user_rated_at), timestamp(item.added_to_watchlist_at)) ||
    null;
  const state: EntryState = {
    status,
    progress,
    score: item.user_rating && item.user_rating > 0 ? Math.min(10, Math.round(item.user_rating)) : 0,
    updatedAt,
    entryId: null,
  };
  const last = parseEpisodeCode(item.last_watched);

  return {
    simklId: media.ids.simkl,
    kind,
    malId: media.ids.mal,
    anilistId: media.ids.anilist,
    title: media.title ?? "",
    cover: simklPosterUrl(media.poster),
    year: media.year ?? null,
    totalEpisodes: kind === "movie" ? 1 : total,
    animeType: kind === "anime" ? (item.anime_type ?? null) : null,
    nextEpisode: nextEpisodeOf(item),
    lastEpisode: last ? { ...last, title: null } : null,
    state,
  };
}

/**
 * Parses `GET /sync/all-items?next_watch_info=yes`. Throws (ZodError) only when the top-level
 * shape is wrong; malformed individual items are skipped.
 */
export function parseSimklAllItems(json: unknown): SimklListItem[] {
  const root = allItemsSchema.parse(json) ?? {};
  const out: SimklListItem[] = [];
  const groups: [unknown[] | undefined, MediaKind][] = [
    [root.anime, "anime"],
    [root.shows, "show"],
    [root.movies, "movie"],
  ];
  for (const [rows, kind] of groups) {
    for (const row of rows ?? []) {
      const parsed = itemSchema.safeParse(row);
      if (!parsed.success) continue;
      const item = toListItem(parsed.data, kind);
      if (item) out.push(item);
    }
  }
  return out;
}

/** Parses `GET /sync/activities` and returns the top-level `all` timestamp (null when absent). */
export function parseSimklActivitiesAll(json: unknown): string | null {
  return activitiesSchema.parse(json).all ?? null;
}
