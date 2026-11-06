import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

const folder = path.resolve(__dirname, "../drizzle");

describe("migrations", () => {
  it("apply on an empty database and create the local tracking tables", () => {
    const sqlite = new Database(":memory:");
    migrate(drizzle(sqlite), { migrationsFolder: folder });
    const tables = sqlite.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["media_entries", "tmdb_media", "connections"]));
  });
});
