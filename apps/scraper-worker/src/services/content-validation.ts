/**
 * Content Validation Service
 *
 * Centralized content validation logic for the scraper worker.
 * This module provides validation utilities for:
 *
 * 1. JS Rendering Detection - Heuristics to detect if a page needs JavaScript rendering
 * 2. Content Size Validation - Checks if content exceeds size limits
 *
 * Note: Content type validation (HTML allowlist) is handled by @grounded/shared
 * utilities (validateHtmlContentType, isContentTypeEnforcementEnabled) and should
 * continue to be imported from there.
 */

import { MAX_PAGE_SIZE_BYTES } from "@grounded/shared";

// ============================================================================
// JS Rendering Detection Constants
// ============================================================================

/** Minimum text content length to consider page fully rendered */
export const MIN_BODY_TEXT_LENGTH = 500;

/** Text length threshold when JS framework indicators are present */
export const MIN_TEXT_WITH_FRAMEWORK = 1000;

/** Common JS framework indicators in HTML */
export const JS_FRAMEWORK_INDICATORS = [
  "data-reactroot",
  "ng-app",
  "ng-controller",
  "__NEXT_DATA__",
  "__NUXT__",
  'id="app"',
  'id="root"',
] as const;

/** Type for JS framework indicator strings */
export type JsFrameworkIndicator = (typeof JS_FRAMEWORK_INDICATORS)[number];

// ============================================================================
// JS Rendering Detection
// ============================================================================

/**
 * Extracts text content from HTML body.
 *
 * @param html - Raw HTML string
 * @returns Extracted text content with HTML tags stripped
 */
export function extractBodyTextContent(html: string): string {
  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch?.[1] || "";

  // Strip HTML tags to get text content
  return bodyContent.replace(/<[^>]+>/g, "").trim();
}

/**
 * Checks if HTML contains any JS framework indicators.
 *
 * @param html - Raw HTML string
 * @returns Array of detected framework indicators
 */
export function detectJsFrameworkIndicators(html: string): JsFrameworkIndicator[] {
  const detected: JsFrameworkIndicator[] = [];

  for (const indicator of JS_FRAMEWORK_INDICATORS) {
    if (html.includes(indicator)) {
      detected.push(indicator);
    }
  }

  return detected;
}

/**
 * Determines if HTML content likely needs JavaScript rendering.
 *
 * Heuristics:
 * 1. Body has very little text content (< 500 chars) → needs JS
 * 2. Page has JS framework indicators AND text content < 1000 chars → needs JS
 *
 * This preserves the exact heuristics from the original page-fetch.ts.
 *
 * @param html - Raw HTML string to analyze
 * @returns true if the page likely needs JS rendering
 */
export function needsJsRendering(html: string): boolean {
  const textContent = extractBodyTextContent(html);

  // If body has very little text content, it likely needs JS
  if (textContent.length < MIN_BODY_TEXT_LENGTH) {
    return true;
  }

  // Check for common JS framework indicators
  for (const indicator of JS_FRAMEWORK_INDICATORS) {
    if (html.includes(indicator)) {
      // Framework detected - only flag as needing JS if text is sparse
      if (textContent.length < MIN_TEXT_WITH_FRAMEWORK) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns the framework indicators used for JS detection.
 * Exposed for testing purposes.
 */
export function getJsFrameworkIndicators(): readonly string[] {
  return JS_FRAMEWORK_INDICATORS;
}

// ============================================================================
// Content Size Validation
// ============================================================================

/**
 * Result of content size validation
 */
export interface ContentSizeValidation {
  /** Whether the content size is valid (within limits) */
  isValid: boolean;
  /** The parsed content length in bytes, or null if not available */
  contentLength: number | null;
  /** Maximum allowed size in bytes */
  maxSize: number;
  /** Rejection reason if invalid */
  rejectionReason?: string;
}

/**
 * Validates content size against the maximum allowed page size.
 *
 * @param contentLengthHeader - Value of the Content-Length header (string or null)
 * @returns Validation result with isValid flag and details
 */
export function validateContentSize(contentLengthHeader: string | null): ContentSizeValidation {
  // No content-length header - assume valid (will be checked when reading body)
  if (!contentLengthHeader) {
    return {
      isValid: true,
      contentLength: null,
      maxSize: MAX_PAGE_SIZE_BYTES,
    };
  }

  const contentLength = parseInt(contentLengthHeader, 10);

  // Invalid header value - treat as no header
  if (isNaN(contentLength)) {
    return {
      isValid: true,
      contentLength: null,
      maxSize: MAX_PAGE_SIZE_BYTES,
    };
  }

  // Check against max size
  if (contentLength > MAX_PAGE_SIZE_BYTES) {
    return {
      isValid: false,
      contentLength,
      maxSize: MAX_PAGE_SIZE_BYTES,
      rejectionReason: `Content size ${contentLength} bytes exceeds maximum ${MAX_PAGE_SIZE_BYTES} bytes`,
    };
  }

  return {
    isValid: true,
    contentLength,
    maxSize: MAX_PAGE_SIZE_BYTES,
  };
}

/**
 * Checks if content size is valid (convenience function).
 *
 * @param contentLengthHeader - Value of the Content-Length header
 * @returns true if content size is within limits
 */
export function isContentSizeValid(contentLengthHeader: string | null): boolean {
  return validateContentSize(contentLengthHeader).isValid;
}

// ============================================================================
// Re-exports from @grounded/shared for convenience
// ============================================================================

// Content type validation is already properly abstracted in @grounded/shared.
// These re-exports allow callers to import all content validation utilities
// from a single location if desired.
export {
  MAX_PAGE_SIZE_BYTES,
  validateHtmlContentType,
  isContentTypeEnforcementEnabled,
  ContentError,
  ErrorCode,
} from "@grounded/shared";
