/**
 * Booster packs: card shape, rarity rules and the pack draw.
 * Pure functions (no I/O), unit-tested in tests/booster.test.ts.
 */

export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "Commune",
  rare: "Rare",
  epic: "Épique",
  legendary: "Pépite",
};

export const PACK_SIZE = 5;

export interface BoosterCard {
  anilistId: number;
  malId: number;
  title: string;
  englishTitle: string | null;
  cover: string;
  color: string | null;
  year: number | null;
  format: string | null;
  episodes: number | null;
  genres: string[];
  /** AniList averageScore, 0-100 */
  score: number | null;
  popularity: number;
  synopsis: string | null;
  rarity: Rarity;
}

/** A pool candidate: a card before its rarity is known, plus the fields used to filter it. */
export type PoolItem = Omit<BoosterCard, "rarity"> & { isAdult: boolean };

export interface DrawContext {
  /** AniList and MAL ids to leave out (already in the list, recently ignored or shown) */
  excludeAniList: ReadonlySet<number>;
  excludeMal: ReadonlySet<number>;
  /** Allow +18 and ecchi titles */
  adult: boolean;
  size?: number;
}

const GEM_MIN_SCORE = 78;
const GEM_MAX_POPULARITY = 40_000;
const EPIC_MIN_SCORE = 82;
const RARE_MIN_SCORE = 75;

/** "Pépite" (hidden gem) = well rated but little known; otherwise the score decides. */
export function rarityOf(item: { score: number | null; popularity: number }): Rarity {
  const score = item.score ?? 0;
  if (score >= GEM_MIN_SCORE && item.popularity < GEM_MAX_POPULARITY) return "legendary";
  if (score >= EPIC_MIN_SCORE) return "epic";
  if (score >= RARE_MIN_SCORE) return "rare";
  return "common";
}

export function isAdultContent(item: Pick<PoolItem, "isAdult" | "genres">): boolean {
  return item.isAdult || item.genres.some((g) => g === "Ecchi" || g === "Hentai");
}

type Rng = () => number;

/** Slots 1-3 common, slot 4 rare (sometimes better), slot 5 is the "hit": the best card always comes last. */
export function rollSlots(rng: Rng, size = PACK_SIZE): Rarity[] {
  const slots: Rarity[] = [];
  for (let i = 0; i < size - 2; i++) slots.push("common");
  if (size >= 2) slots.push(rng() < 0.15 ? "epic" : "rare");
  const hit = rng();
  slots.push(hit < 0.07 ? "legendary" : hit < 0.35 ? "epic" : "rare");
  return slots.slice(0, size);
}

/** When a tier is empty, look at the closest tiers first, lower ones before higher ones. */
function fallbackOrder(rarity: Rarity): Rarity[] {
  const index = RARITIES.indexOf(rarity);
  return [...RARITIES].sort((a, b) => {
    const da = Math.abs(RARITIES.indexOf(a) - index);
    const db = Math.abs(RARITIES.indexOf(b) - index);
    return da - db || RARITIES.indexOf(a) - RARITIES.indexOf(b);
  });
}

/** Draws a pack from the pool, without duplicates, ordered from the most common to the rarest. */
export function drawPack(pool: readonly PoolItem[], ctx: DrawContext, rng: Rng = Math.random): BoosterCard[] {
  const tiers = new Map<Rarity, BoosterCard[]>(RARITIES.map((r) => [r, []]));
  for (const item of pool) {
    if (ctx.excludeAniList.has(item.anilistId) || ctx.excludeMal.has(item.malId)) continue;
    if (!ctx.adult && isAdultContent(item)) continue;
    const { isAdult: _, ...card } = item;
    const rarity = rarityOf(item);
    tiers.get(rarity)!.push({ ...card, rarity });
  }

  const taken = new Set<number>();
  const cards: BoosterCard[] = [];
  for (const slot of rollSlots(rng, ctx.size ?? PACK_SIZE)) {
    for (const rarity of fallbackOrder(slot)) {
      const candidates = tiers.get(rarity)!.filter((c) => !taken.has(c.anilistId));
      if (candidates.length === 0) continue;
      const card = candidates[Math.floor(rng() * candidates.length)]!;
      taken.add(card.anilistId);
      cards.push(card);
      break;
    }
  }
  return cards.sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity));
}

/** AniList descriptions are light HTML with source notes: keep plain text paragraphs. */
export function cleanSynopsis(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\(Source:[^)]*\)\s*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 0 ? text : null;
}

/** "8,4" from an AniList 0-100 score */
export function scoreOutOfTen(score: number | null): string | null {
  if (score === null || score <= 0) return null;
  return (score / 10).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
