import { z } from "zod";
import { RARITIES } from "./booster";
import { CANONICAL_STATUSES } from "./mapping";

const id = z.number().int().positive();
const services = z.array(z.enum(["mal", "anilist", "simkl"])).min(1).max(3).optional();

export const patchSchema = z
  .object({
    status: z.enum(CANONICAL_STATUSES).optional(),
    progress: z.number().int().min(0).max(100_000).optional(),
    score: z.number().int().min(0).max(10).optional(),
  })
  .refine((p) => p.status !== undefined || p.progress !== undefined || p.score !== undefined, {
    message: "Le patch est vide",
  });

const simklRefSchema = z.object({ id, kind: z.enum(["show", "movie", "anime"]) });
const idsSchema = z.object({
  key: z.string().trim().min(1).max(100).optional(),
  malId: id.optional(),
  anilistId: id.optional(),
  simkl: simklRefSchema.optional(),
});
const requireOneId = <T extends { key?: string; malId?: number; anilistId?: number; simkl?: unknown }>(v: T) =>
  v.key !== undefined || v.malId !== undefined || v.anilistId !== undefined || v.simkl !== undefined;
const ID_MESSAGE = "key, malId, anilistId ou simkl requis";

export const entryWriteSchema = idsSchema
  .extend({ patch: patchSchema, targets: services })
  .refine(requireOneId, { message: ID_MESSAGE });

export const entryDeleteSchema = idsSchema
  .extend({ targets: services })
  .refine(requireOneId, { message: ID_MESSAGE });

export const alignSchema = z
  .object({
    key: z.string().trim().min(1).max(100).optional(),
    malId: id.optional(),
    source: z.enum(["mal", "anilist", "simkl", "max"]),
  })
  .refine((v) => v.key !== undefined || v.malId !== undefined, { message: "key ou malId requis" });

export const searchKindSchema = z.enum(["anime", "show", "movie"]).default("anime");

export const searchQuerySchema = z.string().trim().min(2, "Au moins 2 caractères").max(100);

export const boosterSwipeSchema = z.object({
  anilistId: id,
  decision: z.enum(["added", "skipped"]),
  rarity: z.enum(RARITIES),
});

export const boosterUndoSchema = z.object({ anilistId: id });
