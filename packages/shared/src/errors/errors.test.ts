import { describe, it, expect } from "bun:test";
import {
  // Enums and constants
  ErrorCategory,
  ErrorCode,
  ERROR_RETRYABILITY,
  ERROR_CATEGORIES,
  // Base class
  IngestionError,
  // Specific error classes
  NetworkError,
  ServiceError,
  ContentError,
  ConfigurationError,
  NotFoundError,
  ValidationError,
  AuthError,
  SystemError,
  // Utility functions
  isRetryableError,
  classifyHttpStatus,
  classifyError,
  getErrorInfo,
  createHttpError,
} from "./index";

// ============================================================================
// ErrorCategory Tests
// ============================================================================

describe("ErrorCategory", () => {
  it("should define all expected categories", () => {
    expect(ErrorCategory.NETWORK).toBe("network");
    expect(ErrorCategory.SERVICE).toBe("service");
    expect(ErrorCategory.CONTENT).toBe("content");
    expect(ErrorCategory.CONFIGURATION).toBe("configuration");
    expect(ErrorCategory.NOT_FOUND).toBe("not_found");
    expect(ErrorCategory.VALIDATION).toBe("validation");
    expect(ErrorCategory.AUTH).toBe("auth");
    expect(ErrorCategory.SYSTEM).toBe("system");
    expect(ErrorCategory.UNKNOWN).toBe("unknown");
  });

  it("should have exactly 9 categories", () => {
    expect(Object.keys(ErrorCategory)).toHaveLength(9);
  });
});

// ============================================================================
// ErrorCode Tests
// ============================================================================

