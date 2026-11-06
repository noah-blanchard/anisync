/**
 * Pure builders of the Simkl write calls (no I/O, unit-tested in tests/simkl.test.ts).
 * A write is an ordered list of POST calls: Simkl allows 1 POST/s, so the caller sends them one by one.
 */
import {
  applyPatch,
  clampScore,
  toSimklStatus,
  type EntryPatch,
  type EntryState,
  type MediaKind,
  type SimklStatus,
} from "./mapping";
import type { EpisodeRef } from "./merge";

export type SimklEndpoint =
  | "/sync/history"
  | "/sync/history/remove"
  | "/sync/add-to-list"
  | "/sync/ratings"
  | "/sync/ratings/remove";

export interface SimklIds {
  simkl?: number;
  mal?: number;
  anilist?: number;
}

export interface SimklItemBody {
  ids: SimklIds;
  /** add-to-list destination */
  to?: SimklStatus;
  status?: SimklStatus;
  rating?: number;
  /** anime: absolute episode numbers */
  episodes?: { number: number }[];
  /** shows */
  seasons?: { number: number; episodes: { number: number }[] }[];
}

export type SimklEnvelopeKey = "anime" | "shows" | "movies";
export type SimklBody = Partial<Record<SimklEnvelopeKey, SimklItemBody[]>>;

export interface SimklCall {
  endpoint: SimklEndpoint;
  body: SimklBody;
}

export interface SimklWriteTarget {
  kind: MediaKind;
  simklId: number | null;
  malId: number | null;
  anilistId: number | null;
  nextEpisode: EpisodeRef | null;
  lastEpisode: EpisodeRef | null;
}

/** Raised when a write cannot be expressed on Simkl; the server maps it to a ServiceError 400. */
export class SimklPlanError extends Error {
  override name = "SimklPlanError";
}

/** Max episodes sent in one history call. */
export const SIMKL_EPISODE_CHUNK = 500;

export function envelopeKey(kind: MediaKind): SimklEnvelopeKey {
  if (kind === "anime") return "anime";
  return kind === "show" ? "shows" : "movies";
}

/** Anime: MAL / AniList ids (Path B) plus the Simkl id when known. Shows and movies: the Simkl id. */
export function simklIds(target: Pick<SimklWriteTarget, "kind" | "simklId" | "malId" | "anilistId">): SimklIds {
  const ids: SimklIds = {};
  if (target.kind === "anime") {
    if (target.malId !== null) ids.mal = target.malId;
    if (target.anilistId !== null) ids.anilist = target.anilistId;
  }
  if (target.simklId !== null) ids.simkl = target.simklId;
  return ids;
}

function requireIds(target: SimklWriteTarget): SimklIds {
  const ids = simklIds(target);
  if (Object.keys(ids).length === 0) throw new SimklPlanError("Identifiant Simkl introuvable pour ce titre");
  return ids;
}

function call(endpoint: SimklEndpoint, kind: MediaKind, item: SimklItemBody): SimklCall {
  return { endpoint, body: { [envelopeKey(kind)]: [item] } };
}

function range(from: number, to: number): { number: number }[] {
  const out: { number: number }[] = [];
  for (let n = from; n <= to; n++) out.push({ number: n });
  return out;
}

/** Episodes from..to split in chunks of SIMKL_EPISODE_CHUNK. */
function chunks(from: number, to: number): { number: number }[][] {
  const out: { number: number }[][] = [];
  for (let start = from; start <= to; start += SIMKL_EPISODE_CHUNK) {
    out.push(range(start, Math.min(to, start + SIMKL_EPISODE_CHUNK - 1)));
  }
  return out;
}

const EMPTY_STATE: EntryState = { status: "plan_to_watch", progress: 0, score: 0, updatedAt: null, entryId: null };

/** Rating calls for a score change (0 = remove the rating). */
function ratingCall(target: SimklWriteTarget, ids: SimklIds, score: number, current: EntryState | null): SimklCall[] {
  if (score > 0) return [call("/sync/ratings", target.kind, { ids, rating: score })];
  // Nothing to clear when we know there is no rating.
  if (!current || current.score === 0) return [];
  return [call("/sync/ratings/remove", target.kind, { ids })];
}

/**
 * Plans the Simkl calls that apply `patch` on top of `current`.
 * `expected` is the state the entry should have afterwards (the caller may override the status
 * with the one Simkl reports in the response).
 */
