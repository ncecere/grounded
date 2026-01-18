/**
 * Error Taxonomy for Ingestion Pipeline
 *
 * This module defines a comprehensive error classification system with
 * retryable vs permanent error categories. The taxonomy enables:
 * - Intelligent retry decisions based on error type
 * - Proper stage status tracking (failed_retryable vs failed_permanent)
 * - Structured error logging with codes and categories
 * - Error-specific retry strategies
 */

// ============================================================================
// Error Categories
// ============================================================================

/**
 * Top-level error categories for classification.
 */
export const ErrorCategory = {
  /** Network-related errors (typically retryable) */
  NETWORK: "network",
  /** External service errors (rate limits, timeouts, availability) */
  SERVICE: "service",
  /** Content-related errors (invalid format, size limits) */
  CONTENT: "content",
  /** Configuration errors (missing settings, invalid config) */
  CONFIGURATION: "configuration",
  /** Resource not found errors */
  NOT_FOUND: "not_found",
  /** Validation errors (schema violations, constraint failures) */
  VALIDATION: "validation",
  /** Authentication/authorization errors */
  AUTH: "auth",
  /** System/infrastructure errors */
  SYSTEM: "system",
  /** Unknown/unclassified errors */
  UNKNOWN: "unknown",
} as const;
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Standardized error codes for the ingestion pipeline.
 * Format: CATEGORY_SPECIFIC_DESCRIPTION
 */