describe("ErrorCode", () => {
  it("should define network error codes", () => {
    expect(ErrorCode.NETWORK_TIMEOUT).toBe("NETWORK_TIMEOUT");
    expect(ErrorCode.NETWORK_CONNECTION_REFUSED).toBe("NETWORK_CONNECTION_REFUSED");
    expect(ErrorCode.NETWORK_DNS_FAILURE).toBe("NETWORK_DNS_FAILURE");
    expect(ErrorCode.NETWORK_RESET).toBe("NETWORK_RESET");
    expect(ErrorCode.NETWORK_SSL_ERROR).toBe("NETWORK_SSL_ERROR");
  });

  it("should define service error codes", () => {
    expect(ErrorCode.SERVICE_UNAVAILABLE).toBe("SERVICE_UNAVAILABLE");
    expect(ErrorCode.SERVICE_RATE_LIMITED).toBe("SERVICE_RATE_LIMITED");
    expect(ErrorCode.SERVICE_TIMEOUT).toBe("SERVICE_TIMEOUT");
    expect(ErrorCode.SERVICE_BAD_GATEWAY).toBe("SERVICE_BAD_GATEWAY");
    expect(ErrorCode.SERVICE_GATEWAY_TIMEOUT).toBe("SERVICE_GATEWAY_TIMEOUT");
    expect(ErrorCode.SERVICE_OVERLOADED).toBe("SERVICE_OVERLOADED");
    expect(ErrorCode.SERVICE_API_ERROR).toBe("SERVICE_API_ERROR");
  });

  it("should define content error codes", () => {
    expect(ErrorCode.CONTENT_TOO_LARGE).toBe("CONTENT_TOO_LARGE");
    expect(ErrorCode.CONTENT_INVALID_FORMAT).toBe("CONTENT_INVALID_FORMAT");
    expect(ErrorCode.CONTENT_EMPTY).toBe("CONTENT_EMPTY");
    expect(ErrorCode.CONTENT_UNSUPPORTED_TYPE).toBe("CONTENT_UNSUPPORTED_TYPE");
    expect(ErrorCode.CONTENT_PARSE_FAILED).toBe("CONTENT_PARSE_FAILED");
    expect(ErrorCode.CONTENT_ENCODING_ERROR).toBe("CONTENT_ENCODING_ERROR");
  });

  it("should define configuration error codes", () => {
    expect(ErrorCode.CONFIG_MISSING).toBe("CONFIG_MISSING");
    expect(ErrorCode.CONFIG_INVALID).toBe("CONFIG_INVALID");
    expect(ErrorCode.CONFIG_API_KEY_MISSING).toBe("CONFIG_API_KEY_MISSING");
    expect(ErrorCode.CONFIG_MODEL_MISMATCH).toBe("CONFIG_MODEL_MISMATCH");
    expect(ErrorCode.CONFIG_DIMENSION_MISMATCH).toBe("CONFIG_DIMENSION_MISMATCH");
  });

  it("should define not found error codes", () => {
    expect(ErrorCode.NOT_FOUND_RESOURCE).toBe("NOT_FOUND_RESOURCE");
    expect(ErrorCode.NOT_FOUND_URL).toBe("NOT_FOUND_URL");
    expect(ErrorCode.NOT_FOUND_KB).toBe("NOT_FOUND_KB");
    expect(ErrorCode.NOT_FOUND_SOURCE).toBe("NOT_FOUND_SOURCE");
    expect(ErrorCode.NOT_FOUND_RUN).toBe("NOT_FOUND_RUN");
    expect(ErrorCode.NOT_FOUND_CHUNK).toBe("NOT_FOUND_CHUNK");
  });

  it("should define validation error codes", () => {
    expect(ErrorCode.VALIDATION_SCHEMA).toBe("VALIDATION_SCHEMA");
    expect(ErrorCode.VALIDATION_URL_INVALID).toBe("VALIDATION_URL_INVALID");
    expect(ErrorCode.VALIDATION_CONSTRAINT).toBe("VALIDATION_CONSTRAINT");
    expect(ErrorCode.VALIDATION_PAYLOAD).toBe("VALIDATION_PAYLOAD");
  });

  it("should define auth error codes", () => {
    expect(ErrorCode.AUTH_FORBIDDEN).toBe("AUTH_FORBIDDEN");
    expect(ErrorCode.AUTH_UNAUTHORIZED).toBe("AUTH_UNAUTHORIZED");
    expect(ErrorCode.AUTH_BLOCKED).toBe("AUTH_BLOCKED");
  });

  it("should define system error codes", () => {
    expect(ErrorCode.SYSTEM_OUT_OF_MEMORY).toBe("SYSTEM_OUT_OF_MEMORY");
    expect(ErrorCode.SYSTEM_DISK_FULL).toBe("SYSTEM_DISK_FULL");
    expect(ErrorCode.SYSTEM_INTERNAL).toBe("SYSTEM_INTERNAL");
    expect(ErrorCode.SYSTEM_DATABASE_ERROR).toBe("SYSTEM_DATABASE_ERROR");
  });

  it("should define unknown error code", () => {
    expect(ErrorCode.UNKNOWN_ERROR).toBe("UNKNOWN_ERROR");
  });
});

// ============================================================================
// ERROR_RETRYABILITY Tests
// ============================================================================

