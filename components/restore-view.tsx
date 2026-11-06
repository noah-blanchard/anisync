"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Cover } from "@/components/entry-bits";
import { Button } from "@/components/ui/button";
import { LIST_KEY } from "@/hooks/use-list";
import { api, type WriteResult } from "@/lib/client-api";
import { SLOT_LABELS, STATUS_LABELS } from "@/lib/labels";
import type { RestoreItem, RestoreService, RestoreState } from "@/lib/restore";
import type { RestorePlan, SnapshotDay } from "@/lib/restore-source";

const DELAY_MS = 1100;
const SERVICES: RestoreService[] = ["mal", "anilist"];

const timeFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "UTC" });

function describeState(s: RestoreState | null): string {
  if (!s) return "absent";
  return `${STATUS_LABELS[s.status]} · Ép. ${s.progress} · ${s.score > 0 ? `${s.score}/10` : "sans note"}`;
}

function ago(timestamp: number | null, now: number): string | null {
  if (timestamp === null) return null;
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 60) return `modifié il y a ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `modifié il y a ${hours} h`;
  return `modifié il y a ${Math.round(hours / 24)} j`;
}

const ACTION_LABELS = { changed: "Rétablir", added: "Retirer de la liste", removed: "Remettre dans la liste" } as const;

function assertDone(result: WriteResult, service: RestoreService): void {
  const r = result[service];
  if (!r.ok) throw new Error(r.error ?? "Échec");
  if (r.skipped) throw new Error("Service non connecté ou entrée introuvable");
}

/** Applies one item through the regular entry API, on its own service only. */
async function applyItem(item: RestoreItem): Promise<void> {
  const ids = {
    key: item.key,
    ...(item.malId !== null ? { malId: item.malId } : {}),
    ...(item.anilistId !== null ? { anilistId: item.anilistId } : {}),
    targets: [item.service],
  };
  if (item.kind === "added") {
    const result = await api<WriteResult>("/api/entry", { method: "DELETE", body: JSON.stringify(ids) });
    assertDone(result, item.service);
    return;
  }
  const result = await api<WriteResult>("/api/entry", {
    method: "POST",
    body: JSON.stringify({ ...ids, patch: item.patch }),
  });
  assertDone(result, item.service);
}

export function RestoreView() {
  const qc = useQueryClient();
  const [day, setDay] = React.useState<string | null>(null);
  const days = useQuery({ queryKey: ["restore", "days"], queryFn: () => api<{ days: SnapshotDay[] }>("/api/restore") });
  const plan = useQuery({
    queryKey: ["restore", "plan", day],
    queryFn: () => api<RestorePlan>(`/api/restore?day=${day}`),
    enabled: day !== null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = React.useState<Map<string, string>>(new Map());
  const [applied, setApplied] = React.useState<Set<string>>(new Set());
  const cancelled = React.useRef(false);
  const [now, setNow] = React.useState(0);

  React.useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Everything checked by default when a plan loads.
  const planData = plan.data;
  React.useEffect(() => {
    if (!planData) return;
    setSelected(new Set(planData.items.map((i) => i.id)));
    setFailed(new Map());
    setApplied(new Set());
    setNow(Date.now());
  }, [planData]);

  const items = React.useMemo(() => (planData?.items ?? []).filter((i) => !applied.has(i.id)), [planData, applied]);
  const chosen = items.filter((i) => selected.has(i.id));
  const running = progress !== null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (queue: RestoreItem[]) => {
    cancelled.current = false;
    setProgress({ done: 0, total: queue.length });
    const errors = new Map<string, string>();
    const done = new Set<string>();
    for (const [index, item] of queue.entries()) {
      if (cancelled.current) break;
      try {
        await applyItem(item);
        done.add(item.id);
      } catch (error) {
        errors.set(item.id, (error as Error).message);
      }
      setProgress({ done: index + 1, total: queue.length });
      if (index < queue.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    setProgress(null);
    setApplied((prev) => new Set([...prev, ...done]));
    setFailed(errors);
    await qc.invalidateQueries({ queryKey: LIST_KEY });
    if (errors.size > 0) toast.error(`${errors.size} modification(s) ont échoué`);
    else if (cancelled.current) toast.message(`${done.size} modification(s) restaurée(s), arrêt demandé`);
    else toast.success(`${done.size} modification(s) restaurée(s)`);
  };

  const available = days.data?.days ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Restaurer ma liste"
        subtitle="Remets MyAnimeList et AniList dans l'état d'un instantané, différence par différence."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/settings">
              <ArrowLeftIcon />
              Paramètres
            </Link>
          </Button>
        }
      />

      <div className="flex gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4 text-sm" role="note">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="font-medium">N&apos;ouvre pas la page Stats avant d&apos;avoir restauré : elle remplace l&apos;instantané du jour.</p>
          <p className="text-muted-foreground">
            Choisis un instantané pris avant le problème. Les heures sont affichées dans ton fuseau local.
          </p>
        </div>
      </div>

      {days.isPending ? (
        <p className="text-sm text-muted-foreground">Chargement des instantanés…</p>
      ) : days.isError ? (
        <p className="text-sm text-destructive">Impossible de lire les instantanés : {days.error.message}</p>
      ) : available.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Aucun instantané disponible. Ils sont pris quand la page Stats est ouverte : tant qu&apos;elle ne l&apos;a pas
          été, il n&apos;y a rien à restaurer.
        </div>
      ) : (
        <section className="flex flex-col gap-2" aria-label="Instantanés">
          <h2 className="text-base font-semibold">1. Choisis un instantané</h2>
          <div role="radiogroup" className="flex flex-col gap-2">
            {available.map((d) => (
              <button
                key={d.day}
                type="button"
                role="radio"
                aria-checked={day === d.day}
                disabled={running}
                onClick={() => setDay(d.day)}
                className={`flex flex-col gap-1 rounded-xl border p-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                  day === d.day ? "border-transparent bg-primary/15 ring-1 ring-primary/50" : "border-border bg-card"
                }`}
              >
                <span className="font-medium capitalize">{dayFormat.format(new Date(`${d.day}T00:00:00Z`))}</span>
                {SERVICES.map((s) => (
                  <span key={s} className="text-muted-foreground">
                    {SLOT_LABELS[s]} :{" "}
                    {d[s] ? `pris à ${timeFormat.format(d[s].fetchedAt)} · ${d[s].count} entrées` : "pas d'instantané"}
                  </span>
                ))}
              </button>
            ))}
          </div>
        </section>
      )}

      {day !== null && (
        <section className="flex flex-col gap-3" aria-label="Aperçu">
          <h2 className="text-base font-semibold">2. Vérifie les différences</h2>
          {plan.isFetching && <p className="text-sm text-muted-foreground">Comparaison avec tes listes actuelles…</p>}
          {plan.isError && <p className="text-sm text-destructive">Comparaison impossible : {plan.error.message}</p>}
          {planData && !plan.isFetching && (
            <>
              {items.length === 0 ? (
                <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  {failed.size === 0 && applied.size === 0
                    ? "Tes listes sont identiques à cet instantané : rien à restaurer."
                    : "Plus rien à restaurer."}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" disabled={running} onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
                      Tout cocher
                    </Button>
                    <Button variant="outline" size="sm" disabled={running} onClick={() => setSelected(new Set())}>
                      Tout décocher
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Si tu as modifié un titre exprès après l&apos;instantané, décoche-le.
                    </span>
                  </div>

                  {SERVICES.map((service) => {
                    const group = items.filter((i) => i.service === service);
                    if (group.length === 0) return null;
                    return (
                      <div key={service} className="flex flex-col gap-1.5">
                        <h3 className="text-sm font-semibold">
                          {SLOT_LABELS[service]} ({group.length})
                        </h3>
                        <ul className="flex flex-col gap-1.5">
                          {group.map((item) => (
                            <li key={item.id} className="rounded-xl border border-border bg-card">
                              <label className="flex cursor-pointer items-center gap-3 p-2">
                                <input
                                  type="checkbox"
                                  className="size-4 shrink-0"
                                  checked={selected.has(item.id)}
                                  disabled={running}
                                  onChange={() => toggle(item.id)}
                                />
                                <Cover src={item.cover} alt="" glow={false} className="w-10 rounded-lg" sizes="40px" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{item.title}</span>
                                  <span className="block text-xs text-muted-foreground">
                                    {ACTION_LABELS[item.kind]} : {describeState(item.now)} → {describeState(item.before)}
                                  </span>
                                  {ago(item.currentUpdatedAt, now) && (
                                    <span className="block text-xs text-muted-foreground">{ago(item.currentUpdatedAt, now)}</span>
                                  )}
                                  {failed.has(item.id) && <span className="block text-xs text-destructive">Échec : {failed.get(item.id)}</span>}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}

                  {running ? (
                    <div className="flex flex-col gap-2" aria-live="polite">
                      <div className="flex justify-between text-sm">
                        <span>Restauration en cours…</span>
                        <span className="tabular-nums">
                          {progress.done} / {progress.total}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-300"
                          style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                        />
                      </div>
                      <Button variant="outline" onClick={() => (cancelled.current = true)}>
                        Arrêter
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={chosen.length === 0} onClick={() => run(chosen)}>
                        Restaurer ({chosen.length})
                      </Button>
                      {failed.size > 0 && (
                        <Button variant="outline" onClick={() => run(items.filter((i) => failed.has(i.id)))}>
                          Réessayer les échecs ({failed.size})
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Instantanés :{" "}
                {SERVICES.filter((s) => planData.fetchedAt[s] !== undefined)
                  .map((s) => `${SLOT_LABELS[s]} ${timeFormat.format(planData.fetchedAt[s])}`)
                  .join(" · ")}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
