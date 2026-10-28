import type { ConnectionInfo } from "./connections";
import type { AnnotatedSearchResult, ListPayload, ServiceResult, WriteResult } from "./sync";

export type { AnnotatedSearchResult, ConnectionInfo, ListPayload, ServiceResult, WriteResult };

export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** JSON fetch against our own API. A 401 sends the user back to the login page. */
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Réseau indisponible");
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "error" in json && typeof json.error === "string"
        ? json.error
        : `Erreur ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return json as T;
}