describe("ERROR_RETRYABILITY", () => {
  it("should have an entry for every ErrorCode", () => {
    const errorCodes = Object.values(ErrorCode);
    for (const code of errorCodes) {
      expect(ERROR_RETRYABILITY).toHaveProperty(code);
      expect(typeof ERROR_RETRYABILITY[code]).toBe("boolean");
    }
  });

  it("should mark network errors (except SSL) as retryable", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.NETWORK_TIMEOUT]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.NETWORK_CONNECTION_REFUSED]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.NETWORK_DNS_FAILURE]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.NETWORK_RESET]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.NETWORK_SSL_ERROR]).toBe(false);
  });

  it("should mark service errors (except API error) as retryable", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.SERVICE_UNAVAILABLE]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.SERVICE_RATE_LIMITED]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.SERVICE_TIMEOUT]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.SERVICE_BAD_GATEWAY]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.SERVICE_GATEWAY_TIMEOUT]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.SERVICE_OVERLOADED]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.SERVICE_API_ERROR]).toBe(false);
  });

  it("should mark content errors as permanent", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.CONTENT_TOO_LARGE]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONTENT_INVALID_FORMAT]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONTENT_EMPTY]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONTENT_UNSUPPORTED_TYPE]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONTENT_PARSE_FAILED]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONTENT_ENCODING_ERROR]).toBe(false);
  });

  it("should mark configuration errors as permanent", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.CONFIG_MISSING]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONFIG_INVALID]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONFIG_API_KEY_MISSING]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONFIG_MODEL_MISMATCH]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.CONFIG_DIMENSION_MISMATCH]).toBe(false);
  });

  it("should mark not found errors as permanent", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.NOT_FOUND_RESOURCE]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.NOT_FOUND_URL]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.NOT_FOUND_KB]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.NOT_FOUND_SOURCE]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.NOT_FOUND_RUN]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.NOT_FOUND_CHUNK]).toBe(false);
  });

  it("should mark validation errors as permanent", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.VALIDATION_SCHEMA]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.VALIDATION_URL_INVALID]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.VALIDATION_CONSTRAINT]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.VALIDATION_PAYLOAD]).toBe(false);
  });

  it("should mark auth errors as permanent", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.AUTH_FORBIDDEN]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.AUTH_UNAUTHORIZED]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.AUTH_BLOCKED]).toBe(false);
  });

  it("should mark some system errors as retryable", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.SYSTEM_OUT_OF_MEMORY]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.SYSTEM_DISK_FULL]).toBe(false);
    expect(ERROR_RETRYABILITY[ErrorCode.SYSTEM_INTERNAL]).toBe(true);
    expect(ERROR_RETRYABILITY[ErrorCode.SYSTEM_DATABASE_ERROR]).toBe(true);
  });

  it("should mark unknown errors as retryable (conservative)", () => {
    expect(ERROR_RETRYABILITY[ErrorCode.UNKNOWN_ERROR]).toBe(true);
  });
});

// ============================================================================
// ERROR_CATEGORIES Tests
// ============================================================================

describe("ERROR_CATEGORIES", () => {
  it("should have an entry for every ErrorCode", () => {
    const errorCodes = Object.values(ErrorCode);
    for (const code of errorCodes) {
      expect(ERROR_CATEGORIES).toHaveProperty(code);
      expect(Object.values(ErrorCategory)).toContain(ERROR_CATEGORIES[code]);
    }
  });

  it("should map network codes to NETWORK category", () => {
    expect(ERROR_CATEGORIES[ErrorCode.NETWORK_TIMEOUT]).toBe(ErrorCategory.NETWORK);
    expect(ERROR_CATEGORIES[ErrorCode.NETWORK_CONNECTION_REFUSED]).toBe(ErrorCategory.NETWORK);
    expect(ERROR_CATEGORIES[ErrorCode.NETWORK_DNS_FAILURE]).toBe(ErrorCategory.NETWORK);
    expect(ERROR_CATEGORIES[ErrorCode.NETWORK_RESET]).toBe(ErrorCategory.NETWORK);
    expect(ERROR_CATEGORIES[ErrorCode.NETWORK_SSL_ERROR]).toBe(ErrorCategory.NETWORK);
  });

  it("should map service codes to SERVICE category", () => {
    expect(ERROR_CATEGORIES[ErrorCode.SERVICE_UNAVAILABLE]).toBe(ErrorCategory.SERVICE);
    expect(ERROR_CATEGORIES[ErrorCode.SERVICE_RATE_LIMITED]).toBe(ErrorCategory.SERVICE);
    expect(ERROR_CATEGORIES[ErrorCode.SERVICE_TIMEOUT]).toBe(ErrorCategory.SERVICE);
    expect(ERROR_CATEGORIES[ErrorCode.SERVICE_BAD_GATEWAY]).toBe(ErrorCategory.SERVICE);
    expect(ERROR_CATEGORIES[ErrorCode.SERVICE_GATEWAY_TIMEOUT]).toBe(ErrorCategory.SERVICE);
    expect(ERROR_CATEGORIES[ErrorCode.SERVICE_OVERLOADED]).toBe(ErrorCategory.SERVICE);
    expect(ERROR_CATEGORIES[ErrorCode.SERVICE_API_ERROR]).toBe(ErrorCategory.SERVICE);
  });

  it("should map content codes to CONTENT category", () => {
    expect(ERROR_CATEGORIES[ErrorCode.CONTENT_TOO_LARGE]).toBe(ErrorCategory.CONTENT);
    expect(ERROR_CATEGORIES[ErrorCode.CONTENT_INVALID_FORMAT]).toBe(ErrorCategory.CONTENT);
    expect(ERROR_CATEGORIES[ErrorCode.CONTENT_EMPTY]).toBe(ErrorCategory.CONTENT);
    expect(ERROR_CATEGORIES[ErrorCode.CONTENT_UNSUPPORTED_TYPE]).toBe(ErrorCategory.CONTENT);
    expect(ERROR_CATEGORIES[ErrorCode.CONTENT_PARSE_FAILED]).toBe(ErrorCategory.CONTENT);
    expect(ERROR_CATEGORIES[ErrorCode.CONTENT_ENCODING_ERROR]).toBe(ErrorCategory.CONTENT);
  });
});

