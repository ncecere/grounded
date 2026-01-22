/**
 * Fairness Slot Helper - Wraps fairness slot acquire/release for the scraper worker
 *
 * This module provides a simplified interface for managing fairness slots during
 * page fetch operations. It wraps the core fairness scheduler from @grounded/queue
 * with helper functions specifically designed for scraper worker usage.
 *
 * Key features:
 * - withFairnessSlot: Execute work within a slot context with automatic cleanup
 * - checkSlotAvailability: Check if a slot can be acquired without actually acquiring
 * - Logging integration for debugging fairness behavior
 *
 * Usage:
 * ```typescript
 * // Using withFairnessSlot (recommended):
 * const result = await withFairnessSlot(runId, async () => {
 *   return await processPageFetch(data, browser);
 * });
 *
 * // Using manual acquire/release:
 * const slotResult = await tryAcquireSlot(runId);
 * if (!slotResult.acquired) {
 *   throw new FairnessSlotUnavailableError(runId, slotResult);
 * }
 * try {
 *   await processPage();
 * } finally {
 *   await releaseSlotSafely(runId);
 * }
 * ```
 */

import {
  acquireSlot,
  releaseSlot,
  FairnessSlotUnavailableError,
  isFairnessSlotError,
  getFairnessConfig,
  getRunSlotCount,
  isRunRegistered,
} from "@grounded/queue";
import type { FairnessSlotResult, FairnessConfig } from "@grounded/shared";
import { log } from "@grounded/logger";

// Re-export the error class and type guard for convenience
export { FairnessSlotUnavailableError, isFairnessSlotError };
export type { FairnessSlotResult };

/**
 * Result of a withFairnessSlot execution
 */
export interface WithFairnessSlotResult<T> {
  /** Whether the slot was successfully acquired */
  acquired: boolean;
  /** The result of the work function (if acquired) */
  result?: T;
  /** Slot acquisition result details */
  slotResult: FairnessSlotResult;
}

/**
 * Options for slot operations
 */
export interface FairnessSlotOptions {
  /** Enable debug logging for slot operations */
  debug?: boolean;
  /** Request ID for tracing */
  requestId?: string;
  /** Trace ID for tracing */
  traceId?: string;
}

/**
 * Attempts to acquire a fairness slot for a source run.
 *
 * This is a thin wrapper around the core acquireSlot function that adds
 * structured logging for scraper-worker specific context.
 *
 * @param runId - The source run ID
 * @param options - Optional configuration
 * @returns FairnessSlotResult indicating if slot was acquired
 */
export async function tryAcquireSlot(
  runId: string,
  options: FairnessSlotOptions = {}
): Promise<FairnessSlotResult> {
  const { debug, requestId, traceId } = options;

  const slotResult = await acquireSlot(runId);

  if (debug || !slotResult.acquired) {
    log.debug("scraper-worker", "Fairness slot acquisition attempt", {
      runId,
      acquired: slotResult.acquired,
      currentSlots: slotResult.currentSlots,
      maxAllowedSlots: slotResult.maxAllowedSlots,
      activeRunCount: slotResult.activeRunCount,
      reason: slotResult.reason,
      retryDelayMs: slotResult.retryDelayMs,
      requestId,
      traceId,
    });
  }

  return slotResult;
}

/**
 * Releases a fairness slot for a source run.
 *
 * This is a thin wrapper around the core releaseSlot function that ensures
 * errors are caught and logged without throwing, making it safe for use
 * in finally blocks.
 *
 * @param runId - The source run ID
 * @param options - Optional configuration
 */
export async function releaseSlotSafely(
  runId: string,
  options: FairnessSlotOptions = {}
): Promise<void> {
  const { debug, requestId, traceId } = options;

  try {
    await releaseSlot(runId);

    if (debug) {
      log.debug("scraper-worker", "Fairness slot released", {
        runId,
        requestId,
        traceId,
      });
    }
  } catch (error) {
    // Log but don't throw - slot will expire via TTL
    log.warn("scraper-worker", "Failed to release fairness slot", {
      runId,
      error: error instanceof Error ? error.message : String(error),
      requestId,
      traceId,
    });
  }
}

/**
 * Executes work within a fairness slot context with automatic cleanup.
 *
 * This is the recommended way to use fairness slots. It handles:
 * - Slot acquisition with proper error handling
 * - Automatic slot release in all cases (success, failure, exception)
 * - Structured logging for debugging
 *
 * If the slot cannot be acquired, returns a result with acquired=false.
 * The caller can then throw FairnessSlotUnavailableError or handle as needed.
 *
 * @param runId - The source run ID
 * @param work - Async function to execute while holding the slot
 * @param options - Optional configuration
 * @returns WithFairnessSlotResult containing acquisition status and work result
 *
 * @example
 * ```typescript
 * const result = await withFairnessSlot(runId, async () => {
 *   return await fetchPage(url, browser);
 * });
 *
 * if (!result.acquired) {
 *   throw new FairnessSlotUnavailableError(runId, result.slotResult);
 * }
 *
 * // Use result.result here
 * ```
 */
