import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const required = (name: string) => z.string({ error: `${name} est requis` }).trim().min(1, `${name} est requis`);

const envSchema = z.object({
  APP_URL: z
    .url({ error: "APP_URL doit être une URL complète, ex. https://anisync.example.com" })
    .transform((v) => v.replace(/\/+$/, "")),
  APP_PASSWORD: required("APP_PASSWORD"),
  APP_SECRET: z
    .string({ error: "APP_SECRET est requis" })
    .min(32, "APP_SECRET doit contenir au moins 32 caractères (openssl rand -base64 48)"),
  MAL_CLIENT_ID: required("MAL_CLIENT_ID"),
  MAL_CLIENT_SECRET: optional,
  ANILIST_CLIENT_ID: required("ANILIST_CLIENT_ID"),
  ANILIST_CLIENT_SECRET: required("ANILIST_CLIENT_SECRET"),
  DATABASE_PATH: z.string().trim().min(1).default("./data/anisync.db"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export class EnvError extends Error {
  override name = "EnvError";
}

/** Parses process.env once. Throws an EnvError listing every invalid variable. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`);
    throw new EnvError(`Configuration invalide, variables d'environnement à corriger :\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

export function redirectUris(env: Env = getEnv()) {
  return {
    mal: `${env.APP_URL}/api/auth/mal/callback`,
    anilist: `${env.APP_URL}/api/auth/anilist/callback`,
  };
}

export function isSecureUrl(env: Env = getEnv()): boolean {
  return env.APP_URL.startsWith("https://");
}