export const ErrorCode = {
  // Network errors
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  NETWORK_CONNECTION_REFUSED: "NETWORK_CONNECTION_REFUSED",
  NETWORK_DNS_FAILURE: "NETWORK_DNS_FAILURE",
  NETWORK_RESET: "NETWORK_RESET",
  NETWORK_SSL_ERROR: "NETWORK_SSL_ERROR",

  // Service errors
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  SERVICE_RATE_LIMITED: "SERVICE_RATE_LIMITED",
  SERVICE_TIMEOUT: "SERVICE_TIMEOUT",
  SERVICE_BAD_GATEWAY: "SERVICE_BAD_GATEWAY",
  SERVICE_GATEWAY_TIMEOUT: "SERVICE_GATEWAY_TIMEOUT",
  SERVICE_OVERLOADED: "SERVICE_OVERLOADED",
  SERVICE_API_ERROR: "SERVICE_API_ERROR",

  // Content errors
  CONTENT_TOO_LARGE: "CONTENT_TOO_LARGE",
  CONTENT_INVALID_FORMAT: "CONTENT_INVALID_FORMAT",
  CONTENT_EMPTY: "CONTENT_EMPTY",
  CONTENT_UNSUPPORTED_TYPE: "CONTENT_UNSUPPORTED_TYPE",
  CONTENT_PARSE_FAILED: "CONTENT_PARSE_FAILED",
  CONTENT_ENCODING_ERROR: "CONTENT_ENCODING_ERROR",

  // Configuration errors
  CONFIG_MISSING: "CONFIG_MISSING",
  CONFIG_INVALID: "CONFIG_INVALID",
  CONFIG_API_KEY_MISSING: "CONFIG_API_KEY_MISSING",
  CONFIG_MODEL_MISMATCH: "CONFIG_MODEL_MISMATCH",
  CONFIG_DIMENSION_MISMATCH: "CONFIG_DIMENSION_MISMATCH",

  // Not found errors
  NOT_FOUND_RESOURCE: "NOT_FOUND_RESOURCE",
  NOT_FOUND_URL: "NOT_FOUND_URL",
  NOT_FOUND_KB: "NOT_FOUND_KB",
  NOT_FOUND_SOURCE: "NOT_FOUND_SOURCE",
  NOT_FOUND_RUN: "NOT_FOUND_RUN",
  NOT_FOUND_CHUNK: "NOT_FOUND_CHUNK",

  // Validation errors
  VALIDATION_SCHEMA: "VALIDATION_SCHEMA",
  VALIDATION_URL_INVALID: "VALIDATION_URL_INVALID",
  VALIDATION_CONSTRAINT: "VALIDATION_CONSTRAINT",
  VALIDATION_PAYLOAD: "VALIDATION_PAYLOAD",

  // Auth errors
  AUTH_FORBIDDEN: "AUTH_FORBIDDEN",
  AUTH_UNAUTHORIZED: "AUTH_UNAUTHORIZED",
  AUTH_BLOCKED: "AUTH_BLOCKED",

  // System errors
  SYSTEM_OUT_OF_MEMORY: "SYSTEM_OUT_OF_MEMORY",
  SYSTEM_DISK_FULL: "SYSTEM_DISK_FULL",
  SYSTEM_INTERNAL: "SYSTEM_INTERNAL",
  SYSTEM_DATABASE_ERROR: "SYSTEM_DATABASE_ERROR",

  // Unknown errors
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ============================================================================
// Retryability Classification
// ============================================================================

/**
 * Map of error codes to their retryability.
 * true = retryable, false = permanent
 */
export const ERROR_RETRYABILITY: Record<ErrorCode, boolean> = {
  // Network errors - typically retryable
  [ErrorCode.NETWORK_TIMEOUT]: true,
  [ErrorCode.NETWORK_CONNECTION_REFUSED]: true,
  [ErrorCode.NETWORK_DNS_FAILURE]: true,
  [ErrorCode.NETWORK_RESET]: true,
  [ErrorCode.NETWORK_SSL_ERROR]: false, // SSL errors are usually configuration issues

  // Service errors - mostly retryable
  [ErrorCode.SERVICE_UNAVAILABLE]: true,
  [ErrorCode.SERVICE_RATE_LIMITED]: true,
  [ErrorCode.SERVICE_TIMEOUT]: true,
  [ErrorCode.SERVICE_BAD_GATEWAY]: true,
  [ErrorCode.SERVICE_GATEWAY_TIMEOUT]: true,
  [ErrorCode.SERVICE_OVERLOADED]: true,
  [ErrorCode.SERVICE_API_ERROR]: false, // API errors are usually permanent (bad request)

  // Content errors - permanent (won't change on retry)
  [ErrorCode.CONTENT_TOO_LARGE]: false,
  [ErrorCode.CONTENT_INVALID_FORMAT]: false,
  [ErrorCode.CONTENT_EMPTY]: false,
  [ErrorCode.CONTENT_UNSUPPORTED_TYPE]: false,
  [ErrorCode.CONTENT_PARSE_FAILED]: false,
  [ErrorCode.CONTENT_ENCODING_ERROR]: false,

  // Configuration errors - permanent
  [ErrorCode.CONFIG_MISSING]: false,
  [ErrorCode.CONFIG_INVALID]: false,
  [ErrorCode.CONFIG_API_KEY_MISSING]: false,
  [ErrorCode.CONFIG_MODEL_MISMATCH]: false,
  [ErrorCode.CONFIG_DIMENSION_MISMATCH]: false,

  // Not found errors - permanent (resource doesn't exist)
  [ErrorCode.NOT_FOUND_RESOURCE]: false,
  [ErrorCode.NOT_FOUND_URL]: false,
  [ErrorCode.NOT_FOUND_KB]: false,
  [ErrorCode.NOT_FOUND_SOURCE]: false,
  [ErrorCode.NOT_FOUND_RUN]: false,
  [ErrorCode.NOT_FOUND_CHUNK]: false,

  // Validation errors - permanent
  [ErrorCode.VALIDATION_SCHEMA]: false,
  [ErrorCode.VALIDATION_URL_INVALID]: false,
  [ErrorCode.VALIDATION_CONSTRAINT]: false,
  [ErrorCode.VALIDATION_PAYLOAD]: false,

  // Auth errors - permanent
  [ErrorCode.AUTH_FORBIDDEN]: false,
  [ErrorCode.AUTH_UNAUTHORIZED]: false,
  [ErrorCode.AUTH_BLOCKED]: false,

  // System errors - some retryable
  [ErrorCode.SYSTEM_OUT_OF_MEMORY]: true, // May succeed after garbage collection
  [ErrorCode.SYSTEM_DISK_FULL]: false,
  [ErrorCode.SYSTEM_INTERNAL]: true, // Generic errors might be transient
  [ErrorCode.SYSTEM_DATABASE_ERROR]: true, // Database connection issues may be transient

  // Unknown errors - default to retryable (conservative approach)
  [ErrorCode.UNKNOWN_ERROR]: true,
};

/**
 * Map of error codes to their categories.
 */
export const ERROR_CATEGORIES: Record<ErrorCode, ErrorCategory> = {
  [ErrorCode.NETWORK_TIMEOUT]: ErrorCategory.NETWORK,
  [ErrorCode.NETWORK_CONNECTION_REFUSED]: ErrorCategory.NETWORK,
  [ErrorCode.NETWORK_DNS_FAILURE]: ErrorCategory.NETWORK,
  [ErrorCode.NETWORK_RESET]: ErrorCategory.NETWORK,
  [ErrorCode.NETWORK_SSL_ERROR]: ErrorCategory.NETWORK,

  [ErrorCode.SERVICE_UNAVAILABLE]: ErrorCategory.SERVICE,
  [ErrorCode.SERVICE_RATE_LIMITED]: ErrorCategory.SERVICE,
  [ErrorCode.SERVICE_TIMEOUT]: ErrorCategory.SERVICE,
  [ErrorCode.SERVICE_BAD_GATEWAY]: ErrorCategory.SERVICE,
  [ErrorCode.SERVICE_GATEWAY_TIMEOUT]: ErrorCategory.SERVICE,
  [ErrorCode.SERVICE_OVERLOADED]: ErrorCategory.SERVICE,
  [ErrorCode.SERVICE_API_ERROR]: ErrorCategory.SERVICE,

  [ErrorCode.CONTENT_TOO_LARGE]: ErrorCategory.CONTENT,
  [ErrorCode.CONTENT_INVALID_FORMAT]: ErrorCategory.CONTENT,
  [ErrorCode.CONTENT_EMPTY]: ErrorCategory.CONTENT,
  [ErrorCode.CONTENT_UNSUPPORTED_TYPE]: ErrorCategory.CONTENT,
  [ErrorCode.CONTENT_PARSE_FAILED]: ErrorCategory.CONTENT,
  [ErrorCode.CONTENT_ENCODING_ERROR]: ErrorCategory.CONTENT,

  [ErrorCode.CONFIG_MISSING]: ErrorCategory.CONFIGURATION,
  [ErrorCode.CONFIG_INVALID]: ErrorCategory.CONFIGURATION,
  [ErrorCode.CONFIG_API_KEY_MISSING]: ErrorCategory.CONFIGURATION,
  [ErrorCode.CONFIG_MODEL_MISMATCH]: ErrorCategory.CONFIGURATION,
  [ErrorCode.CONFIG_DIMENSION_MISMATCH]: ErrorCategory.CONFIGURATION,

  [ErrorCode.NOT_FOUND_RESOURCE]: ErrorCategory.NOT_FOUND,
  [ErrorCode.NOT_FOUND_URL]: ErrorCategory.NOT_FOUND,
  [ErrorCode.NOT_FOUND_KB]: ErrorCategory.NOT_FOUND,
  [ErrorCode.NOT_FOUND_SOURCE]: ErrorCategory.NOT_FOUND,
  [ErrorCode.NOT_FOUND_RUN]: ErrorCategory.NOT_FOUND,
  [ErrorCode.NOT_FOUND_CHUNK]: ErrorCategory.NOT_FOUND,

  [ErrorCode.VALIDATION_SCHEMA]: ErrorCategory.VALIDATION,
  [ErrorCode.VALIDATION_URL_INVALID]: ErrorCategory.VALIDATION,
  [ErrorCode.VALIDATION_CONSTRAINT]: ErrorCategory.VALIDATION,
  [ErrorCode.VALIDATION_PAYLOAD]: ErrorCategory.VALIDATION,

  [ErrorCode.AUTH_FORBIDDEN]: ErrorCategory.AUTH,
  [ErrorCode.AUTH_UNAUTHORIZED]: ErrorCategory.AUTH,
  [ErrorCode.AUTH_BLOCKED]: ErrorCategory.AUTH,

  [ErrorCode.SYSTEM_OUT_OF_MEMORY]: ErrorCategory.SYSTEM,
  [ErrorCode.SYSTEM_DISK_FULL]: ErrorCategory.SYSTEM,
  [ErrorCode.SYSTEM_INTERNAL]: ErrorCategory.SYSTEM,
  [ErrorCode.SYSTEM_DATABASE_ERROR]: ErrorCategory.SYSTEM,

  [ErrorCode.UNKNOWN_ERROR]: ErrorCategory.UNKNOWN,
};

// ============================================================================
// Base Ingestion Error Class
// ============================================================================

/**
 * Base error class for all ingestion pipeline errors.
 * Extends Error with structured metadata for classification and tracking.
 */
export class IngestionError extends Error {
  /** Error code for classification */
  public readonly code: ErrorCode;

  /** Error category for grouping */
  public readonly category: ErrorCategory;

  /** Whether this error is retryable */
  public readonly retryable: boolean;

  /** Original error that caused this error (if any) */
  public readonly cause?: Error;

  /** Additional context metadata */
  public readonly metadata?: Record<string, unknown>;

  /** HTTP status code (if applicable) */
  public readonly httpStatus?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      cause?: Error;
      metadata?: Record<string, unknown>;
      httpStatus?: number;
      /** Override default retryability for this error instance */
      retryableOverride?: boolean;
    }
  ) {
    super(message);
    this.name = "IngestionError";
    this.code = code;
    this.category = ERROR_CATEGORIES[code];
    this.retryable = options?.retryableOverride ?? ERROR_RETRYABILITY[code];
    this.cause = options?.cause;
    this.metadata = options?.metadata;
    this.httpStatus = options?.httpStatus;

    // Maintain proper stack trace for debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IngestionError);
    }
  }

  /**
   * Returns a structured object for logging.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      httpStatus: this.httpStatus,
      metadata: this.metadata,
      cause: this.cause?.message,
      stack: this.stack,
    };
  }
}

// ============================================================================
// Specific Error Classes
// ============================================================================

/**
 * Network-related errors (connection issues, timeouts, DNS failures).
 */
