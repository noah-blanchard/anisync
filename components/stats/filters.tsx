"use client";

import { SearchIcon, XIcon } from "lucide-react";
import * as React from "react";
import { ResponsiveOverlay } from "@/components/responsive-overlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_ORDER } from "@/lib/labels";
import { activeFilterCount, EMPTY_FILTERS, groupBy, naturalOrder, type Dimension, type StatsFilters } from "@/lib/stats/gold";
import {
  countryLabel,
  decadeLabel,
  dimensionValueLabel,
  formatName,
  genreLabel,
  LENGTH_LABELS,
  sourceLabel,
  statusLabel,
} from "@/lib/stats/labels";
import type { LengthBucket, StatsRow } from "@/lib/stats/types";
import { cn } from "@/lib/utils";

export function Chip({
  pressed,
  onClick,
  children,
  count,
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed
          ? "border-primary/40 bg-primary/15 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        className,
      )}
    >
      {children}
      {count !== undefined ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
    </button>
  );
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function FilterSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Values of a dimension in the whole list, with their title counts. */
function useFacet(rows: readonly StatsRow[], dimension: Dimension) {
  return React.useMemo(() => {
    const groups = groupBy(rows, dimension);
    const order = naturalOrder(dimension);
    return order ? groups.sort((a, b) => order(a.value, b.value)) : groups;
  }, [rows, dimension]);
}

function ChipFacet({
  rows,
  dimension,
  selected,
  onToggle,
  parse = (v) => v,
}: {
  rows: readonly StatsRow[];
  dimension: Dimension;
  selected: readonly (string | number)[];
  onToggle: (value: string | number) => void;
  parse?: (value: string) => string | number;
}) {
  const facet = useFacet(rows, dimension);
  if (facet.length === 0) return <p className="text-sm text-muted-foreground">Aucune donnée</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {facet.map((g) => {
        const value = parse(g.value);
        return (
          <Chip key={g.value} pressed={selected.includes(value)} count={g.count} onClick={() => onToggle(value)}>
            {dimensionValueLabel(dimension, g.value)}
          </Chip>
        );
      })}
    </div>
  );
}

/** For long lists (tags, studios): a search field and the most frequent values. */
function SearchFacet({
  rows,
  dimension,
  selected,
  onToggle,
  placeholder,
}: {
  rows: readonly StatsRow[];
  dimension: Dimension;
  selected: string[];
  onToggle: (value: string) => void;
  placeholder: string;
}) {
  const facet = useFacet(rows, dimension);
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = facet
    .filter((g) => !selected.includes(g.value) && (!q || g.value.toLowerCase().includes(q)))
    .slice(0, q ? 40 : 18);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 pl-9" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {selected.map((v) => (
          <Chip key={v} pressed onClick={() => onToggle(v)}>
            {v}
          </Chip>
        ))}
        {shown.map((g) => (
          <Chip key={g.value} pressed={false} count={g.count} onClick={() => onToggle(g.value)}>
            {g.value}
          </Chip>
        ))}
        {facet.length === 0 ? <p className="text-sm text-muted-foreground">Aucune donnée</p> : null}
      </div>
    </div>
  );
}

/** Years I finished titles in, latest first. */
function CompletionYears({
  rows,
  selected,
  onToggle,
}: {
  rows: readonly StatsRow[];
  selected: number[];
  onToggle: (year: number) => void;
}) {
  const years = React.useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of rows) {
      if (r.completedAt === null) continue;
      const y = new Date(r.completedAt).getUTCFullYear();
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0] - a[0]);
  }, [rows]);
  if (years.length === 0) return <p className="text-sm text-muted-foreground">Aucune date de fin</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {years.map(([year, count]) => (
        <Chip key={year} pressed={selected.includes(year)} count={count} onClick={() => onToggle(year)}>
          {year}
        </Chip>
      ))}
    </div>
  );
}

const SCORES = Array.from({ length: 10 }, (_, i) => i + 1);

