import { z } from "zod";
import { RARITIES } from "./booster";
import { CANONICAL_STATUSES } from "./mapping";

const id = z.number().int().positive();
const services = z.array(z.enum(["mal", "anilist"])).min(1).max(2).optional();

export const patchSchema = z
  .object({
    status: z.enum(CANONICAL_STATUSES).optional(),
    progress: z.number().int().min(0).max(100_000).optional(),
    score: z.number().int().min(0).max(10).optional(),
  })
  .refine((p) => p.status !== undefined || p.progress !== undefined || p.score !== undefined, {
    message: "Le patch est vide",
  });

const idsSchema = z.object({ malId: id.optional(), anilistId: id.optional() });
const requireOneId = <T extends { malId?: number; anilistId?: number }>(v: T) =>
  v.malId !== undefined || v.anilistId !== undefined;

export const entryWriteSchema = idsSchema
  .extend({ patch: patchSchema, targets: services })
  .refine(requireOneId, { message: "malId ou anilistId requis" });

export const entryDeleteSchema = idsSchema
  .extend({ targets: services })
  .refine(requireOneId, { message: "malId ou anilistId requis" });

export const alignSchema = z.object({ malId: id, source: z.enum(["mal", "anilist", "max"]) });

export const searchQuerySchema = z.string().trim().min(2, "Au moins 2 caractères").max(100);

export const boosterSwipeSchema = z.object({
  anilistId: id,
  decision: z.enum(["added", "skipped"]),
  rarity: z.enum(RARITIES),
});

export const boosterUndoSchema = z.object({ anilistId: id });
