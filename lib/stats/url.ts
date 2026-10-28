/**
 * Stats page state in the URL (shareable, survives back / forward): filters, compared segment and tab.
 * Pure, unit-tested in tests/stats.test.ts.
 */
import { CANONICAL_STATUSES, type CanonicalStatus } from "../mapping";
import { EMPTY_FILTERS, type Dimension, type StatsFilters } from "./gold";
import type { LengthBucket } from "./types";

export const STATS_TABS = [
  "overview",
  "time",
  "tastes",
  "scores",
  "catalog",
  "backlog",
  "profile",
  "history",
  "compare",
] as const;
export type StatsTab = (typeof STATS_TABS)[number];

/** Everything the URL holds: the page filters (segment A), the compare tab's segment B, and the tab. */
export interface StatsUrlState {
  filters: StatsFilters;
  compare: StatsFilters;
  tab: StatsTab;
}

/** Segment B's parameters carry this prefix ("b.genre=Action"). */
const COMPARE_PREFIX = "b.";

const LENGTHS: LengthBucket[] = ["film", "short", "standard", "long", "saga"];

type ListKey = "genres" | "tags" | "formats" | "sources" | "studios" | "countries";
const LIST_PARAMS: [ListKey, string][] = [
  ["genres", "genre"],
  ["tags", "tag"],
  ["formats", "format"],
  ["sources", "source"],
  ["studios", "studio"],
  ["countries", "country"],
];

function score(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

function readFilters(params: URLSearchParams, prefix = ""): StatsFilters {
  const all = (name: string) => params.getAll(prefix + name);
  const filters: StatsFilters = {
    ...EMPTY_FILTERS,
    statuses: all("status").filter((s): s is CanonicalStatus => CANONICAL_STATUSES.includes(s as CanonicalStatus)),
    genreMode: params.get(`${prefix}gmode`) === "all" ? "all" : "any",
    decades: all("decade")
      .map(Number)
      .filter((d) => Number.isInteger(d) && d % 10 === 0),
    lengths: all("length").filter((l): l is LengthBucket => LENGTHS.includes(l as LengthBucket)),
    completedYears: all("done")
      .map(Number)
      .filter((y) => Number.isInteger(y) && y > 1900),
    scoreMin: score(params.get(`${prefix}smin`)),
    scoreMax: score(params.get(`${prefix}smax`)),
  };
  for (const [key, param] of LIST_PARAMS) filters[key] = all(param).filter(Boolean);
  return filters;
}

function writeFilters(params: URLSearchParams, filters: StatsFilters, prefix = ""): void {
  const add = (name: string, value: string) => params.append(prefix + name, value);
  for (const s of filters.statuses) add("status", s);
  for (const [key, param] of LIST_PARAMS) for (const v of filters[key]) add(param, v);
  if (filters.genres.length > 1 && filters.genreMode === "all") add("gmode", "all");
  for (const d of filters.decades) add("decade", String(d));
  for (const l of filters.lengths) add("length", l);
  for (const y of filters.completedYears) add("done", String(y));
  if (filters.scoreMin !== null) add("smin", String(filters.scoreMin));
  if (filters.scoreMax !== null) add("smax", String(filters.scoreMax));
}

export function parseStatsParams(params: URLSearchParams): StatsUrlState {
  const tab = params.get("tab");
  return {
    filters: readFilters(params),
    compare: readFilters(params, COMPARE_PREFIX),
    tab: STATS_TABS.includes(tab as StatsTab) ? (tab as StatsTab) : "overview",
  };
}

export function statsSearch(state: StatsUrlState): string {
  const params = new URLSearchParams();
  if (state.tab !== "overview") params.set("tab", state.tab);
  writeFilters(params, state.filters);
  writeFilters(params, state.compare, COMPARE_PREFIX);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** The filter that narrows the page to one value of a dimension (null when the dimension has no filter). */
export function filterFor(dimension: Dimension, value: string): Partial<StatsFilters> | null {
  switch (dimension) {
    case "genre":
      return { genres: [value] };
    case "tag":
      return { tags: [value] };
    case "studio":
      return { studios: [value] };
    case "format":
      return { formats: [value] };
    case "source":
      return { sources: [value] };
    case "country":
      return { countries: [value] };
    case "decade":
      return { decades: [Number(value)] };
    case "length":
      return { lengths: [value as LengthBucket] };
    case "status":
      return { statuses: [value as CanonicalStatus] };
    case "score":
      return { scoreMin: Number(value), scoreMax: Number(value) };
    default:
      return null;
  }
}

/** Adds a filter to the current ones (list values are appended once). */
export function mergeFilters(current: StatsFilters, extra: Partial<StatsFilters>): StatsFilters {
  const next: StatsFilters = { ...current };
  for (const [key, value] of Object.entries(extra) as [keyof StatsFilters, StatsFilters[keyof StatsFilters]][]) {
    if (Array.isArray(value)) {
      const list = current[key] as unknown[];
      (next as unknown as Record<string, unknown>)[key] = [...list, ...value.filter((v) => !list.includes(v))];
    } else {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}
