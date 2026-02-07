/**
 * Fetch Selection Helper
 * 
 * Encapsulates the decision rules for selecting which fetch strategy to use
 * for a given page. The selection logic considers:
 * 
 * 1. The explicit fetchMode from the job payload
 * 2. Source-level configuration (e.g., firecrawlEnabled)
 * 3. Content heuristics for auto-detection (JS rendering needs)
 * 
 * Decision tree:
 * - fetchMode === "firecrawl" → Use Firecrawl
 * - fetchMode === "auto" && source.config.firecrawlEnabled → Use Firecrawl
 * - fetchMode === "headless" → Use Playwright
 * - fetchMode === "auto" or "html" → Try HTTP first
 *   - If HTTP succeeds but content needs JS rendering → Fall back to Playwright
 *   - If HTTP fails → Fall back to Playwright
 */

import type { Browser } from "playwright";
import type { FetchMode } from "@grounded/shared";
import { log } from "@grounded/logger";
import { fetchWithFirecrawl } from "./firecrawl";
import { fetchWithHttp } from "./http";
import { fetchWithPlaywright } from "./playwright";
import { needsJsRendering } from "../services/content-validation";

// ============================================================================
// Domain-Level JS Rendering Cache
// ============================================================================

/**
 * Cache of domains known to require JS rendering.
 * 
 * When a page from domain X is fetched via HTTP and needsJsRendering() returns
 * true, the domain is added to this cache. Subsequent pages from the same domain
 * skip the HTTP attempt entirely and go straight to Playwright, avoiding the
 * overhead of a wasted HTTP fetch + full HTML analysis.
 * 
 * The cache is bounded (LRU-style eviction at MAX_DOMAIN_CACHE_SIZE) and lives
 * for the lifetime of the worker process. It resets on worker restart, which is
 * acceptable since the cost of a single re-detection per domain is low.
 */
const jsRenderingDomains = new Map<string, boolean>();
const MAX_DOMAIN_CACHE_SIZE = 500;

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function markDomainNeedsJs(domain: string): void {
  // Simple LRU eviction: drop oldest entry when at capacity
  if (jsRenderingDomains.size >= MAX_DOMAIN_CACHE_SIZE) {
    const firstKey = jsRenderingDomains.keys().next().value;
    if (firstKey !== undefined) {
      jsRenderingDomains.delete(firstKey);
    }
  }
  jsRenderingDomains.set(domain, true);
}

function domainNeedsJs(domain: string): boolean {
  return jsRenderingDomains.get(domain) === true;
}

/** Reset the domain cache (for testing). */
export function resetJsRenderingCache(): void {
  jsRenderingDomains.clear();
}

/**
 * Result from a fetch operation
 */
export interface FetchResult {
  html: string;
  title: string | null;
}

/**
 * Source configuration relevant to fetch selection
 */
export interface FetchSourceConfig {
  firecrawlEnabled?: boolean;
}

/**
 * Context for fetch selection and execution
 */
export interface FetchContext {
  url: string;
  fetchMode: FetchMode;
  sourceConfig: FetchSourceConfig;
  browser: Browser;
}

/**
 * Strategy type identifier for logging and debugging
 */
export type FetchStrategy = "http" | "playwright" | "firecrawl";

/**
 * Result of strategy selection (before execution)
 */
export interface StrategySelectionResult {
  /** The primary strategy to try first */
  strategy: FetchStrategy;
  /** Whether fallback to Playwright is allowed on HTTP failure/detection */
  allowPlaywrightFallback: boolean;
  /** Reason for the selection (for debugging) */
  reason: string;
}

// ============================================================================
// Strategy Selection
// ============================================================================

/**
 * Selects the appropriate fetch strategy based on fetchMode and source config.
 * 
 * This is a pure function that determines which strategy to use without
 * actually executing the fetch. Used by selectAndFetch for the initial
 * strategy selection.
 */