// ============================================================================
// IngestionError Tests
// ============================================================================

describe("IngestionError", () => {
  it("should create an error with required properties", () => {
    const error = new IngestionError(ErrorCode.NETWORK_TIMEOUT, "Connection timed out");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("IngestionError");
    expect(error.code).toBe(ErrorCode.NETWORK_TIMEOUT);
    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.message).toBe("Connection timed out");
    expect(error.retryable).toBe(true);
  });

  it("should support cause option", () => {
    const cause = new Error("Original error");
    const error = new IngestionError(ErrorCode.SERVICE_UNAVAILABLE, "Service down", { cause });

    expect(error.cause).toBe(cause);
  });

  it("should support metadata option", () => {
    const metadata = { url: "https://example.com", attempts: 3 };
    const error = new IngestionError(ErrorCode.NETWORK_TIMEOUT, "Timeout", { metadata });

    expect(error.metadata).toEqual(metadata);
  });

  it("should support httpStatus option", () => {
    const error = new IngestionError(ErrorCode.SERVICE_UNAVAILABLE, "Service down", { httpStatus: 503 });

    expect(error.httpStatus).toBe(503);
  });

  it("should support retryableOverride option", () => {
    // Default is retryable
    const retryableError = new IngestionError(ErrorCode.NETWORK_TIMEOUT, "Timeout");
    expect(retryableError.retryable).toBe(true);

    // Override to not retryable
    const notRetryableError = new IngestionError(ErrorCode.NETWORK_TIMEOUT, "Timeout", { retryableOverride: false });
    expect(notRetryableError.retryable).toBe(false);
  });

  it("should serialize to JSON correctly", () => {
    const cause = new Error("Original");
    const error = new IngestionError(ErrorCode.CONTENT_TOO_LARGE, "Content exceeds limit", {
      cause,
      metadata: { sizeBytes: 1000000 },
      httpStatus: 413,
    });

    const json = error.toJSON();

    expect(json.name).toBe("IngestionError");
    expect(json.code).toBe(ErrorCode.CONTENT_TOO_LARGE);
    expect(json.category).toBe(ErrorCategory.CONTENT);
    expect(json.message).toBe("Content exceeds limit");
    expect(json.retryable).toBe(false);
    expect(json.httpStatus).toBe(413);
    expect(json.metadata).toEqual({ sizeBytes: 1000000 });
    expect(json.cause).toBe("Original");
    expect(json.stack).toBeDefined();
  });
});

// ============================================================================
// Specific Error Classes Tests
// ============================================================================

describe("NetworkError", () => {
  it("should create a network error", () => {
    const error = new NetworkError(ErrorCode.NETWORK_TIMEOUT, "Request timed out");

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("NetworkError");
    expect(error.code).toBe(ErrorCode.NETWORK_TIMEOUT);
    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.retryable).toBe(true);
  });

  it("should create SSL error as not retryable", () => {
    const error = new NetworkError(ErrorCode.NETWORK_SSL_ERROR, "Certificate error");

    expect(error.retryable).toBe(false);
  });
});

describe("ServiceError", () => {
  it("should create a service error", () => {
    const error = new ServiceError(ErrorCode.SERVICE_RATE_LIMITED, "Too many requests", {
      httpStatus: 429,
      retryAfter: 60,
    });

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("ServiceError");
    expect(error.code).toBe(ErrorCode.SERVICE_RATE_LIMITED);
    expect(error.httpStatus).toBe(429);
    expect(error.metadata?.retryAfter).toBe(60);
  });
});