export function planSimklWrite(
  target: SimklWriteTarget,
  current: EntryState | null,
  patch: EntryPatch,
  total: number | null,
): { calls: SimklCall[]; expected: EntryState } {
  const ids = requireIds(target);
  if (target.kind === "movie") return planMovie(target, ids, current, patch);

  const base = current ?? EMPTY_STATE;
  const cur = current?.progress ?? 0;
  const next = applyPatch(base, patch, total);
  const progressChanged = patch.progress !== undefined && next.progress !== cur;
  const completing = patch.status === "completed";
  const status = patch.status !== undefined ? toSimklStatus(patch.status, target.kind) : undefined;
  const score = patch.score !== undefined ? clampScore(patch.score) : undefined;
  const rating = score !== undefined && score > 0 ? score : undefined;
  const calls: SimklCall[] = [];

  // Raising the progress of a plan_to_watch / new entry makes Simkl move it to "watching".
  const expected: EntryState = { ...next, updatedAt: Date.now() };
  if (progressChanged && next.progress > cur && patch.status === undefined && base.status === "plan_to_watch") {
    expected.status = "watching";
  }

  /** Follow-up calls for the status / score of a patch whose history call did not carry them. */
  const followUp = (withStatus: boolean, withScore: boolean): SimklCall[] => {
    const extra: SimklCall[] = [];
    if (withStatus && status) extra.push(call("/sync/add-to-list", target.kind, { ids, to: status }));
    if (withScore && score !== undefined) extra.push(...ratingCall(target, ids, score, current));
    return extra;
  };

  if (target.kind === "show" && completing) {
    // Whole show watched in one call (Simkl may downgrade to "watching" if it is still airing).
    calls.push(call("/sync/history", "show", { ids, status: "completed", ...(rating ? { rating } : {}) }));
    calls.push(...followUp(false, score === 0));
    if (total !== null) expected.progress = total;
    return { calls, expected };
  }

  if (progressChanged) {
    const up = next.progress > cur;
    if (target.kind === "anime") {
      if (up) {
        const parts = chunks(cur + 1, next.progress);
        parts.forEach((episodes, i) => {
          const last = i === parts.length - 1;
          calls.push(
            call("/sync/history", "anime", {
              ids,
              episodes,
              ...(last && status ? { status } : {}),
              ...(last && rating ? { rating } : {}),
            }),
          );
        });
        calls.push(...followUp(false, score === 0));
      } else {
        for (const episodes of chunks(next.progress + 1, cur)) {
          calls.push(call("/sync/history/remove", "anime", { ids, episodes }));
        }
        calls.push(...followUp(true, true));
      }
      return { calls, expected };
    }

    // Shows: only a single step in either direction is expressible.
    const delta = next.progress - cur;
    if (delta === 1) {
      const ref = target.nextEpisode;
      if (!ref) throw new SimklPlanError("Prochain épisode inconnu pour cette série");
      calls.push(
        call("/sync/history", "show", {
          ids,
          seasons: [{ number: ref.season, episodes: [{ number: ref.episode }] }],
          ...(status ? { status } : {}),
          ...(rating ? { rating } : {}),
        }),
      );
      calls.push(...followUp(false, score === 0));
      return { calls, expected };
    }
    if (delta === -1) {
      const ref = target.lastEpisode;
      if (!ref) throw new SimklPlanError("Dernier épisode vu inconnu pour cette série");
      calls.push(
        call("/sync/history/remove", "show", {
          ids,
          seasons: [{ number: ref.season, episodes: [{ number: ref.episode }] }],
        }),
      );
      calls.push(...followUp(true, true));
      return { calls, expected };
    }
    throw new SimklPlanError("Utilise +1 / -1 pour une série");
  }

  // No progress change.
  if (completing) {
    calls.push(call("/sync/history", target.kind, { ids, status: "completed", ...(rating ? { rating } : {}) }));
    calls.push(...followUp(false, score === 0));
    return { calls, expected };
  }
  calls.push(...followUp(true, true));
  return { calls, expected };
}

function planMovie(
  target: SimklWriteTarget,
  ids: SimklIds,
  current: EntryState | null,
  patch: EntryPatch,
): { calls: SimklCall[]; expected: EntryState } {
  const base = current ?? EMPTY_STATE;
  // A movie has a single "episode": a progress change is a watched / not watched toggle.
  let wanted = patch.status;
  if (wanted === undefined && patch.progress !== undefined) {
    const watched = patch.progress > 0;
    if (watched !== (base.status === "completed")) wanted = watched ? "completed" : "plan_to_watch";
  }
  const simklStatus = wanted ? toSimklStatus(wanted, "movie") : undefined;
  const score = patch.score !== undefined ? clampScore(patch.score) : undefined;
  const rating = score !== undefined && score > 0 ? score : undefined;
  const calls: SimklCall[] = [];

  if (simklStatus === "completed") {
    calls.push(call("/sync/history", "movie", { ids, ...(rating ? { rating } : {}) }));
  } else if (simklStatus) {
    calls.push(call("/sync/add-to-list", "movie", { ids, to: simklStatus }));
  }
  if (score !== undefined && !(simklStatus === "completed" && rating)) {
    calls.push(...ratingCall(target, ids, score, current));
  }

  const status = simklStatus ? (simklStatus === "completed" ? "completed" : wanted === "dropped" ? "dropped" : "plan_to_watch") : base.status;
  const expected: EntryState = {
    ...base,
    status,
    progress: status === "completed" ? 1 : 0,
    score: score ?? base.score,
    updatedAt: Date.now(),
  };
  return { calls, expected };
}

/** Removes the title from the Simkl library (item without episodes = whole entry). */
export function planSimklRemove(target: SimklWriteTarget): SimklCall[] {
  return [call("/sync/history/remove", target.kind, { ids: requireIds(target) })];
}