export async function withFairnessSlot<T>(
  runId: string,
  work: () => Promise<T>,
  options: FairnessSlotOptions = {}
): Promise<WithFairnessSlotResult<T>> {
  const slotResult = await tryAcquireSlot(runId, options);

  if (!slotResult.acquired) {
    return {
      acquired: false,
      slotResult,
    };
  }

  try {
    const result = await work();
    return {
      acquired: true,
      result,
      slotResult,
    };
  } finally {
    await releaseSlotSafely(runId, options);
  }
}

/**
 * Executes work within a fairness slot, throwing if slot cannot be acquired.
 *
 * This is a convenience function that combines slot acquisition and work execution,
 * throwing FairnessSlotUnavailableError if the slot cannot be acquired.
 *
 * @param runId - The source run ID
 * @param work - Async function to execute while holding the slot
 * @param options - Optional configuration
 * @returns The result of the work function
 * @throws FairnessSlotUnavailableError if slot cannot be acquired
 *
 * @example
 * ```typescript
 * try {
 *   const result = await withFairnessSlotOrThrow(runId, async () => {
 *     return await fetchPage(url, browser);
 *   });
 * } catch (error) {
 *   if (isFairnessSlotError(error)) {
 *     // Handle delayed retry
 *   }
 *   throw error;
 * }
 * ```
 */
export async function withFairnessSlotOrThrow<T>(
  runId: string,
  work: () => Promise<T>,
  options: FairnessSlotOptions = {}
): Promise<T> {
  const result = await withFairnessSlot(runId, work, options);

  if (!result.acquired) {
    throw new FairnessSlotUnavailableError(runId, result.slotResult);
  }

  return result.result as T;
}

/**
 * Checks if a fairness slot is available without acquiring it.
 *
 * Note: This is a best-effort check. The slot availability may change
 * between this check and an actual acquisition attempt.
 *
 * @param runId - The source run ID
 * @returns Object with availability status and current metrics
 */
export async function checkSlotAvailability(
  runId: string
): Promise<{
  available: boolean;
  currentSlots: number;
  registered: boolean;
  config: FairnessConfig;
}> {
  const config = getFairnessConfig();

  // If fairness is disabled, always available
  if (!config.enabled) {
    return {
      available: true,
      currentSlots: 0,
      registered: false,
      config,
    };
  }

  const [currentSlots, registered] = await Promise.all([
    getRunSlotCount(runId),
    isRunRegistered(runId),
  ]);

  // A slot would be available if:
  // 1. The run is registered
  // 2. Current slots are below the min per run (guaranteed minimum)
  const available = registered && currentSlots < config.minSlotsPerRun;

  return {
    available,
    currentSlots,
    registered,
    config,
  };
}

/**
 * Gets the current fairness configuration.
 *
 * @returns The current FairnessConfig
 */
export function getCurrentFairnessConfig(): FairnessConfig {
  return getFairnessConfig();
}

/**
 * Creates a slot context manager for a specific run.
 *
 * This provides an object-oriented interface for managing slots when
 * you need to hold a slot across multiple operations.
 *
 * @param runId - The source run ID
 * @param options - Optional configuration
 * @returns SlotContext object with acquire/release methods
 *
 * @example
 * ```typescript
 * const slotCtx = createSlotContext(runId, { debug: true });
 *
 * if (await slotCtx.acquire()) {
 *   try {
 *     await step1();
 *     await step2();
 *     await step3();
 *   } finally {
 *     await slotCtx.release();
 *   }
 * }
 * ```
 */
export function createSlotContext(
  runId: string,
  options: FairnessSlotOptions = {}
): SlotContext {
  return new SlotContext(runId, options);
}

/**
 * Context object for managing a fairness slot across multiple operations.
 */
export class SlotContext {
  private acquired = false;
  private lastResult: FairnessSlotResult | null = null;

  constructor(
    private readonly runId: string,
    private readonly options: FairnessSlotOptions = {}
  ) {}

  /**
   * Attempts to acquire the slot.
   * @returns true if acquired, false otherwise
   */
  async acquire(): Promise<boolean> {
    if (this.acquired) {
      log.warn("scraper-worker", "Slot already acquired", {
        runId: this.runId,
        ...this.options,
      });
      return true;
    }

    this.lastResult = await tryAcquireSlot(this.runId, this.options);
    this.acquired = this.lastResult.acquired;
    return this.acquired;
  }

  /**
   * Releases the slot if it was acquired.
   */
  async release(): Promise<void> {
    if (!this.acquired) {
      return;
    }

    await releaseSlotSafely(this.runId, this.options);
    this.acquired = false;
  }

  /**
   * Gets the last slot acquisition result.
   */
  getLastResult(): FairnessSlotResult | null {
    return this.lastResult;
  }

  /**
   * Returns whether the slot is currently held.
   */
  isAcquired(): boolean {
    return this.acquired;
  }

  /**
   * Gets the run ID for this context.
   */
  getRunId(): string {
    return this.runId;
  }
}