describe("ContentError", () => {
  it("should create a content error", () => {
    const error = new ContentError(ErrorCode.CONTENT_TOO_LARGE, "File exceeds 10MB limit");

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("ContentError");
    expect(error.code).toBe(ErrorCode.CONTENT_TOO_LARGE);
    expect(error.category).toBe(ErrorCategory.CONTENT);
    expect(error.retryable).toBe(false);
  });
});

describe("ConfigurationError", () => {
  it("should create a configuration error", () => {
    const error = new ConfigurationError(ErrorCode.CONFIG_API_KEY_MISSING, "OpenAI API key not set");

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("ConfigurationError");
    expect(error.code).toBe(ErrorCode.CONFIG_API_KEY_MISSING);
    expect(error.category).toBe(ErrorCategory.CONFIGURATION);
    expect(error.retryable).toBe(false);
  });
});

describe("NotFoundError", () => {
  it("should create a not found error with 404 status", () => {
    const error = new NotFoundError(ErrorCode.NOT_FOUND_KB, "Knowledge base not found");

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("NotFoundError");
    expect(error.httpStatus).toBe(404);
    expect(error.retryable).toBe(false);
  });
});

describe("ValidationError", () => {
  it("should create a validation error with 400 status", () => {
    const error = new ValidationError(ErrorCode.VALIDATION_URL_INVALID, "Invalid URL format");

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("ValidationError");
    expect(error.httpStatus).toBe(400);
    expect(error.retryable).toBe(false);
  });
});

describe("AuthError", () => {
  it("should create unauthorized error with 401 status", () => {
    const error = new AuthError(ErrorCode.AUTH_UNAUTHORIZED, "Invalid token");

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("AuthError");
    expect(error.httpStatus).toBe(401);
    expect(error.retryable).toBe(false);
  });

  it("should create forbidden error with 403 status", () => {
    const error = new AuthError(ErrorCode.AUTH_FORBIDDEN, "Access denied");

    expect(error.httpStatus).toBe(403);
  });
});

describe("SystemError", () => {
  it("should create a system error with 500 status", () => {
    const error = new SystemError(ErrorCode.SYSTEM_DATABASE_ERROR, "Connection pool exhausted");

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.name).toBe("SystemError");
    expect(error.httpStatus).toBe(500);
    expect(error.retryable).toBe(true); // Database errors are retryable
  });
});

// ============================================================================
// isRetryableError Tests
// ============================================================================

describe("isRetryableError", () => {
  it("should return true for retryable IngestionErrors", () => {
    const error = new NetworkError(ErrorCode.NETWORK_TIMEOUT, "Timeout");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return false for non-retryable IngestionErrors", () => {
    const error = new ContentError(ErrorCode.CONTENT_TOO_LARGE, "Too large");
    expect(isRetryableError(error)).toBe(false);
  });

  it("should classify generic timeout errors as retryable", () => {
    const error = new Error("Request timeout after 30000ms");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should classify connection reset errors as retryable", () => {
    const error = new Error("ECONNRESET: Connection reset by peer");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should classify rate limit errors as retryable", () => {
    const error = new Error("Rate limit exceeded");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should classify 503 errors as retryable", () => {
    const error = new Error("503 Service Unavailable");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should classify database pool errors as retryable", () => {
    const error = new Error("Connection pool exhausted");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should default to true for unknown errors", () => {
    const error = new Error("Something went wrong");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for non-Error values", () => {
    expect(isRetryableError("string error")).toBe(true);
    expect(isRetryableError({ message: "object error" })).toBe(true);
  });
});

// ============================================================================
// classifyHttpStatus Tests
// ============================================================================

