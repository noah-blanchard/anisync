/**
 * The booster catalogue. Adding a booster = adding an entry here: the AniList pool, the pack art,
 * the /booster carousel and the /booster/[id] page all derive from it.
 */

export type MediaFormat = "TV" | "TV_SHORT" | "MOVIE" | "SPECIAL" | "OVA" | "ONA";
export type MediaSort = "POPULARITY_DESC" | "SCORE_DESC" | "TRENDING_DESC" | "START_DATE_DESC";

/** One AniList query band. Unset fields do not filter. */
export interface BoosterFilter {
  /** Any of these genres (AniList genre names) */
  genres?: string[];
  excludeGenres?: string[];
  /** Any of these tags (AniList tag names) */
  tags?: string[];
  excludeTags?: string[];
  /** Default: TV, TV_SHORT, MOVIE, ONA */
  formats?: MediaFormat[];
  /** Start year range, inclusive; null = open */
  years?: [number | null, number | null];
  /** Only titles that started this season */
  season?: "current";
  /** Default: finished and airing */
  status?: ("FINISHED" | "RELEASING")[];
  /** AniList averageScore (0-100), strictly above */
  minScore?: number;
  /** AniList members range; null = open */
  popularity?: [number | null, number | null];
  /** Country of origin: JP, CN, KR, TW */
  country?: string;
  /** AniList source: MANGA, LIGHT_NOVEL, ORIGINAL, VIDEO_GAME… */
  source?: string[];
  /** Episode count range; null = open */
  episodes?: [number | null, number | null];
  /** Default: POPULARITY_DESC */
  sort?: MediaSort;
  /** Pages of 50 titles in the pool (default 10); stops early when AniList runs out */
  pages?: number;
}

/** What to do with sequels and spin-offs (titles with a prequel or a parent). */
export type SequelRule = "exclude" | "if-prequel-in-list" | "allow";

export type BoosterEmblem =
  | "compass"
  | "calendar"
  | "cassette"
  | "clapperboard"
  | "wand"
  | "ghost"
  | "flame"
  | "adult";

export interface BoosterDefinition {
  id: string;
  /** Shown on the pack and in the carousel */
  name: string;
  tagline: string;
  /** Only listed when "Contenu adulte" is on; the only packs that may contain ecchi or +18 titles */
  adult?: boolean;
  look: {
    /** Foil gradient, dark to light to dark */
    foil: [string, string, string];
    emblem: BoosterEmblem;
  };
  /** One or several bands merged into the pool (e.g. popular titles + hidden gems) */
  filters: BoosterFilter[];
  /** Default: exclude */
  sequels?: SequelRule;
  /** Pool items with AniList isAdult: only in packs meant for it */
  isAdult?: boolean;
}

export const BOOSTERS: BoosterDefinition[] = [
  {
    id: "decouverte",
    name: "Découverte",
    tagline: "Des incontournables et des pépites, un peu de tout",
    look: { foil: ["#251a60", "#5b2d9a", "#1f6fbf"], emblem: "compass" },
    filters: [
      { minScore: 64, pages: 20 },
      { minScore: 77, popularity: [2_500, 40_000], sort: "SCORE_DESC", pages: 8 },
    ],
  },
  {
    id: "saison",
    name: "Saison en cours",
    tagline: "Ce qui sort en ce moment",
    look: { foil: ["#3b0d2e", "#d9466f", "#f59e0b"], emblem: "calendar" },
    filters: [{ season: "current", status: ["RELEASING"], sort: "TRENDING_DESC", pages: 4 }],
    sequels: "if-prequel-in-list",
  },
  {
    id: "retro",
    name: "Rétro",
    tagline: "Les classiques d'avant 2005",
    look: { foil: ["#3a2410", "#c2742f", "#2f6f6a"], emblem: "cassette" },
    filters: [
      { years: [null, 2004], minScore: 70, formats: ["TV", "TV_SHORT", "MOVIE", "OVA"], sort: "SCORE_DESC" },
    ],
  },
  {
    id: "cinema",
    name: "Cinéma",
    tagline: "Un film pour ce soir",
    look: { foil: ["#1a1a1a", "#b91c1c", "#d4a017"], emblem: "clapperboard" },
    filters: [{ formats: ["MOVIE"], minScore: 65 }],
  },
  {
    id: "isekai",
    name: "Isekai",
    tagline: "Un aller simple pour un autre monde",
    look: { foil: ["#0b3b3c", "#16a085", "#7c3aed"], emblem: "wand" },
    filters: [{ tags: ["Isekai"], minScore: 60, pages: 6 }],
  },
  {
    id: "frissons",
    name: "Frissons",
    tagline: "Horreur, mystère et thrillers psychologiques",
    look: { foil: ["#0a0f0d", "#14532d", "#6b7280"], emblem: "ghost" },
    filters: [{ genres: ["Horror", "Mystery", "Psychological", "Thriller"], minScore: 62 }],
  },
  {
    id: "ecchi",
    name: "Ecchi",
    tagline: "Fan service assumé",
    adult: true,
    look: { foil: ["#4a0d1f", "#e11d48", "#fb7185"], emblem: "flame" },
    filters: [{ genres: ["Ecchi"], minScore: 55, pages: 8 }],
  },
  {
    id: "hentai",
    name: "Hentai",
    tagline: "Réservé aux adultes",
    adult: true,
    isAdult: true,
    look: { foil: ["#0d0d12", "#a21caf", "#3b0764"], emblem: "adult" },
    filters: [{ formats: ["OVA", "ONA", "MOVIE", "TV", "SPECIAL"], pages: 8 }],
  },
];

