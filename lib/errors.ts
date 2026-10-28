import type { ServiceName } from "./mapping";

export type ErrorCode = "not_connected" | "unauthorized" | "rate_limited" | "timeout" | "network" | "not_found" | "api";

/** Typed error for every call made to MAL or AniList. */
export class ServiceError extends Error {
  override name = "ServiceError";
  readonly service: ServiceName;
  readonly status: number;
  readonly code: ErrorCode;

  constructor(service: ServiceName, status: number, message: string, code?: ErrorCode) {
    super(message);
    this.service = service;
    this.status = status;
    this.code = code ?? codeFromStatus(status);
  }
}

function codeFromStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "api";
}

export function notConnected(service: ServiceName): ServiceError {
  return new ServiceError(service, 401, `${serviceLabel(service)} n'est pas connecté`, "not_connected");
}

export function serviceLabel(service: ServiceName): string {
  return service === "mal" ? "MyAnimeList" : "AniList";
}

/** Short French message safe to show in the UI. */
export function userMessage(error: unknown): string {
  if (error instanceof ServiceError) {
    switch (error.code) {
      case "not_connected":
        return "service non connecté";
      case "unauthorized":
        return "session expirée, reconnecte le service";
      case "rate_limited":
        return "trop de requêtes, réessaie dans un instant";
      case "timeout":
        return "délai dépassé";
      case "network":
        return "service injoignable";
      case "not_found":
        return "introuvable";
      default:
        return error.message || `erreur ${error.status}`;
    }
  }
  return "erreur inattendue";
}
