import { formatLabel, STATUS_LABELS } from "../labels";
import type { CanonicalStatus } from "../mapping";
import type { Dimension } from "./gold";
import type { LengthBucket, SeasonName } from "./types";

const GENRES: Record<string, string> = {
  Action: "Action",
  Adventure: "Aventure",
  Comedy: "Comédie",
  Drama: "Drame",
  Ecchi: "Ecchi",
  Fantasy: "Fantasy",
  Hentai: "Hentai",
  Horror: "Horreur",
  "Mahou Shoujo": "Magical girl",
  Mecha: "Mecha",
  Music: "Musique",
  Mystery: "Mystère",
  Psychological: "Psychologique",
  Romance: "Romance",
  "Sci-Fi": "Science-fiction",
  "Slice of Life": "Tranche de vie",
  Sports: "Sport",
  Supernatural: "Surnaturel",
  Thriller: "Thriller",
};

const SOURCES: Record<string, string> = {
  ORIGINAL: "Original",
  MANGA: "Manga",
  LIGHT_NOVEL: "Light novel",
  VISUAL_NOVEL: "Visual novel",
  VIDEO_GAME: "Jeu vidéo",
  GAME: "Jeu",
  NOVEL: "Roman",
  WEB_NOVEL: "Web novel",
  DOUJINSHI: "Doujinshi",
  ANIME: "Anime",
  COMIC: "Comics",
  LIVE_ACTION: "Live action",
  MULTIMEDIA_PROJECT: "Projet multimédia",
  PICTURE_BOOK: "Livre illustré",
  CARD_GAME: "Jeu de cartes",
  OTHER: "Autre",
};

export const SEASON_LABELS: Record<SeasonName, string> = {
  WINTER: "Hiver",
  SPRING: "Printemps",
  SUMMER: "Été",
  FALL: "Automne",
};

const COUNTRIES: Record<string, string> = { JP: "Japon", CN: "Chine", KR: "Corée du Sud", TW: "Taïwan" };

export const LENGTH_LABELS: Record<LengthBucket, string> = {
  film: "Film",
  short: "Court (≤ 13 ép.)",
  standard: "Standard (14-26 ép.)",
  long: "Long (27-64 ép.)",
  saga: "Fleuve (65+ ép.)",
};

const TAG_GROUPS: Record<string, string> = {
  Theme: "Thème",
  Cast: "Personnages",
  Setting: "Cadre",
  Demographic: "Public",
  Technical: "Technique",
  "Sexual Content": "Contenu adulte",
};

export const genreLabel = (genre: string) => GENRES[genre] ?? genre;
export const sourceLabel = (source: string) => SOURCES[source] ?? source.replaceAll("_", " ").toLowerCase();
export const countryLabel = (country: string) => COUNTRIES[country] ?? country;

/** "Theme-Action" -> "Thème" */
export function tagGroupLabel(category: string | undefined): string {
  if (!category) return "Autre";
  const group = category.split("-")[0]!;
  return TAG_GROUPS[group] ?? group;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as CanonicalStatus] ?? status;
}

export function formatName(format: string): string {
  return formatLabel(format) ?? format;
}

const PERCENT = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const INTEGER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

export const formatPercent = (ratio: number) => PERCENT.format(ratio);
export const formatDecimal = (value: number) => DECIMAL.format(value);
export const formatInteger = (value: number) => INTEGER.format(value);
export const formatCompact = (value: number) => COMPACT.format(value);

/** "+0,6" / "−1,2" / "0" */
export function formatSigned(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${DECIMAL.format(Math.abs(rounded))}`;
}

/** 7_380 minutes -> "123 h" */
export function formatHours(minutes: number): string {
  return `${INTEGER.format(Math.round(minutes / 60))} h`;
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  genre: "Genres",
  tag: "Tags",
  studio: "Studios",
  format: "Formats",
  source: "Sources",
  country: "Pays",
  decade: "Décennies",
  year: "Années",
  season: "Saisons",
  length: "Longueur",
  status: "Statuts",
  score: "Notes",
};

export const DIMENSION_SINGULAR: Record<Dimension, string> = {
  genre: "Genre",
  tag: "Tag",
  studio: "Studio",
  format: "Format",
  source: "Source",
  country: "Pays",
  decade: "Décennie",
  year: "Année",
  season: "Saison",
  length: "Longueur",
  status: "Statut",
  score: "Note",
};

/** "1990" -> "Années 90", "2010" -> "Années 2010" */
export function decadeLabel(decade: number): string {
  return decade < 2000 ? `Années ${String(decade).slice(2)}` : `Années ${decade}`;
}

/** Display name of a value of a dimension. */
export function dimensionValueLabel(dimension: Dimension, value: string): string {
  switch (dimension) {
    case "genre":
      return genreLabel(value);
    case "format":
      return formatName(value);
    case "source":
      return sourceLabel(value);
    case "country":
      return countryLabel(value);
    case "decade":
      return decadeLabel(Number(value));
    case "season":
      return SEASON_LABELS[value as SeasonName] ?? value;
    case "length":
      return LENGTH_LABELS[value as LengthBucket] ?? value;
    case "status":
      return statusLabel(value);
    case "score":
      return `${value}/10`;
    default:
      return value;
  }
}