export class NetworkError extends IngestionError {
  constructor(
    code:
      | typeof ErrorCode.NETWORK_TIMEOUT
      | typeof ErrorCode.NETWORK_CONNECTION_REFUSED
      | typeof ErrorCode.NETWORK_DNS_FAILURE
      | typeof ErrorCode.NETWORK_RESET
      | typeof ErrorCode.NETWORK_SSL_ERROR,
    message: string,
    options?: { cause?: Error; metadata?: Record<string, unknown> }
  ) {
    super(code, message, options);
    this.name = "NetworkError";
  }
}

/**
 * External service errors (rate limits, unavailability, API errors).
 */
/** Valid error codes for ServiceError */
export type ServiceErrorCode =
  | typeof ErrorCode.SERVICE_UNAVAILABLE
  | typeof ErrorCode.SERVICE_RATE_LIMITED
  | typeof ErrorCode.SERVICE_TIMEOUT
  | typeof ErrorCode.SERVICE_BAD_GATEWAY
  | typeof ErrorCode.SERVICE_GATEWAY_TIMEOUT
  | typeof ErrorCode.SERVICE_OVERLOADED
  | typeof ErrorCode.SERVICE_API_ERROR;

export class ServiceError extends IngestionError {
  constructor(
    code: ServiceErrorCode,
    message: string,
    options?: {
      cause?: Error;
      metadata?: Record<string, unknown>;
      httpStatus?: number;
      /** Retry-After header value in seconds (for rate limiting) */
      retryAfter?: number;
    }
  ) {
    const metadata =
      options?.retryAfter !== undefined
        ? { ...options?.metadata, retryAfter: options.retryAfter }
        : options?.metadata;
    super(code, message, { ...options, metadata, httpStatus: options?.httpStatus });
    this.name = "ServiceError";
  }
}