function ScoreSelect({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
}) {
  return (
    <Select value={value === null ? "any" : String(value)} onValueChange={(v) => onChange(v === "any" ? null : Number(v))}>
      <SelectTrigger aria-label={label} className="h-9 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">{label} : —</SelectItem>
        {SCORES.map((s) => (
          <SelectItem key={s} value={String(s)}>
            {label} : {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterSheet({
  open,
  onOpenChange,
  rows,
  filters,
  onChange,
  resultCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly StatsRow[];
  filters: StatsFilters;
  onChange: (filters: StatsFilters) => void;
  resultCount: number;
}) {
  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange} title="Filtres" description="Affiner les statistiques">
      <div className="flex flex-col gap-6 p-5 pb-8 lg:p-6">
        <div className="hidden items-center justify-between lg:flex">
          <h2 className="text-lg font-semibold">Filtres</h2>
        </div>

        <FilterSection title="Statut">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ORDER.map((s) => (
              <Chip
                key={s}
                pressed={filters.statuses.includes(s)}
                count={rows.filter((r) => r.status === s).length}
                onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, s) })}
              >
                {statusLabel(s)}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Sans statut choisi, les titres « À voir » ne comptent pas dans les goûts, les notes et le profil.
          </p>
        </FilterSection>

        <FilterSection
          title="Genres"
          action={
            filters.genres.length > 1 ? (
              <div className="flex gap-1">
                <Chip pressed={filters.genreMode === "any"} onClick={() => onChange({ ...filters, genreMode: "any" })} className="h-7 px-2.5 text-xs">
                  Au moins un
                </Chip>
                <Chip pressed={filters.genreMode === "all"} onClick={() => onChange({ ...filters, genreMode: "all" })} className="h-7 px-2.5 text-xs">
                  Tous
                </Chip>
              </div>
            ) : null
          }
        >
          <ChipFacet rows={rows} dimension="genre" selected={filters.genres} onToggle={(v) => onChange({ ...filters, genres: toggle(filters.genres, String(v)) })} />
        </FilterSection>

        <FilterSection title="Tags">
          <SearchFacet
            rows={rows}
            dimension="tag"
            selected={filters.tags}
            onToggle={(v) => onChange({ ...filters, tags: toggle(filters.tags, v) })}
            placeholder="Chercher un tag"
          />
        </FilterSection>

        <FilterSection title="Note">
          <div className="grid grid-cols-2 gap-2">
            <ScoreSelect label="Min" value={filters.scoreMin} onChange={(scoreMin) => onChange({ ...filters, scoreMin })} />
            <ScoreSelect label="Max" value={filters.scoreMax} onChange={(scoreMax) => onChange({ ...filters, scoreMax })} />
          </div>
        </FilterSection>

        <FilterSection title="Format">
          <ChipFacet rows={rows} dimension="format" selected={filters.formats} onToggle={(v) => onChange({ ...filters, formats: toggle(filters.formats, String(v)) })} />
        </FilterSection>

        <FilterSection title="Longueur">
          <ChipFacet
            rows={rows}
            dimension="length"
            selected={filters.lengths}
            onToggle={(v) => onChange({ ...filters, lengths: toggle(filters.lengths, v as LengthBucket) })}
          />
        </FilterSection>

        <FilterSection title="Terminé en">
          <CompletionYears rows={rows} selected={filters.completedYears} onToggle={(y) => onChange({ ...filters, completedYears: toggle(filters.completedYears, y) })} />
        </FilterSection>

        <FilterSection title="Décennie">
          <ChipFacet
            rows={rows}
            dimension="decade"
            selected={filters.decades}
            parse={Number}
            onToggle={(v) => onChange({ ...filters, decades: toggle(filters.decades, Number(v)) })}
          />
        </FilterSection>

        <FilterSection title="Source">
          <ChipFacet rows={rows} dimension="source" selected={filters.sources} onToggle={(v) => onChange({ ...filters, sources: toggle(filters.sources, String(v)) })} />
        </FilterSection>

        <FilterSection title="Studio">
          <SearchFacet
            rows={rows}
            dimension="studio"
            selected={filters.studios}
            onToggle={(v) => onChange({ ...filters, studios: toggle(filters.studios, v) })}
            placeholder="Chercher un studio"
          />
        </FilterSection>

        <FilterSection title="Pays">
          <ChipFacet
            rows={rows}
            dimension="country"
            selected={filters.countries}
            onToggle={(v) => onChange({ ...filters, countries: toggle(filters.countries, String(v)) })}
          />
        </FilterSection>

        <div className="sticky bottom-0 -mx-5 mt-2 flex gap-2 border-t border-border bg-background/95 px-5 pt-3 pb-1 backdrop-blur lg:-mx-6 lg:px-6">
          <Button variant="outline" onClick={() => onChange(EMPTY_FILTERS)} disabled={activeFilterCount(filters) === 0}>
            Réinitialiser
          </Button>
          <Button className="flex-1" onClick={() => onOpenChange(false)}>
            Voir {resultCount} titre{resultCount > 1 ? "s" : ""}
          </Button>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}

interface ActiveChip {
  id: string;
  label: string;
  remove: (f: StatsFilters) => StatsFilters;
}

function activeChips(f: StatsFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];
  const list = <K extends keyof StatsFilters>(field: K, label: (v: never) => string) => {
    for (const value of f[field] as unknown[]) {
      chips.push({
        id: `${field}:${String(value)}`,
        label: label(value as never),
        remove: (cur) => ({ ...cur, [field]: (cur[field] as unknown[]).filter((v) => v !== value) }),
      });
    }
  };
  list("statuses", statusLabel);
  list("genres", genreLabel);
  list("tags", (v: string) => v);
  list("formats", formatName);
  list("lengths", (v: keyof typeof LENGTH_LABELS) => LENGTH_LABELS[v]);
  list("completedYears", (v: number) => `Terminé en ${v}`);
  list("decades", decadeLabel);
  list("sources", sourceLabel);
  list("studios", (v: string) => v);
  list("countries", countryLabel);
  if (f.scoreMin !== null || f.scoreMax !== null) {
    const label =
      f.scoreMin !== null && f.scoreMax !== null
        ? f.scoreMin === f.scoreMax
          ? `Note ${f.scoreMin}`
          : `Notes ${f.scoreMin} à ${f.scoreMax}`
        : f.scoreMin !== null
          ? `Note ≥ ${f.scoreMin}`
          : `Note ≤ ${f.scoreMax}`;
    chips.push({ id: "score", label, remove: (cur) => ({ ...cur, scoreMin: null, scoreMax: null }) });
  }
  return chips;
}

/** The active filters as removable chips. */
export function ActiveFilters({ filters, onChange }: { filters: StatsFilters; onChange: (filters: StatsFilters) => void }) {
  const chips = activeChips(filters);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.genres.length > 1 ? (
        <span className="text-xs text-muted-foreground">Genres : {filters.genreMode === "all" ? "tous" : "au moins un"}</span>
      ) : null}
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onChange(chip.remove(filters))}
          aria-label={`Retirer le filtre ${chip.label}`}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/40 bg-primary/15 pr-1.5 pl-2.5 text-xs outline-none hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {chip.label}
          <XIcon aria-hidden className="size-3.5 text-muted-foreground" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        className="h-7 rounded-full px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        Tout effacer
      </button>
    </div>
  );
}
