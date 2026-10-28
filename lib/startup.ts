import { EnvError, getEnv } from "./env";
import { runMigrations } from "./db";

/** Called once from instrumentation.ts: fail fast on bad config, then migrate. */
export function startup(): void {
  try {
    getEnv();
  } catch (error) {
    console.error(`\n[anisync] ${error instanceof EnvError ? error.message : String(error)}\n`);
    process.exit(1);
  }
  try {
    runMigrations();
    console.info("[anisync] base de données prête");
  } catch (error) {
    console.error(`[anisync] échec des migrations : ${(error as Error).message}`);
    process.exit(1);
  }
}
