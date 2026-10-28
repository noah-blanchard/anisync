import { describe, expect, it } from "vitest";
import {
  cleanSynopsis,
  drawPack,
  isAdultContent,
  rarityOf,
  rollSlots,
  scoreOutOfTen,
  type DrawContext,
  type PoolItem,
} from "@/lib/booster";

/** Deterministic rng (mulberry32) so draws are reproducible. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function item(id: number, score: number, popularity: number, extra: Partial<PoolItem> = {}): PoolItem {
  return {
    anilistId: id,
    malId: id + 10_000,
    title: `Anime ${id}`,
    englishTitle: null,
    cover: `https://img/${id}.jpg`,
    color: null,
    year: 2020,
    format: "TV",
    episodes: 12,
    genres: ["Action"],
    score,
    popularity,
    synopsis: null,
    isAdult: false,
    ...extra,
  };
}

const NONE: DrawContext = { excludeAniList: new Set(), excludeMal: new Set(), adult: false };

/** 20 commons, 10 rares, 6 epics, 4 gems */
const POOL: PoolItem[] = [
  ...Array.from({ length: 20 }, (_, i) => item(i + 1, 68, 200_000)),
  ...Array.from({ length: 10 }, (_, i) => item(i + 100, 78, 150_000)),
  ...Array.from({ length: 6 }, (_, i) => item(i + 200, 86, 300_000)),
  ...Array.from({ length: 4 }, (_, i) => item(i + 300, 83, 12_000)),
];

describe("rarity", () => {
  it("ranks by score, with hidden gems on top", () => {
    expect(rarityOf({ score: 70, popularity: 500_000 })).toBe("common");
    expect(rarityOf({ score: 76, popularity: 500_000 })).toBe("rare");
    expect(rarityOf({ score: 88, popularity: 500_000 })).toBe("epic");
    expect(rarityOf({ score: 79, popularity: 20_000 })).toBe("legendary");
    expect(rarityOf({ score: 76, popularity: 20_000 })).toBe("rare");
    expect(rarityOf({ score: null, popularity: 0 })).toBe("common");
  });

  it("puts the hit in the last slot", () => {
    for (let seed = 0; seed < 50; seed++) {
      const slots = rollSlots(seeded(seed));
      expect(slots).toHaveLength(5);
      expect(slots.slice(0, 3)).toEqual(["common", "common", "common"]);
      expect(slots[4]).not.toBe("common");
    }
  });
});

describe("drawPack", () => {
  it("draws 5 distinct cards, rarest last", () => {
    for (let seed = 0; seed < 50; seed++) {
      const pack = drawPack(POOL, NONE, seeded(seed));
      expect(pack).toHaveLength(5);
      expect(new Set(pack.map((c) => c.anilistId)).size).toBe(5);
      const order = ["common", "rare", "epic", "legendary"];
      const ranks = pack.map((c) => order.indexOf(c.rarity));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(pack[0]).not.toHaveProperty("isAdult");
    }
  });

  it("skips excluded ids on either service", () => {
    const excludeAniList = new Set(POOL.filter((p) => p.anilistId % 2 === 0).map((p) => p.anilistId));
    const excludeMal = new Set([1 + 10_000, 3 + 10_000]);
    for (let seed = 0; seed < 20; seed++) {
      const pack = drawPack(POOL, { ...NONE, excludeAniList, excludeMal }, seeded(seed));
      for (const card of pack) {
        expect(excludeAniList.has(card.anilistId)).toBe(false);
        expect(excludeMal.has(card.malId)).toBe(false);
      }
    }
  });

  it("falls back to the closest tier when one is empty", () => {
    const commonsOnly = POOL.filter((p) => p.score === 68);
    expect(drawPack(commonsOnly, NONE, seeded(1))).toHaveLength(5);
    expect(drawPack(commonsOnly.slice(0, 2), NONE, seeded(1))).toHaveLength(2);
    expect(drawPack([], NONE, seeded(1))).toEqual([]);
  });

  it("leaves adult and ecchi titles out unless allowed", () => {
    const pool = [
      ...Array.from({ length: 5 }, (_, i) => item(i + 1, 70, 100_000, { genres: ["Ecchi"] })),
      ...Array.from({ length: 5 }, (_, i) => item(i + 10, 70, 100_000, { isAdult: true, genres: ["Hentai"] })),
    ];
    expect(drawPack(pool, NONE, seeded(2))).toEqual([]);
    expect(drawPack(pool, { ...NONE, adult: true }, seeded(2))).toHaveLength(5);
    expect(isAdultContent({ isAdult: false, genres: ["Comedy", "Ecchi"] })).toBe(true);
    expect(isAdultContent({ isAdult: false, genres: ["Comedy"] })).toBe(false);
  });
});

describe("formatting", () => {
  it("cleans AniList descriptions", () => {
    expect(cleanSynopsis("Line<br><br>\n<i>Two</i> &amp; &quot;three&quot;\n\n(Source: Crunchyroll)")).toBe(
      'Line\n\nTwo & "three"',
    );
    expect(cleanSynopsis("")).toBeNull();
    expect(cleanSynopsis(null)).toBeNull();
  });

  it("formats scores the French way", () => {
    expect(scoreOutOfTen(84)).toBe("8,4");
    expect(scoreOutOfTen(90)).toBe("9,0");
    expect(scoreOutOfTen(null)).toBeNull();
  });
});