export const DEFAULT_BOOSTER = "decouverte";

export function getBooster(id: string): BoosterDefinition | undefined {
  return BOOSTERS.find((b) => b.id === id);
}

export function availableBoosters(adult: boolean): BoosterDefinition[] {
  return BOOSTERS.filter((b) => adult || !b.adult);
}

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;

/** AniList season of a date: winter = January to March, and so on. */
export function seasonOf(date: Date): { season: (typeof SEASONS)[number]; year: number } {
  return { season: SEASONS[Math.floor(date.getUTCMonth() / 3)]!, year: date.getUTCFullYear() };
}

/** GraphQL type and Page.media argument of each booster variable. */
const MEDIA_ARGS = {
  page: ["Int", null],
  sort: ["[MediaSort]", "sort"],
  adult: ["Boolean", "isAdult"],
  score: ["Int", "averageScore_greater"],
  popMin: ["Int", "popularity_greater"],
  popMax: ["Int", "popularity_lesser"],
  genres: ["[String]", "genre_in"],
  noGenres: ["[String]", "genre_not_in"],
  tags: ["[String]", "tag_in"],
  noTags: ["[String]", "tag_not_in"],
  formats: ["[MediaFormat]", "format_in"],
  status: ["[MediaStatus]", "status_in"],
  after: ["FuzzyDateInt", "startDate_greater"],
  before: ["FuzzyDateInt", "startDate_lesser"],
  season: ["MediaSeason", "season"],
  seasonYear: ["Int", "seasonYear"],
  country: ["CountryCode", "countryOfOrigin"],
  source: ["[MediaSource]", "source_in"],
  epMin: ["Int", "episodes_greater"],
  epMax: ["Int", "episodes_lesser"],
} as const;

export type BoosterVariables = Partial<Record<keyof typeof MEDIA_ARGS, unknown>> & { page: number };

/**
 * GraphQL variables for one page of a booster band. Only set filters are included: AniList rejects a null
 * comparison filter ("Illegal operator and value combination") instead of ignoring it.
 */
export function boosterVariables(
  filter: BoosterFilter,
  page: number,
  booster: Pick<BoosterDefinition, "adult" | "isAdult">,
  now = new Date(),
): BoosterVariables {
  const current = filter.season === "current" ? seasonOf(now) : null;
  const [yearMin, yearMax] = filter.years ?? [null, null];
  const [popMin, popMax] = filter.popularity ?? [null, null];
  const [epMin, epMax] = filter.episodes ?? [null, null];
  // Packs that are not adult stay free of fan service, whatever their other filters.
  const noGenres = booster.adult ? filter.excludeGenres : [...(filter.excludeGenres ?? []), "Ecchi"];
  const all: BoosterVariables = {
    page,
    sort: [filter.sort ?? "POPULARITY_DESC"],
    adult: booster.isAdult ?? false,
    score: filter.minScore,
    popMin,
    popMax,
    genres: filter.genres,
    noGenres,
    tags: filter.tags,
    noTags: filter.excludeTags,
    formats: filter.formats ?? ["TV", "TV_SHORT", "MOVIE", "ONA"],
    status: filter.status ?? ["FINISHED", "RELEASING"],
    // FuzzyDateInt bounds are exclusive: YYYY0000 / (YYYY+1)0000 keep whole years.
    after: yearMin !== null ? yearMin * 10_000 - 1 : null,
    before: yearMax !== null ? (yearMax + 1) * 10_000 : null,
    season: current?.season,
    seasonYear: current?.year,
    country: filter.country,
    source: filter.source,
    epMin: epMin !== null ? epMin - 1 : null,
    epMax: epMax !== null ? epMax + 1 : null,
  };
  const set = Object.entries(all).filter(([, value]) => value !== null && value !== undefined && !isEmptyList(value));
  return Object.fromEntries(set) as BoosterVariables;
}

function isEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/** The Page(media) query declaring only the variables actually sent. */
export function boosterQuery(variables: BoosterVariables, fields: string): string {
  const keys = (Object.keys(MEDIA_ARGS) as (keyof typeof MEDIA_ARGS)[]).filter((key) => key in variables);
  const declarations = keys.map((key) => `$${key}: ${MEDIA_ARGS[key][0]}`).join(", ");
  const args = keys
    .filter((key) => MEDIA_ARGS[key][1] !== null)
    .map((key) => `${MEDIA_ARGS[key][1]}: $${key}`)
    .join(", ");
  return `query (${declarations}) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, ${args}) { ${fields} }
  }
}`;
}

/** CSS variables consumed by the foil and card-back styles. */
export function boosterStyle(booster: BoosterDefinition): Record<string, string> {
  const [a, b, c] = booster.look.foil;
  return { "--foil-a": a, "--foil-b": b, "--foil-c": c };
}
