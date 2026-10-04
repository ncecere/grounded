/*
 * When to retry a failed query, and how long to wait (AD-03, VI-03). The
 * per-user request limit answers 429 rate_limited with Retry-After (at most a
 * minute): those are retried after that wait, never in a tight loop. Other
 * client errors (4xx) won't fix themselves; server and network errors are
 * retried with exponential backoff.
 */
import { ApiError } from "../api/client";

/** The longest Retry-After worth waiting for in the page (the per-user limit's window is a minute). */
export const MAX_RETRY_AFTER_S = 60;

/** A 429 from the per-user request limit: it lifts within a minute (a team's daily query limit or budget doesn't). */
export function isRateLimited(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 429 &&
    err.code === "rate_limited" &&
    !err.details?.limit &&
    (err.retryAfter === undefined || err.retryAfter <= MAX_RETRY_AFTER_S)
  );
}

/** The default for queries: two retries of a server or network error, two of a rate limit (after its Retry-After). */
export function shouldRetry(failureCount: number, err: unknown): boolean {
  if (isRateLimited(err)) return failureCount < 2;
  return !(err instanceof ApiError && err.status < 500) && failureCount < 2;
}

/** The session (GET /v1/me): a rate limit is retried until it lifts; it's what the whole app waits for. */
export function shouldRetrySession(failureCount: number, err: unknown): boolean {
  return isRateLimited(err) || shouldRetry(failureCount, err);
}

/**
 * Milliseconds before the next try: a rate limit's Retry-After (plus up to
 * half a second, so tabs don't all come back at once), else 1 s, 2 s, 4 s…
 * up to 30 s.
 */
export function retryDelay(failureCount: number, err: unknown, random: () => number = Math.random): number {
  if (isRateLimited(err)) {
    const wait = Math.min(err.retryAfter ?? 2 ** failureCount, MAX_RETRY_AFTER_S);
    return Math.max(1, wait) * 1000 + Math.round(random() * 500);
  }
  return Math.min(1000 * 2 ** failureCount, 30_000);
}
