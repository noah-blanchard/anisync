import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getEnv } from "./env";
import * as schema from "./schema";

type Db = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __anisyncDb?: Db };

function open(): Db {
  const file = path.resolve(getEnv().DATABASE_PATH);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new Error(`Le dossier ${dir} n'est pas accessible en écriture (vérifie le volume monté sur /data)`);
  }
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

export function getDb(): Db {
  globalForDb.__anisyncDb ??= open();
  return globalForDb.__anisyncDb;
}

export function runMigrations(): void {
  migrate(getDb(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
}
