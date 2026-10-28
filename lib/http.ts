import "server-only";
import { ServiceError } from "./errors";
import type { ServiceName } from "./mapping";

const TIMEOUT_MS = 10_000;
const MAX_429_RETRIES = 2;
const MAX_5XX_RETRIES = 1;
const MAX_RETRY_AFTER_MS = 30_000;

export interface RequestOptions extends Omit<RequestInit, "signal"> {
  /** Short label for logs, never containing secrets (e.g. "PATCH /anime/:id/my_list_status") */
  label: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
  }
  return 1000 * 2 ** attempt;
}

/** One concise line per failed external call: service, call, status, duration. */
export function logFailure(service: ServiceName, label: string, status: number | string, startedAt: number) {
  console.warn(`[anisync] ${service} ${label} -> ${status} (${Date.now() - startedAt}ms)`);
}

/**
 * fetch with a 10s timeout per attempt, Retry-After aware retries on 429 (max 2)
 * and one retry on 5xx / network errors. Returns the final Response (which may be non-2xx).
 */
export async function fetchWithRetry(service: ServiceName, url: string, options: RequestOptions): Promise<Response> {
  const { label, ...init } = options;
  let rateLimitRetries = 0;
  let serverRetries = 0;

  for (;;) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch (error) {
      clearTimeout(timer);
      const timedOut = controller.signal.aborted;
      logFailure(service, label, timedOut ? "timeout" : "network-error", startedAt);
      if (serverRetries < MAX_5XX_RETRIES) {
        serverRetries++;
        await sleep(500);
        continue;
      }
      throw new ServiceError(
        service,
        0,
        timedOut ? "Délai dépassé" : `Réseau indisponible (${(error as Error).message})`,
        timedOut ? "timeout" : "network",
      );
    }
    clearTimeout(timer);

    if (res.status === 429 && rateLimitRetries < MAX_429_RETRIES) {
      logFailure(service, label, 429, startedAt);
      rateLimitRetries++;
      await res.body?.cancel();
      await sleep(retryAfterMs(res, rateLimitRetries));
      continue;
    }
    if (res.status >= 500 && serverRetries < MAX_5XX_RETRIES) {
      logFailure(service, label, res.status, startedAt);
      serverRetries++;
      await res.body?.cancel();
      await sleep(800);
      continue;
    }
    if (!res.ok) logFailure(service, label, res.status, startedAt);
    return res;
  }
}

/** Reads a JSON body without throwing on invalid JSON. */
export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