/** Valid error codes for ContentError */
export type ContentErrorCode =
  | typeof ErrorCode.CONTENT_TOO_LARGE
  | typeof ErrorCode.CONTENT_INVALID_FORMAT
  | typeof ErrorCode.CONTENT_EMPTY
  | typeof ErrorCode.CONTENT_UNSUPPORTED_TYPE
  | typeof ErrorCode.CONTENT_PARSE_FAILED
  | typeof ErrorCode.CONTENT_ENCODING_ERROR;

/**
 * Content-related errors (format issues, size limits, parsing failures).
 */
export class ContentError extends IngestionError {
  constructor(
    code: ContentErrorCode,
    message: string,
    options?: { cause?: Error; metadata?: Record<string, unknown> }
  ) {
    super(code, message, options);
    this.name = "ContentError";
  }
}

/** Valid error codes for ConfigurationError */
export type ConfigurationErrorCode =
  | typeof ErrorCode.CONFIG_MISSING
  | typeof ErrorCode.CONFIG_INVALID
  | typeof ErrorCode.CONFIG_API_KEY_MISSING
  | typeof ErrorCode.CONFIG_MODEL_MISMATCH
  | typeof ErrorCode.CONFIG_DIMENSION_MISMATCH;

/**
 * Configuration errors (missing settings, invalid configuration).
 */
