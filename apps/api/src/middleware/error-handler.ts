import type { Context } from "hono";
import type { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getWideEvent } from "@grounded/logger/middleware";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
  RateLimitError,
  QuotaExceededError,
} from "@grounded/shared/errors/http";

export {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
  RateLimitError,
  QuotaExceededError,
};

function toContentfulStatusCode(
  status: number,
  fallback: ContentfulStatusCode = 500
): ContentfulStatusCode {
  if (status >= 400 && status <= 599) {
    return status as ContentfulStatusCode;
  }
  return fallback;
}

export function errorHandler(err: Error | HTTPException, c: Context) {
  // The wide event middleware will log the error with full context
  // Here we just enrich the event with additional error details
  try {
    const event = getWideEvent(c);
    event.setError(err);
  } catch {
    // Wide event middleware may not be installed for some routes
  }

  if (err instanceof AppError) {
    return c.json({
      error: err.code || err.name,
      message: err.message,
      requestId: c.get("requestId"),
    }, toContentfulStatusCode(err.statusCode));
  }

  // Handle Hono HTTP exceptions
  if ("status" in err && typeof err.status === "number") {
    return c.json({
      error: "HTTP_ERROR",
      message: err.message,
      requestId: c.get("requestId"),
    }, toContentfulStatusCode(err.status));
  }

  // Internal server error
  return c.json(
    {
      error: "INTERNAL_ERROR",
      message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
      requestId: c.get("requestId"),
    },
    500
  );
}
