import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema.gen";

export type Schemas = components["schemas"];

/** An error response from the API: {"error": {"code", "message"}}. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Structured context for some errors, e.g. crawl_in_progress (details.crawl) or classification_impact. */
    readonly details?: Record<string, unknown>,
    /** Seconds from the Retry-After header (429 rate_limited). */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The session's CSRF token, from GET /v1/me. Sent on every unsafe request.
let csrfToken = "";
export function setCsrfToken(token: string) {
  csrfToken = token;
}

/** The CSRF header for unsafe requests made without the API client (streams, uploads). */
export function csrfHeader(): Record<string, string> {
  return csrfToken ? { "X-CSRF-Token": csrfToken } : {};
}

const csrf: Middleware = {
  onRequest({ request }) {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && csrfToken) {
      request.headers.set("X-CSRF-Token", csrfToken);
    }
    return request;
  },
};

// Absolute base (same origin) so requests also construct outside a browser.
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? "",
  credentials: "same-origin",
  // Look fetch up per call (not at import) so it can be replaced in tests.
  fetch: (request) => globalThis.fetch(request),
});
api.use(csrf);

type Result<T> = { data?: { data: T }; error?: unknown; response: Response };

/**
 * Returns the `data` of a successful response or throws an ApiError. Use it
 * to wrap every call: `unwrap(await api.GET("/v1/me"))`.
 */
export function unwrap<T>(res: Result<T>): T {
  if (res.data !== undefined) return res.data.data;
  const err = (res.error ?? {}) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
  const retry = Number(res.response.headers?.get("Retry-After"));
  throw new ApiError(
    res.response.status,
    err.error?.code ?? "http_" + res.response.status,
    err.error?.message ?? `Request failed (${res.response.status})`,
    err.error?.details,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
}

/** Formats a revision for the If-Match header. */
export const ifMatch = (revision: number) => ({ "If-Match": `"${revision}"` });

/** details of 409 limit_reached and 429 rate_limited (team limits). */
type LimitDetails = { limit: Schemas["LimitKey"]; max: number; current: number };

/**
 * A title and message for team limit errors: 409 limit_reached (a resource
 * cap such as data sources or storage) and 429 rate_limited (query rates).
 * The server's message already names the limit, e.g. "Your team has reached
 * its limit of 100 data sources. Ask a platform admin to raise it."
 * Undefined for other errors.
 */
export function limitError(err: unknown): { title: string; message: string; details?: LimitDetails } | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const details = err.details as LimitDetails | undefined;
  if (err.code === "limit_reached") {
    return { title: details?.max === 0 ? "Blocked for your team" : "Team limit reached", message: err.message, details };
  }
  if (err.code === "rate_limited") {
    const wait = err.retryAfter && err.retryAfter <= 120 ? ` You can try again in ${err.retryAfter} s.` : "";
    return { title: details?.limit === "queries_per_day" ? "Daily query limit reached" : "Too many requests", message: err.message + wait, details };
  }
  return undefined;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
