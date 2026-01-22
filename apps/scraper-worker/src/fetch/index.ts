/**
 * Fetch Strategies Module
 *
 * Central export point for all fetch strategy implementations and helpers.
 * This module provides:
 * 1. Strategy-specific fetch functions (HTTP, Playwright, Firecrawl)
 * 2. Strategy selection and orchestration (selectStrategy, selectAndFetch)
 * 3. Content validation utilities re-exported for convenience
 *
 * Usage:
 * ```typescript
 * import { selectAndFetch, FetchStrategy } from "./fetch";
 *
 * const result = await selectAndFetch({
 *   url,
 *   fetchMode,
 *   sourceConfig,
 *   browser,
 * });
 * ```
 */

// ============================================================================
// Fetch Strategy Implementations
// ============================================================================

export { fetchWithHttp } from "./http";
export { fetchWithPlaywright } from "./playwright";
export { fetchWithFirecrawl } from "./firecrawl";

// ============================================================================
// Strategy Selection and Orchestration
// ============================================================================

export {
  // Selection helpers
  selectStrategy,
  selectAndFetch,
  // Types
  type FetchResult,
  type FetchSourceConfig,
  type FetchContext,
  type FetchStrategy,
  type StrategySelectionResult,
} from "./selection";

// ============================================================================
// Content Validation Re-exports
// ============================================================================

// Re-export content validation utilities from services for convenience
// These are used by fetch strategies for JS rendering detection
export {
  needsJsRendering,
  getJsFrameworkIndicators,
  MIN_BODY_TEXT_LENGTH,
  MIN_TEXT_WITH_FRAMEWORK,
} from "./selection";