export class ConfigurationError extends IngestionError {
  constructor(
    code: ConfigurationErrorCode,
    message: string,
    options?: { cause?: Error; metadata?: Record<string, unknown> }
  ) {
    super(code, message, options);
    this.name = "ConfigurationError";
  }
}

/** Valid error codes for NotFoundError */
export type NotFoundErrorCode =
  | typeof ErrorCode.NOT_FOUND_RESOURCE
  | typeof ErrorCode.NOT_FOUND_URL
  | typeof ErrorCode.NOT_FOUND_KB
  | typeof ErrorCode.NOT_FOUND_SOURCE
  | typeof ErrorCode.NOT_FOUND_RUN
  | typeof ErrorCode.NOT_FOUND_CHUNK;

/**
 * Resource not found errors.
 */
export class NotFoundError extends IngestionError {
  constructor(
    code: NotFoundErrorCode,
    message: string,
    options?: { cause?: Error; metadata?: Record<string, unknown> }
  ) {
    super(code, message, { ...options, httpStatus: 404 });
    this.name = "NotFoundError";
  }
}

/** Valid error codes for ValidationError */
export type ValidationErrorCode =
  | typeof ErrorCode.VALIDATION_SCHEMA
  | typeof ErrorCode.VALIDATION_URL_INVALID
  | typeof ErrorCode.VALIDATION_CONSTRAINT
  | typeof ErrorCode.VALIDATION_PAYLOAD;

/**
 * Validation errors (schema violations, invalid inputs).
 */
export class ValidationError extends IngestionError {
  constructor(
    code: ValidationErrorCode,
    message: string,
    options?: { cause?: Error; metadata?: Record<string, unknown> }
  ) {
    super(code, message, { ...options, httpStatus: 400 });
    this.name = "ValidationError";
  }
}

/** Valid error codes for AuthError */
export type AuthErrorCode =
  | typeof ErrorCode.AUTH_FORBIDDEN
  | typeof ErrorCode.AUTH_UNAUTHORIZED
  | typeof ErrorCode.AUTH_BLOCKED;

/**
 * Authentication/authorization errors.
 */
export class AuthError extends IngestionError {
  constructor(
    code: AuthErrorCode,
    message: string,
    options?: { cause?: Error; metadata?: Record<string, unknown> }
  ) {
    const httpStatus =
      code === ErrorCode.AUTH_UNAUTHORIZED
        ? 401
        : code === ErrorCode.AUTH_FORBIDDEN
          ? 403
          : 403;
    super(code, message, { ...options, httpStatus });
    this.name = "AuthError";
  }
}

/**
 * System/infrastructure errors.
 */
