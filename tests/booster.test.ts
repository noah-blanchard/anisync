import { describe, expect, it } from "vitest";
import {
  cleanSynopsis,
  drawPack,
  isAdultContent,
  poolRarities,
  rarityOf,
  rollSlots,
  scoreOutOfTen,
  sequelAllowed,
  type DrawContext,
  type PoolItem,
} from "@/lib/booster";
import { availableBoosters, BOOSTERS, boosterQuery, boosterVariables, getBooster, seasonOf } from "@/lib/boosters";

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
    followUps: [],
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
      expect(pack[0]).not.toHaveProperty("followUps");
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

describe("relative rarity", () => {
  it("ranks against the pack's own pool", () => {
    // 40 titles scored 60..99, the least known ones being the best rated.
    const pool = Array.from({ length: 40 }, (_, i) => item(i + 1, 60 + i, 100_000 - i * 2_000));
    const rarities = poolRarities(pool);
    const count = (r: string) => [...rarities.values()].filter((x) => x === r).length;
    expect(count("legendary") + count("epic")).toBeGreaterThanOrEqual(4);
    expect(count("common")).toBeGreaterThan(count("rare"));
    expect(rarities.get(1)).toBe("common");
    expect(rarities.get(40)).toBe("legendary");
  });

  it("keeps unscored titles common and small pools on absolute thresholds", () => {
    const fresh = Array.from({ length: 40 }, (_, i) => item(i + 1, i < 20 ? 0 : 70 + i, 50_000));
    const rarities = poolRarities(fresh.map((f, i) => (i < 20 ? { ...f, score: null } : f)));
    for (let id = 1; id <= 20; id++) expect(rarities.get(id)).toBe("common");
    expect(poolRarities([item(1, 90, 300_000)]).get(1)).toBe(rarityOf({ score: 90, popularity: 300_000 }));
  });
});

describe("sequels", () => {
  const sequel = { followUps: [7] };
  it("follows the booster rule", () => {
    expect(sequelAllowed({ followUps: [] }, {})).toBe(true);
    expect(sequelAllowed(sequel, {})).toBe(false);
    expect(sequelAllowed(sequel, { sequels: "allow" })).toBe(true);
    expect(sequelAllowed(sequel, { sequels: "if-prequel-in-list", seen: new Set([3]) })).toBe(false);
    expect(sequelAllowed(sequel, { sequels: "if-prequel-in-list", seen: new Set([7]) })).toBe(true);
  });

  it("drops sequels from packs by default", () => {
    const pool = [...POOL.slice(0, 5), item(999, 90, 1_000, { followUps: [1] })];
    for (let seed = 0; seed < 10; seed++) {
      expect(drawPack(pool, NONE, seeded(seed)).some((c) => c.anilistId === 999)).toBe(false);
    }
  });
});

describe("catalogue", () => {
  it("has 8 boosters with unique ids, 2 of them adult", () => {
    expect(BOOSTERS).toHaveLength(8);
    expect(new Set(BOOSTERS.map((b) => b.id)).size).toBe(8);
    expect(availableBoosters(false).map((b) => b.id)).not.toContain("hentai");
    expect(availableBoosters(true)).toHaveLength(8);
    expect(availableBoosters(false)).toHaveLength(6);
  });

  it("keeps fan service out of the other packs", () => {
    const isekai = getBooster("isekai")!;
    const vars = boosterVariables(isekai.filters[0]!, 1, isekai);
    expect(vars.adult).toBe(false);
    expect(vars.noGenres).toContain("Ecchi");
    const ecchi = getBooster("ecchi")!;
    expect(boosterVariables(ecchi.filters[0]!, 1, ecchi)).not.toHaveProperty("noGenres");
    expect(boosterVariables(getBooster("hentai")!.filters[0]!, 1, getBooster("hentai")!).adult).toBe(true);
  });

  it("maps filters to AniList variables", () => {
    const retro = getBooster("retro")!;
    const vars = boosterVariables(retro.filters[0]!, 3, retro);
    expect(vars).toMatchObject({ page: 3, before: 20050000, sort: ["SCORE_DESC"], score: 70 });
    expect(vars).not.toHaveProperty("after");
    const season = getBooster("saison")!;
    const now = new Date("2026-10-28T12:00:00Z");
    expect(boosterVariables(season.filters[0]!, 1, season, now)).toMatchObject({
      season: "FALL",
      seasonYear: 2026,
      status: ["RELEASING"],
    });
    expect(seasonOf(new Date("2027-01-05T00:00:00Z"))).toEqual({ season: "WINTER", year: 2027 });
    expect(boosterVariables({ years: [2010, 2012], episodes: [1, 13] }, 1, {})).toMatchObject({
      after: 20099999,
      before: 20130000,
      epMin: 0,
      epMax: 14,
    });
  });
});

describe("AniList query", () => {
  // AniList answers "Illegal operator and value combination" to a null comparison filter.
  it("never sends a null filter, for every booster", () => {
    for (const booster of BOOSTERS) {
      for (const filter of booster.filters) {
        const vars = boosterVariables(filter, 1, booster);
        for (const [key, value] of Object.entries(vars)) {
          expect(value, `${booster.id}.${key}`).not.toBeNull();
          expect(value, `${booster.id}.${key}`).not.toBeUndefined();
        }
      }
    }
  });

  it("declares exactly the variables it sends", () => {
    for (const booster of BOOSTERS) {
      const vars = boosterVariables(booster.filters[0]!, 2, booster);
      const query = boosterQuery(vars, "id");
      const declared = [...query.matchAll(/\$(\w+):/g)].map((m) => m[1]).sort();
      expect(declared, booster.id).toEqual(Object.keys(vars).sort());
      expect(query).not.toMatch(/\$\w+\s*\)\s*\{\s*$/m);
    }
    const decouverte = getBooster("decouverte")!;
    const query = boosterQuery(boosterVariables(decouverte.filters[0]!, 1, decouverte), "id");
    expect(query).toContain("media(type: ANIME, sort: $sort, isAdult: $adult, averageScore_greater: $score,");
    expect(query).not.toContain("episodes_greater");
    expect(query).not.toContain("popularity_greater");
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