describe("classifyHttpStatus", () => {
  it("should classify 400 as VALIDATION_PAYLOAD", () => {
    expect(classifyHttpStatus(400)).toBe(ErrorCode.VALIDATION_PAYLOAD);
  });

  it("should classify 401 as AUTH_UNAUTHORIZED", () => {
    expect(classifyHttpStatus(401)).toBe(ErrorCode.AUTH_UNAUTHORIZED);
  });

  it("should classify 403 as AUTH_FORBIDDEN", () => {
    expect(classifyHttpStatus(403)).toBe(ErrorCode.AUTH_FORBIDDEN);
  });

  it("should classify 404 as NOT_FOUND_URL", () => {
    expect(classifyHttpStatus(404)).toBe(ErrorCode.NOT_FOUND_URL);
  });

  it("should classify 429 as SERVICE_RATE_LIMITED", () => {
    expect(classifyHttpStatus(429)).toBe(ErrorCode.SERVICE_RATE_LIMITED);
  });

  it("should classify 500 as SYSTEM_INTERNAL", () => {
    expect(classifyHttpStatus(500)).toBe(ErrorCode.SYSTEM_INTERNAL);
  });

  it("should classify 502 as SERVICE_BAD_GATEWAY", () => {
    expect(classifyHttpStatus(502)).toBe(ErrorCode.SERVICE_BAD_GATEWAY);
  });

  it("should classify 503 as SERVICE_UNAVAILABLE", () => {
    expect(classifyHttpStatus(503)).toBe(ErrorCode.SERVICE_UNAVAILABLE);
  });

  it("should classify 504 as SERVICE_GATEWAY_TIMEOUT", () => {
    expect(classifyHttpStatus(504)).toBe(ErrorCode.SERVICE_GATEWAY_TIMEOUT);
  });

  it("should classify other 4xx as SERVICE_API_ERROR", () => {
    expect(classifyHttpStatus(405)).toBe(ErrorCode.SERVICE_API_ERROR);
    expect(classifyHttpStatus(415)).toBe(ErrorCode.SERVICE_API_ERROR);
    expect(classifyHttpStatus(422)).toBe(ErrorCode.SERVICE_API_ERROR);
  });

  it("should classify other 5xx as SERVICE_UNAVAILABLE", () => {
    expect(classifyHttpStatus(501)).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(classifyHttpStatus(507)).toBe(ErrorCode.SERVICE_UNAVAILABLE);
  });

  it("should classify 2xx as UNKNOWN_ERROR", () => {
    expect(classifyHttpStatus(200)).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(classifyHttpStatus(201)).toBe(ErrorCode.UNKNOWN_ERROR);
  });
});

// ============================================================================
// classifyError Tests
// ============================================================================

describe("classifyError", () => {
  it("should return IngestionError unchanged", () => {
    const original = new NetworkError(ErrorCode.NETWORK_TIMEOUT, "Timeout");
    const classified = classifyError(original);

    expect(classified).toBe(original);
  });

  it("should classify timeout errors as NETWORK_TIMEOUT", () => {
    const error = new Error("Request timed out");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.NETWORK_TIMEOUT);
    expect(classified.retryable).toBe(true);
    expect(classified.cause).toBe(error);
  });

  it("should classify ECONNREFUSED as NETWORK_CONNECTION_REFUSED", () => {
    const error = new Error("ECONNREFUSED: Connection refused");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.NETWORK_CONNECTION_REFUSED);
  });

  it("should classify DNS errors as NETWORK_DNS_FAILURE", () => {
    const error = new Error("ENOTFOUND: DNS lookup failed");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.NETWORK_DNS_FAILURE);
  });

  it("should classify ECONNRESET as NETWORK_RESET", () => {
    const error = new Error("ECONNRESET: Socket hang up");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.NETWORK_RESET);
  });

  it("should classify SSL errors as NETWORK_SSL_ERROR", () => {
    const error = new Error("SSL certificate error");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.NETWORK_SSL_ERROR);
    expect(classified.retryable).toBe(false);
  });

  it("should classify rate limit errors as SERVICE_RATE_LIMITED", () => {
    const error = new Error("Rate limit exceeded");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.SERVICE_RATE_LIMITED);
  });

  it("should classify 503 errors as SERVICE_UNAVAILABLE", () => {
    const error = new Error("503 Service Unavailable");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
  });

  it("should classify too large errors as CONTENT_TOO_LARGE", () => {
    const error = new Error("Payload too large: exceeds maximum");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.CONTENT_TOO_LARGE);
    expect(classified.retryable).toBe(false);
  });

  it("should classify parse errors as CONTENT_PARSE_FAILED", () => {
    const error = new Error("JSON parse error: syntax error");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.CONTENT_PARSE_FAILED);
  });

  it("should classify API key errors as CONFIG_API_KEY_MISSING", () => {
    const error = new Error("API key not provided");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.CONFIG_API_KEY_MISSING);
  });

  it("should classify dimension mismatch errors as CONFIG_DIMENSION_MISMATCH", () => {
    const error = new Error("Embedding dimension mismatch: expected 1536, got 768");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.CONFIG_DIMENSION_MISMATCH);
  });

  it("should classify not found errors as NOT_FOUND_RESOURCE", () => {
    const error = new Error("Resource not found");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.NOT_FOUND_RESOURCE);
  });

  it("should classify database errors as SYSTEM_DATABASE_ERROR", () => {
    const error = new Error("PostgreSQL connection failed");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.SYSTEM_DATABASE_ERROR);
  });

  it("should classify memory errors as SYSTEM_OUT_OF_MEMORY", () => {
    const error = new Error("JavaScript heap out of memory");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.SYSTEM_OUT_OF_MEMORY);
  });

  it("should classify unknown errors as UNKNOWN_ERROR", () => {
    const error = new Error("Something strange happened");
    const classified = classifyError(error);

    expect(classified.code).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(classified.retryable).toBe(true);
  });

  it("should handle non-Error values", () => {
    const classified = classifyError("string error");

    expect(classified.code).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(classified.message).toBe("string error");
    expect(classified.cause).toBeUndefined();
  });

  it("should use default message for undefined errors", () => {
    const classified = classifyError(undefined, "Default error message");

    expect(classified.message).toBe("Default error message");
  });
});

