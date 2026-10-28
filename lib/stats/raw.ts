/**
 * Bronze shapes: the raw MAL and AniList payloads the stats are built from, stored as received.
 * Pure (no I/O) so the silver layer can re-validate what it reads back from SQLite.
 */
import { z } from "zod";

const fuzzyDateSchema = z
  .object({ year: z.number().nullish(), month: z.number().nullish(), day: z.number().nullish() })
  .nullish();

/** One AniList media, with every field the stats use. */
export const rawMediaSchema = z.object({
  id: z.number(),
  idMal: z.number().nullish(),
  format: z.string().nullish(),
  status: z.string().nullish(),
  episodes: z.number().nullish(),
  /** Minutes per episode */
  duration: z.number().nullish(),
  season: z.string().nullish(),
  seasonYear: z.number().nullish(),
  startDate: fuzzyDateSchema,
  source: z.string().nullish(),
  countryOfOrigin: z.string().nullish(),
  isAdult: z.boolean().nullish(),
  genres: z.array(z.string().nullish()).nullish(),
  tags: z
    .array(
      z
        .object({
          name: z.string(),
          rank: z.number().nullish(),
          category: z.string().nullish(),
          isMediaSpoiler: z.boolean().nullish(),
          isGeneralSpoiler: z.boolean().nullish(),
        })
        .nullish(),
    )
    .nullish(),
  studios: z.object({ nodes: z.array(z.object({ name: z.string() }).nullish()).nullish() }).nullish(),
  /** 0-100 */
  averageScore: z.number().nullish(),
  /** 0-100 */
  meanScore: z.number().nullish(),
  popularity: z.number().nullish(),
  relations: z.object({ edges: z.array(z.object({ relationType: z.string().nullish() }).nullish()).nullish() }).nullish(),
});
export type RawMedia = z.infer<typeof rawMediaSchema>;

/** One entry of my AniList list, as MediaListCollection returns it. */
export const rawAniListEntrySchema = z.object({
  mediaId: z.number(),
  status: z.string().nullish(),
  /** 0-100 */
  score: z.number().nullish(),
  progress: z.number().nullish(),
  repeat: z.number().nullish(),
  startedAt: fuzzyDateSchema,
  completedAt: fuzzyDateSchema,
  /** epoch seconds */
  createdAt: z.number().nullish(),
  /** epoch seconds */
  updatedAt: z.number().nullish(),
});
export type RawAniListEntry = z.infer<typeof rawAniListEntrySchema>;

/** One entry of my MAL list (`fields=list_status`). Dates are "YYYY-MM-DD", "YYYY-MM" or "YYYY". */
export const rawMalEntrySchema = z.object({
  node: z.object({ id: z.number().int() }),
  list_status: z.object({
    status: z.string().nullish(),
    score: z.number().nullish(),
    num_episodes_watched: z.number().nullish(),
    is_rewatching: z.boolean().nullish(),
    num_times_rewatched: z.number().nullish(),
    start_date: z.string().nullish(),
    finish_date: z.string().nullish(),
    updated_at: z.string().nullish(),
  }),
});
export type RawMalEntry = z.infer<typeof rawMalEntrySchema>;
