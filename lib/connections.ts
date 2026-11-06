import "server-only";
import { eq, inArray } from "drizzle-orm";
import { decrypt, encrypt } from "./crypto";
import { getDb } from "./db";
import type { ServiceName } from "./mapping";
import { connections, idMap, type ConnectionExtra, type ConnectionRow } from "./schema";

/** Public view of a connection: never contains tokens. */
export interface ConnectionInfo {
  service: ServiceName;
  userId: string;
  username: string;
  avatarUrl: string | null;
  /** epoch ms */
  expiresAt: number;
}

export interface NewConnection {
  service: ServiceName;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  extra?: ConnectionExtra;
}

export function getConnection(service: ServiceName): ConnectionRow | undefined {
  return getDb().select().from(connections).where(eq(connections.service, service)).get();
}

export function toInfo(row: ConnectionRow): ConnectionInfo {
  return {
    service: row.service,
    userId: row.userId,
    username: row.username,
    avatarUrl: row.avatarUrl,
    expiresAt: row.expiresAt,
  };
}

export function getConnectionInfos(): Record<ServiceName, ConnectionInfo | null> {
  const rows = getDb().select().from(connections).all();
  const find = (s: ServiceName) => {
    const row = rows.find((r) => r.service === s);
    return row ? toInfo(row) : null;
  };
  return { mal: find("mal"), anilist: find("anilist") };
}

export function saveConnection(input: NewConnection): void {
  const values = {
    service: input.service,
    accessToken: encrypt(input.accessToken),
    refreshToken: input.refreshToken ? encrypt(input.refreshToken) : null,
    expiresAt: input.expiresAt,
    userId: input.userId,
    username: input.username,
    avatarUrl: input.avatarUrl,
    extra: input.extra ?? {},
  };
  getDb()
    .insert(connections)
    .values(values)
    .onConflictDoUpdate({ target: connections.service, set: values })
    .run();
}

export function updateTokens(
  service: ServiceName,
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: number },
): void {
  getDb()
    .update(connections)
    .set({
      accessToken: encrypt(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      expiresAt: tokens.expiresAt,
    })
    .where(eq(connections.service, service))
    .run();
}

export function updateExtra(service: ServiceName, extra: ConnectionExtra): void {
  getDb().update(connections).set({ extra }).where(eq(connections.service, service)).run();
}

export function deleteConnection(service: ServiceName): void {
  getDb().delete(connections).where(eq(connections.service, service)).run();
}

export function readAccessToken(row: ConnectionRow): string {
  return decrypt(row.accessToken);
}

export function readRefreshToken(row: ConnectionRow): string | null {
  return row.refreshToken ? decrypt(row.refreshToken) : null;
}

// ---------------------------------------------------------------------------
// id_map
// ---------------------------------------------------------------------------

/** Misses are retried after a week (AniList adds idMal links over time). */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function loadIdMap(): Map<number, number | null> {
  const now = Date.now();
  const map = new Map<number, number | null>();
  for (const row of getDb().select().from(idMap).all()) {
    if (row.anilistId === null && now - row.resolvedAt > MISS_TTL_MS) continue;
    map.set(row.malId, row.anilistId);
  }
  return map;
}

export function getMappedAniListId(malId: number): number | null | undefined {
  const row = getDb().select().from(idMap).where(eq(idMap.malId, malId)).get();
  if (!row) return undefined;
  if (row.anilistId === null && Date.now() - row.resolvedAt > MISS_TTL_MS) return undefined;
  return row.anilistId;
}

export function getMappedMalId(anilistId: number): number | undefined {
  return getDb().select().from(idMap).where(eq(idMap.anilistId, anilistId)).get()?.malId;
}

/** Upserts pairs (anilistId null = confirmed miss). Keeps anilist_id unique. */
export function saveIdMappings(input: ReadonlyArray<{ malId: number; anilistId: number | null }>): void {
  // One row per malId and per anilistId (the last occurrence wins).
  const byMal = new Map<number, number | null>();
  const byAniList = new Map<number, number>();
  for (const { malId, anilistId } of input) {
    if (anilistId !== null) {
      const previous = byAniList.get(anilistId);
      if (previous !== undefined) byMal.delete(previous);
      byAniList.set(anilistId, malId);
    }
    byMal.set(malId, anilistId);
  }
  const pairs = [...byMal].map(([malId, anilistId]) => ({ malId, anilistId }));
  if (pairs.length === 0) return;
  const db = getDb();
  const now = Date.now();
  db.transaction((tx) => {
    const anilistIds = pairs.map((p) => p.anilistId).filter((id): id is number => id !== null);
    const existing =
      anilistIds.length > 0 ? tx.select().from(idMap).where(inArray(idMap.anilistId, anilistIds)).all() : [];
    for (const pair of pairs) {
      const conflict = existing.find((row) => row.anilistId === pair.anilistId && row.malId !== pair.malId);
      if (conflict) tx.delete(idMap).where(eq(idMap.malId, conflict.malId)).run();
      tx.insert(idMap)
        .values({ malId: pair.malId, anilistId: pair.anilistId, resolvedAt: now })
        .onConflictDoUpdate({ target: idMap.malId, set: { anilistId: pair.anilistId, resolvedAt: now } })
        .run();
    }
  });
}