// ============================================================================
// getErrorInfo Tests
// ============================================================================

describe("getErrorInfo", () => {
  it("should extract error info from IngestionError", () => {
    const cause = new Error("Root cause");
    const error = new NetworkError(ErrorCode.NETWORK_TIMEOUT, "Connection timed out", { cause });
    const info = getErrorInfo(error);

    expect(info).toEqual({
      code: ErrorCode.NETWORK_TIMEOUT,
      category: ErrorCategory.NETWORK,
      message: "Connection timed out",
      retryable: true,
      cause: "Root cause",
    });
  });

  it("should classify and extract info from generic Error", () => {
    const error = new Error("ECONNRESET");
    const info = getErrorInfo(error);

    expect(info.code).toBe(ErrorCode.NETWORK_RESET);
    expect(info.category).toBe(ErrorCategory.NETWORK);
    expect(info.retryable).toBe(true);
  });

  it("should handle errors without cause", () => {
    const error = new ContentError(ErrorCode.CONTENT_EMPTY, "Empty content");
    const info = getErrorInfo(error);

    expect(info.cause).toBeUndefined();
  });
});

// ============================================================================
// createHttpError Tests
// ============================================================================

describe("createHttpError", () => {
  it("should create ServiceError for 503", () => {
    const error = createHttpError(503, "Service temporarily unavailable");

    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(error.httpStatus).toBe(503);
    expect(error.retryable).toBe(true);
  });

  it("should create AuthError for 401", () => {
    const error = createHttpError(401, "Unauthorized");

    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe(ErrorCode.AUTH_UNAUTHORIZED);
    expect(error.httpStatus).toBe(401);
    expect(error.retryable).toBe(false);
  });

  it("should create NotFoundError for 404", () => {
    const error = createHttpError(404, "Not found");

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.code).toBe(ErrorCode.NOT_FOUND_URL);
  });

  it("should create ValidationError for 400", () => {
    const error = createHttpError(400, "Bad request");

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe(ErrorCode.VALIDATION_PAYLOAD);
  });

  it("should create IngestionError for unknown status codes", () => {
    const error = createHttpError(200, "Unexpected success");

    expect(error).toBeInstanceOf(IngestionError);
    expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(error.httpStatus).toBe(200);
  });

  it("should preserve cause and metadata", () => {
    const cause = new Error("Original error");
    const error = createHttpError(502, "Bad gateway", {
      cause,
      metadata: { upstream: "api.example.com" },
    });

    expect(error.cause).toBe(cause);
    expect(error.metadata).toEqual({ upstream: "api.example.com" });
  });
});