export class SystemError extends IngestionError {
  constructor(
    code:
      | typeof ErrorCode.SYSTEM_OUT_OF_MEMORY
      | typeof ErrorCode.SYSTEM_DISK_FULL
      | typeof ErrorCode.SYSTEM_INTERNAL
      | typeof ErrorCode.SYSTEM_DATABASE_ERROR,
    message: string,
    options?: { cause?: Error; metadata?: Record<string, unknown> }
  ) {
    super(code, message, { ...options, httpStatus: 500 });
    this.name = "SystemError";
  }
}

// ============================================================================
// Error Classification Utilities
// ============================================================================

/**
 * Determines if an error is retryable based on its type or code.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof IngestionError) {
    return error.retryable;
  }

  // Check for common retryable patterns in generic errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network errors
    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("socket hang up") ||
      message.includes("network") ||
      name.includes("timeout")
    ) {
      return true;
    }

    // Service errors
    if (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("504") ||
      message.includes("service unavailable")
    ) {
      return true;
    }

    // Database transient errors
    if (
      message.includes("connection pool") ||
      message.includes("too many connections") ||
      message.includes("deadlock")
    ) {
      return true;
    }
  }

  // Default to retryable for unknown errors (conservative approach)
  return true;
}

/**
 * Classifies an HTTP status code into an error code.
 */
export function classifyHttpStatus(status: number): ErrorCode {
  if (status === 400) return ErrorCode.VALIDATION_PAYLOAD;
  if (status === 401) return ErrorCode.AUTH_UNAUTHORIZED;
  if (status === 403) return ErrorCode.AUTH_FORBIDDEN;
  if (status === 404) return ErrorCode.NOT_FOUND_URL;
  if (status === 429) return ErrorCode.SERVICE_RATE_LIMITED;
  if (status === 500) return ErrorCode.SYSTEM_INTERNAL;
  if (status === 502) return ErrorCode.SERVICE_BAD_GATEWAY;
  if (status === 503) return ErrorCode.SERVICE_UNAVAILABLE;
  if (status === 504) return ErrorCode.SERVICE_GATEWAY_TIMEOUT;
  if (status >= 400 && status < 500) return ErrorCode.SERVICE_API_ERROR;
  if (status >= 500) return ErrorCode.SERVICE_UNAVAILABLE;
  return ErrorCode.UNKNOWN_ERROR;
}

/**
 * Classifies a generic error into a structured IngestionError.
 * Useful for wrapping unknown errors from external libraries.
 */
