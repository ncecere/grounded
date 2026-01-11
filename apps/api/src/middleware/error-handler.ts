import type { Context } from "hono";
import type { HTTPException } from "hono/http-exception";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, "NOT_FOUND");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message, "BAD_REQUEST");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, "CONFLICT");
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super(429, `Rate limit exceeded. Retry after ${retryAfter} seconds`, "RATE_LIMITED");
  }
}

export class QuotaExceededError extends AppError {
  constructor(resource: string) {
    super(402, `Quota exceeded for ${resource}`, "QUOTA_EXCEEDED");
  }
}

export function errorHandler(err: Error | HTTPException, c: Context) {
  console.error(`[${c.get("requestId")}] Error:`, err);

  if (err instanceof AppError) {
    return c.json(
      {
        error: err.code || err.name,
        message: err.message,
        requestId: c.get("requestId"),
      },
      err.statusCode as any
    );
  }

  // Handle Hono HTTP exceptions
  if ("status" in err && typeof err.status === "number") {
    return c.json(
      {
        error: "HTTP_ERROR",
        message: err.message,
        requestId: c.get("requestId"),
      },
      err.status as any
    );
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
