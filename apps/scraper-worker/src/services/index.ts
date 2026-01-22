/**
 * Services Module
 *
 * Central export point for shared service utilities used by the scraper worker.
 * This module provides:
 * 1. Fairness slot management for fair capacity distribution
 * 2. Content validation for JS rendering detection and size limits
 *
 * Usage:
 * ```typescript
 * import {
 *   withFairnessSlotOrThrow,
 *   needsJsRendering,
 *   validateContentSize,
 * } from "./services";
 * ```
 */

// ============================================================================
// Fairness Slot Management
// ============================================================================

export {
  // Main helpers
  tryAcquireSlot,
  releaseSlotSafely,
  withFairnessSlot,
  withFairnessSlotOrThrow,
  // Utility functions
  checkSlotAvailability,
  getCurrentFairnessConfig,
  createSlotContext,
  SlotContext,
  // Error handling (re-exports from @grounded/queue)
  FairnessSlotUnavailableError,
  isFairnessSlotError,
  // Types
  type FairnessSlotResult,
  type WithFairnessSlotResult,
  type FairnessSlotOptions,
} from "./fairness-slots";

// ============================================================================
// Content Validation
// ============================================================================

export {
  // JS rendering detection
  needsJsRendering,
  extractBodyTextContent,
  detectJsFrameworkIndicators,
  getJsFrameworkIndicators,
  // Size validation
  validateContentSize,
  isContentSizeValid,
  // Content type utilities (re-exported from @grounded/shared)
  validateHtmlContentType,
  isContentTypeEnforcementEnabled,
  // Error handling (re-exported from @grounded/shared)
  ContentError,
  ErrorCode,
  // Constants
  JS_FRAMEWORK_INDICATORS,
  MIN_BODY_TEXT_LENGTH,
  MIN_TEXT_WITH_FRAMEWORK,
  MAX_PAGE_SIZE_BYTES,
  // Types
  type ContentSizeValidation,
  type JsFrameworkIndicator,
} from "./content-validation";