export function classifyError(
  error: unknown,
  defaultMessage = "An unexpected error occurred"
): IngestionError {
  if (error instanceof IngestionError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network errors
    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      name.includes("timeout")
    ) {
      return new NetworkError(ErrorCode.NETWORK_TIMEOUT, error.message, {
        cause: error,
      });
    }

    if (
      message.includes("econnrefused") ||
      message.includes("connection refused")
    ) {
      return new NetworkError(
        ErrorCode.NETWORK_CONNECTION_REFUSED,
        error.message,
        { cause: error }
      );
    }

    if (message.includes("enotfound") || message.includes("dns")) {
      return new NetworkError(ErrorCode.NETWORK_DNS_FAILURE, error.message, {
        cause: error,
      });
    }

    if (
      message.includes("econnreset") ||
      message.includes("socket hang up") ||
      message.includes("connection reset")
    ) {
      return new NetworkError(ErrorCode.NETWORK_RESET, error.message, {
        cause: error,
      });
    }

    if (
      message.includes("ssl") ||
      message.includes("certificate") ||
      message.includes("tls")
    ) {
      return new NetworkError(ErrorCode.NETWORK_SSL_ERROR, error.message, {
        cause: error,
      });
    }

    // Service errors
    if (message.includes("rate limit") || message.includes("429")) {
      return new ServiceError(
        ErrorCode.SERVICE_RATE_LIMITED,
        error.message,
        { cause: error, httpStatus: 429 }
      );
    }

    if (message.includes("503") || message.includes("service unavailable")) {
      return new ServiceError(
        ErrorCode.SERVICE_UNAVAILABLE,
        error.message,
        { cause: error, httpStatus: 503 }
      );
    }

    if (message.includes("502") || message.includes("bad gateway")) {
      return new ServiceError(ErrorCode.SERVICE_BAD_GATEWAY, error.message, {
        cause: error,
        httpStatus: 502,
      });
    }

    if (message.includes("504") || message.includes("gateway timeout")) {
      return new ServiceError(
        ErrorCode.SERVICE_GATEWAY_TIMEOUT,
        error.message,
        { cause: error, httpStatus: 504 }
      );
    }

    // Content errors
    if (
      message.includes("too large") ||
      message.includes("payload too large") ||
      message.includes("exceeds maximum")
    ) {
      return new ContentError(ErrorCode.CONTENT_TOO_LARGE, error.message, {
        cause: error,
      });
    }

    if (
      message.includes("unsupported") ||
      message.includes("not supported") ||
      message.includes("content-type")
    ) {
      return new ContentError(
        ErrorCode.CONTENT_UNSUPPORTED_TYPE,
        error.message,
        { cause: error }
      );
    }

    if (
      message.includes("parse") ||
      message.includes("parsing") ||
      message.includes("invalid json") ||
      message.includes("syntax error")
    ) {
      return new ContentError(ErrorCode.CONTENT_PARSE_FAILED, error.message, {
        cause: error,
      });
    }

    // Configuration errors
    if (
      message.includes("api key") ||
      message.includes("apikey") ||
      message.includes("authentication key")
    ) {
      return new ConfigurationError(
        ErrorCode.CONFIG_API_KEY_MISSING,
        error.message,
        { cause: error }
      );
    }

    if (
      message.includes("dimension") &&
      message.includes("mismatch")
    ) {
      return new ConfigurationError(
        ErrorCode.CONFIG_DIMENSION_MISMATCH,
        error.message,
        { cause: error }
      );
    }

    // Not found errors
    if (message.includes("not found") || message.includes("404")) {
      return new NotFoundError(ErrorCode.NOT_FOUND_RESOURCE, error.message, {
        cause: error,
      });
    }

    // Database errors
    if (
      message.includes("database") ||
      message.includes("postgres") ||
      message.includes("sql")
    ) {
      return new SystemError(ErrorCode.SYSTEM_DATABASE_ERROR, error.message, {
        cause: error,
      });
    }

    // Out of memory
    if (
      message.includes("out of memory") ||
      message.includes("heap") ||
      name.includes("rangeerror")
    ) {
      return new SystemError(ErrorCode.SYSTEM_OUT_OF_MEMORY, error.message, {
        cause: error,
      });
    }
  }

  // Unknown error
  let errorMessage: string;
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (error === undefined || error === null) {
    errorMessage = defaultMessage;
  } else {
    errorMessage = String(error) || defaultMessage;
  }
  return new IngestionError(ErrorCode.UNKNOWN_ERROR, errorMessage, {
    cause: error instanceof Error ? error : undefined,
  });
}

/**
 * Extracts error information for logging.
 */
export function getErrorInfo(error: unknown): {
  code: ErrorCode;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  cause?: string;
} {
  const classified = classifyError(error);
  return {
    code: classified.code,
    category: classified.category,
    message: classified.message,
    retryable: classified.retryable,
    cause: classified.cause?.message,
  };
}

/**
 * Creates an IngestionError from an HTTP response.
 */
export function createHttpError(
  status: number,
  message: string,
  options?: { cause?: Error; metadata?: Record<string, unknown> }
): IngestionError {
  const code = classifyHttpStatus(status);

  switch (ERROR_CATEGORIES[code]) {
    case ErrorCategory.SERVICE:
      return new ServiceError(
        code as ServiceErrorCode,
        message,
        { ...options, httpStatus: status }
      );
    case ErrorCategory.AUTH:
      return new AuthError(
        code as AuthErrorCode,
        message,
        options
      );
    case ErrorCategory.NOT_FOUND:
      return new NotFoundError(
        code as NotFoundErrorCode,
        message,
        options
      );
    case ErrorCategory.VALIDATION:
      return new ValidationError(
        code as ValidationErrorCode,
        message,
        options
      );
    default:
      return new IngestionError(code, message, {
        ...options,
        httpStatus: status,
      });
  }
}
