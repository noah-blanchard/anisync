import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export type ConnectionRow = typeof connections.$inferSelect;
export type IdMapRow = typeof idMap.$inferSelect;