export function selectStrategy(
  fetchMode: FetchMode,
  sourceConfig: FetchSourceConfig
): StrategySelectionResult {
  // Firecrawl: explicit mode or auto with firecrawlEnabled
  if (fetchMode === "firecrawl") {
    return {
      strategy: "firecrawl",
      allowPlaywrightFallback: false,
      reason: "fetchMode is firecrawl",
    };
  }

  if (fetchMode === "auto" && sourceConfig.firecrawlEnabled) {
    return {
      strategy: "firecrawl",
      allowPlaywrightFallback: false,
      reason: "auto mode with firecrawlEnabled source config",
    };
  }

  // Headless: explicit Playwright mode
  if (fetchMode === "headless") {
    return {
      strategy: "playwright",
      allowPlaywrightFallback: false,
      reason: "fetchMode is headless",
    };
  }

  // Auto or HTML: start with HTTP, allow fallback to Playwright
  return {
    strategy: "http",
    allowPlaywrightFallback: true,
    reason: `fetchMode is ${fetchMode}, trying HTTP first with Playwright fallback`,
  };
}

// ============================================================================
// JS Rendering Detection - Re-exports from content-validation service
// ============================================================================

// Re-export needsJsRendering and related utilities from content-validation service
// for backward compatibility with existing callers
export { needsJsRendering, getJsFrameworkIndicators } from "../services/content-validation";

// ============================================================================
// Fetch Execution
// ============================================================================

/**
 * Selects and executes the appropriate fetch strategy for a page.
 * 
 * This is the main entry point for fetch operations. It:
 * 1. Selects the initial strategy based on fetchMode and source config
 * 2. Executes the fetch using the selected strategy
 * 3. Handles fallback to Playwright when appropriate
 * 
 * The function preserves the exact decision logic from the original
 * page-fetch.ts processor.
 */
export async function selectAndFetch(context: FetchContext): Promise<FetchResult> {
  const { url, fetchMode, sourceConfig, browser } = context;
  
  const selection = selectStrategy(fetchMode, sourceConfig);
  
  log.debug("scraper-worker", "Fetch strategy selected", {
    url,
    strategy: selection.strategy,
    reason: selection.reason,
    allowPlaywrightFallback: selection.allowPlaywrightFallback,
  });

  // Execute based on selected strategy
  switch (selection.strategy) {
    case "firecrawl":
      return fetchWithFirecrawl(url);

    case "playwright":
      return fetchWithPlaywright(url, browser);

    case "http":
      return fetchWithHttpAndFallback(url, browser, selection.allowPlaywrightFallback);

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = selection.strategy;
      throw new Error(`Unknown fetch strategy: ${_exhaustive}`);
    }
  }
}

/**
 * Fetches with HTTP and handles fallback to Playwright.
 * 
 * Used when fetchMode is "auto" or "html". Will fall back to Playwright if:
 * 1. HTTP fetch fails with an exception
 * 2. HTTP fetch succeeds but content appears to need JS rendering
 */
async function fetchWithHttpAndFallback(
  url: string,
  browser: Browser,
  allowFallback: boolean
): Promise<FetchResult> {
  // Check domain-level JS rendering cache: if we already know this domain
  // requires Playwright, skip the wasted HTTP fetch entirely.
  if (allowFallback) {
    const domain = getDomain(url);
    if (domain && domainNeedsJs(domain)) {
      log.debug("scraper-worker", "Domain cached as needing JS rendering, using Playwright directly", { url, domain });
      return fetchWithPlaywright(url, browser);
    }
  }

  try {
    const result = await fetchWithHttp(url);

    // Check if content looks like it needs JS rendering
    if (allowFallback && needsJsRendering(result.html)) {
      const domain = getDomain(url);
      if (domain) {
        markDomainNeedsJs(domain);
        log.debug("scraper-worker", "Page needs JS rendering, caching domain decision", { url, domain });
      }
      return fetchWithPlaywright(url, browser);
    }

    return result;
  } catch (error) {
    // Fall back to Playwright on HTTP errors
    if (allowFallback) {
      log.debug("scraper-worker", "HTTP fetch failed, trying Playwright", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return fetchWithPlaywright(url, browser);
    }
    
    // No fallback allowed, re-throw
    throw error;
  }
}

// ============================================================================
// Exports for Testing
// ============================================================================

// Re-export constants from content-validation service for backward compatibility
export { MIN_BODY_TEXT_LENGTH, MIN_TEXT_WITH_FRAMEWORK } from "../services/content-validation";
