import { describe, expect, it } from "bun:test";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
  RateLimitError,
  QuotaExceededError,
} from "./http";

describe("AppError", () => {
  it("stores status code and error code", () => {
    const error = new AppError(418, "Teapot", "TEAPOT");

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(418);
    expect(error.message).toBe("Teapot");
    expect(error.code).toBe("TEAPOT");
    expect(error.name).toBe("AppError");
  });
});

describe("HTTP errors", () => {
  it("creates not found errors", () => {
    const error = new NotFoundError("Widget");

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Widget not found");
  });

  it("creates unauthorized errors with a default message", () => {
    const error = new UnauthorizedError();

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.message).toBe("Unauthorized");
  });

  it("creates forbidden errors", () => {
    const error = new ForbiddenError();

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toBe("Forbidden");
  });

  it("creates bad request errors", () => {
    const error = new BadRequestError("Invalid payload");

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toBe("Invalid payload");
  });

  it("creates conflict errors", () => {
    const error = new ConflictError("Already exists");

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("Already exists");
  });

  it("creates rate limit errors with retry information", () => {
    const error = new RateLimitError(30);

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toBe("Rate limit exceeded. Retry after 30 seconds");
  });

  it("creates quota exceeded errors", () => {
    const error = new QuotaExceededError("agents");

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(402);
    expect(error.code).toBe("QUOTA_EXCEEDED");
    expect(error.message).toBe("Quota exceeded for agents");
  });
});
