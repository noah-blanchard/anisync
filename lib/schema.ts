import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CANONICAL_STATUSES } from "./mapping";

export interface ConnectionExtra {
  /** AniList mediaListOptions.scoreFormat */
  scoreFormat?: string;
}

export const connections = sqliteTable("connections", {
  service: text("service", { enum: ["mal", "anilist"] }).primaryKey(),
  /** AES-256-GCM encrypted */
  accessToken: text("access_token").notNull(),
  /** AES-256-GCM encrypted, AniList has none */
  refreshToken: text("refresh_token"),
  /** epoch milliseconds */
  expiresAt: integer("expires_at").notNull(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url"),
  extra: text("extra", { mode: "json" }).$type<ConnectionExtra>().notNull().default({}),
});

export const idMap = sqliteTable("id_map", {
  malId: integer("mal_id").primaryKey(),
  /** null = looked up, AniList has no media with this idMal */
  anilistId: integer("anilist_id").unique(),
  /** epoch milliseconds of the lookup, used to retry misses later */
  resolvedAt: integer("resolved_at").notNull(),
});

/** One row per booster card swiped: feeds pack exclusions now and recommendations later. */
export const boosterSwipes = sqliteTable("booster_swipes", {
  anilistId: integer("anilist_id").primaryKey(),
  decision: text("decision", { enum: ["added", "skipped"] }).notNull(),
  rarity: text("rarity", { enum: ["common", "rare", "epic", "legendary"] }).notNull(),
  /** epoch milliseconds */
  swipedAt: integer("swiped_at").notNull(),
});

/** Stats bronze: raw AniList metadata of the anime in my list, refreshed weekly. */
export const statsMedia = sqliteTable("stats_media", {
  anilistId: integer("anilist_id").primaryKey(),
  /** Raw AniList media; null = AniList returned nothing for this id */
  payload: text("payload", { mode: "json" }).$type<unknown>(),
  /** epoch milliseconds */
  fetchedAt: integer("fetched_at").notNull(),
});

/** Stats bronze: raw list of each service, at most one snapshot a day (the history of the list). */
export const listSnapshots = sqliteTable(
  "list_snapshots",
  {
    service: text("service", { enum: ["mal", "anilist"] }).notNull(),
    /** YYYY-MM-DD (UTC) */
    day: text("day").notNull(),
    /** epoch milliseconds */
    fetchedAt: integer("fetched_at").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.service, t.day] })],
);

/** Stats bronze: other AniList users' public lists, one snapshot a day (the friends dataset). */
export const userSnapshots = sqliteTable(
  "user_snapshots",
  {
    /** AniList user id */
    userId: integer("user_id").notNull(),
    userName: text("user_name").notNull(),
    /** YYYY-MM-DD (UTC) */
    day: text("day").notNull(),
    /** epoch milliseconds */
    fetchedAt: integer("fetched_at").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/** Shows and movies tracked in AniSync (the source of truth; TMDB is only the catalogue). */
export const mediaEntries = sqliteTable(
  "media_entries",
  {
    kind: text("kind", { enum: ["show", "movie"] }).notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    /** Copied from TMDB when the entry is added, so the list works without TMDB */
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    posterPath: text("poster_path"),
    year: integer("year"),
    status: text("status", { enum: CANONICAL_STATUSES }).notNull(),
    progress: integer("progress").notNull().default(0),
    score: integer("score").notNull().default(0),
    /** epoch milliseconds */
    addedAt: integer("added_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
  },
  (t) => [primaryKey({ columns: [t.kind, t.tmdbId] })],
);

/** Bronze: raw TMDB details of the shows and movies I track, refreshed by TTL. */
export const tmdbMedia = sqliteTable(
  "tmdb_media",
  {
    kind: text("kind", { enum: ["show", "movie"] }).notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    /** Raw TMDB response; null = TMDB returned 404 for this id */
    payload: text("payload", { mode: "json" }).$type<unknown>(),
    /** epoch milliseconds */
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.tmdbId] })],
);

export type ConnectionRow = typeof connections.$inferSelect;
export type IdMapRow = typeof idMap.$inferSelect;
