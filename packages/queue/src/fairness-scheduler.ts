/**
 * Fairness Scheduler - Ensures fair distribution of worker capacity across source runs
 *
 * This module implements a dynamic fair share slot allocation system to prevent
 * any single source run from monopolizing worker capacity when multiple runs
 * are processing concurrently.
 *
 * Key features:
 * - Dynamic slot allocation based on number of active runs
 * - Atomic slot acquisition using Redis Lua scripts
 * - Automatic slot release with TTL safety
 * - Graceful degradation when Redis is unavailable
 *
 * Usage:
 * 1. Register a run when it enters SCRAPING stage: registerRun(runId)
 * 2. Before processing a job, acquire a slot: acquireSlot(runId)
 * 3. After processing, release the slot: releaseSlot(runId)
 * 4. Unregister when SCRAPING completes: unregisterRun(runId)
 */

import {
  type FairnessConfig,
  type FairnessSlotResult,
  type FairnessMetrics,
  FAIRNESS_ACTIVE_RUNS_KEY,
  FAIRNESS_SLOT_TTL_SECONDS,
  buildFairnessSlotKey,
  buildFairnessLastServedKey,
  resolveFairnessConfig,
  calculateFairShare,
  getDefaultFairnessConfig,
  type FairnessSettings,
} from "@grounded/shared";
import { redis } from "./index";

// ============================================================================
// Configuration
// ============================================================================

let cachedConfig: FairnessConfig | null = null;
let defaultTotalSlotsValue: number = 5;

/**
 * Gets the fairness configuration, resolving from environment on first call.
 *
 * @param defaultTotalSlots - Default total slots (from WORKER_CONCURRENCY)
 * @returns Resolved FairnessConfig
 */
export function getFairnessConfig(defaultTotalSlots: number = 5): FairnessConfig {
  // Store the default for later use
  if (defaultTotalSlots !== 5) {
    defaultTotalSlotsValue = defaultTotalSlots;
  }
  
  if (!cachedConfig) {
    cachedConfig = resolveFairnessConfig(
      (key) => process.env[key],
      defaultTotalSlotsValue
    );
  }
  return cachedConfig;
}

/**
 * Resets the cached configuration. Useful for testing.
 */
export function resetFairnessConfigCache(): void {
  cachedConfig = null;
}

/**
 * Sets the fairness configuration directly. Useful for testing or dynamic updates.
 */
export function setFairnessConfig(config: FairnessConfig): void {
  cachedConfig = config;
}

/**
 * Updates the fairness configuration from FairnessSettings (from API).
 * This allows workers to dynamically update config when settings change in the Admin UI.
 * 
 * @param settings - Fairness settings from the API
 */
export function updateFairnessConfigFromSettings(settings: FairnessSettings): void {
  const newConfig: FairnessConfig = {
    enabled: settings.enabled,
    totalSlots: Math.max(1, settings.totalSlots),
    minSlotsPerRun: Math.max(1, settings.minSlotsPerRun),
    maxSlotsPerRun: Math.max(1, settings.maxSlotsPerRun),
    retryDelayMs: Math.max(100, settings.retryDelayMs),
    slotTtlSeconds: FAIRNESS_SLOT_TTL_SECONDS,
    debug: cachedConfig?.debug ?? false, // Preserve debug setting
  };
  
  // Log if config changed
  if (cachedConfig) {
    const changes: string[] = [];
    if (cachedConfig.enabled !== newConfig.enabled) {
      changes.push(`enabled: ${cachedConfig.enabled} -> ${newConfig.enabled}`);
    }
    if (cachedConfig.totalSlots !== newConfig.totalSlots) {
      changes.push(`totalSlots: ${cachedConfig.totalSlots} -> ${newConfig.totalSlots}`);
    }
    if (cachedConfig.minSlotsPerRun !== newConfig.minSlotsPerRun) {
      changes.push(`minSlotsPerRun: ${cachedConfig.minSlotsPerRun} -> ${newConfig.minSlotsPerRun}`);
    }
    if (cachedConfig.maxSlotsPerRun !== newConfig.maxSlotsPerRun) {
      changes.push(`maxSlotsPerRun: ${cachedConfig.maxSlotsPerRun} -> ${newConfig.maxSlotsPerRun}`);
    }
    if (cachedConfig.retryDelayMs !== newConfig.retryDelayMs) {
      changes.push(`retryDelayMs: ${cachedConfig.retryDelayMs} -> ${newConfig.retryDelayMs}`);
    }
    
    if (changes.length > 0) {
      console.log(`[Fairness] Config updated: ${changes.join(", ")}`);
    }
  } else {
    console.log("[Fairness] Config initialized from API settings");
  }
  
  cachedConfig = newConfig;
}

// ============================================================================
// Lua Scripts for Atomic Operations
// ============================================================================

/**
 * Lua script for atomic slot acquisition.
 *
 * KEYS[1] = active runs set key
 * KEYS[2] = slot counter key for this run
 * ARGV[1] = runId
 * ARGV[2] = totalSlots
 * ARGV[3] = minSlotsPerRun
 * ARGV[4] = maxSlotsPerRun
 * ARGV[5] = slotTtlSeconds
 * ARGV[6] = current timestamp
 *
 * Returns:
 *   [1] = acquired (1 or 0)
 *   [2] = currentSlots after operation
 *   [3] = maxAllowedSlots (fair share)
 *   [4] = activeRunCount
 *   [5] = reason code (0=acquired, 1=at_limit, 2=not_registered)
 */
const ACQUIRE_SLOT_SCRIPT = `
local activeRunsKey = KEYS[1]
local slotKey = KEYS[2]
local runId = ARGV[1]
local totalSlots = tonumber(ARGV[2])
local minSlotsPerRun = tonumber(ARGV[3])
local maxSlotsPerRun = tonumber(ARGV[4])
local slotTtlSeconds = tonumber(ARGV[5])
local timestamp = ARGV[6]

-- Check if run is registered
local isRegistered = redis.call('SISMEMBER', activeRunsKey, runId)
if isRegistered == 0 then
  local currentSlots = tonumber(redis.call('GET', slotKey) or '0')
  return {0, currentSlots, 0, 0, 2}
end

-- Get active run count
local activeRunCount = redis.call('SCARD', activeRunsKey)
if activeRunCount == 0 then activeRunCount = 1 end

-- Calculate fair share: floor(total / active), bounded by min/max
local fairShare = math.floor(totalSlots / activeRunCount)
if fairShare < minSlotsPerRun then fairShare = minSlotsPerRun end
if fairShare > maxSlotsPerRun then fairShare = maxSlotsPerRun end

-- Get current slot count for this run
local currentSlots = tonumber(redis.call('GET', slotKey) or '0')

-- Check if under fair share
if currentSlots < fairShare then
  -- Acquire slot
  local newSlots = redis.call('INCR', slotKey)
  redis.call('EXPIRE', slotKey, slotTtlSeconds)
  -- Update last served timestamp
  redis.call('SET', 'fairness:last_served:' .. runId, timestamp)
  redis.call('EXPIRE', 'fairness:last_served:' .. runId, slotTtlSeconds)
  return {1, newSlots, fairShare, activeRunCount, 0}
else
  -- At limit
  return {0, currentSlots, fairShare, activeRunCount, 1}
end
`;

/**
 * Lua script for atomic slot release.
 *
 * KEYS[1] = slot counter key for this run
 *
 * Returns: new slot count (0 if key deleted)
 */
const RELEASE_SLOT_SCRIPT = `
local slotKey = KEYS[1]
local current = tonumber(redis.call('GET', slotKey) or '0')

if current <= 1 then
  redis.call('DEL', slotKey)
  return 0
else
  local newCount = redis.call('DECR', slotKey)
  if newCount < 0 then
    redis.call('SET', slotKey, '0')
    return 0
  end
  return newCount
end
`;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Registers a source run with the fairness scheduler.
 * Call this when a run enters the SCRAPING stage.
 *
 * @param runId - The source run ID
 */
export async function registerRun(runId: string): Promise<void> {
  const config = getFairnessConfig();

  if (!config.enabled) {
    return;
  }

  try {
    await redis.sadd(FAIRNESS_ACTIVE_RUNS_KEY, runId);

    if (config.debug) {
      const count = await redis.scard(FAIRNESS_ACTIVE_RUNS_KEY);
      console.log(`[Fairness] Registered run ${runId}, active runs: ${count}`);
    }
  } catch (error) {
    // Log but don't fail - graceful degradation
    console.error(`[Fairness] Failed to register run ${runId}:`, error);
  }
}

/**
 * Unregisters a source run from the fairness scheduler.
 * Call this when a run's SCRAPING stage completes or the run is canceled.
 *
 * @param runId - The source run ID
 */
export async function unregisterRun(runId: string): Promise<void> {
  const config = getFairnessConfig();

  if (!config.enabled) {
    return;
  }

  try {
    const pipeline = redis.pipeline();
    pipeline.srem(FAIRNESS_ACTIVE_RUNS_KEY, runId);
    pipeline.del(buildFairnessSlotKey(runId));
    pipeline.del(buildFairnessLastServedKey(runId));
    await pipeline.exec();

    if (config.debug) {
      const count = await redis.scard(FAIRNESS_ACTIVE_RUNS_KEY);
      console.log(`[Fairness] Unregistered run ${runId}, active runs: ${count}`);
    }
  } catch (error) {
    // Log but don't fail - graceful degradation
    console.error(`[Fairness] Failed to unregister run ${runId}:`, error);
  }
}

/**
 * Attempts to acquire a fairness slot for a source run.
 * Should be called before processing a job.
 *
 * @param runId - The source run ID
 * @returns FairnessSlotResult indicating if slot was acquired
 */
export async function acquireSlot(runId: string): Promise<FairnessSlotResult> {
  const config = getFairnessConfig();

  // If fairness is disabled, always allow
  if (!config.enabled) {
    return {
      acquired: true,
      currentSlots: 0,
      maxAllowedSlots: config.totalSlots,
      activeRunCount: 1,
      reason: "disabled",
    };
  }

  try {
    const result = await redis.eval(
      ACQUIRE_SLOT_SCRIPT,
      2,
      FAIRNESS_ACTIVE_RUNS_KEY,
      buildFairnessSlotKey(runId),
      runId,
      config.totalSlots.toString(),
      config.minSlotsPerRun.toString(),
      config.maxSlotsPerRun.toString(),
      config.slotTtlSeconds.toString(),
      Date.now().toString()
    ) as [number, number, number, number, number];

    const [acquired, currentSlots, maxAllowedSlots, activeRunCount, reasonCode] = result;

    const reason = reasonCode === 1 ? "at_limit" : reasonCode === 2 ? "not_registered" : undefined;

    if (config.debug) {
      console.log(
        `[Fairness] acquireSlot run=${runId} acquired=${acquired === 1} ` +
        `slots=${currentSlots}/${maxAllowedSlots} activeRuns=${activeRunCount} reason=${reason || "ok"}`
      );
    }

    return {
      acquired: acquired === 1,
      retryDelayMs: acquired === 0 ? config.retryDelayMs : undefined,
      currentSlots,
      maxAllowedSlots,
      activeRunCount,
      reason,
    };
  } catch (error) {
    // On Redis error, allow the job to proceed (graceful degradation)
    console.error(`[Fairness] Failed to acquire slot for run ${runId}:`, error);
    return {
      acquired: true,
      currentSlots: 0,
      maxAllowedSlots: config.totalSlots,
      activeRunCount: 1,
    };
  }
}

/**
 * Releases a fairness slot for a source run.
 * Must be called after processing a job (in finally block).
 *
 * @param runId - The source run ID
 */
export async function releaseSlot(runId: string): Promise<void> {
  const config = getFairnessConfig();

  if (!config.enabled) {
    return;
  }

  try {
    const newCount = await redis.eval(
      RELEASE_SLOT_SCRIPT,
      1,
      buildFairnessSlotKey(runId)
    ) as number;

    if (config.debug) {
      console.log(`[Fairness] releaseSlot run=${runId} remainingSlots=${newCount}`);
    }
  } catch (error) {
    // Log but don't fail - slot will expire via TTL
    console.error(`[Fairness] Failed to release slot for run ${runId}:`, error);
  }
}

/**
 * Gets the list of currently active source runs.
 *
 * @returns Array of active run IDs
 */
export async function getActiveRuns(): Promise<string[]> {
  const config = getFairnessConfig();

  if (!config.enabled) {
    return [];
  }

  try {
    return await redis.smembers(FAIRNESS_ACTIVE_RUNS_KEY);
  } catch (error) {
    console.error("[Fairness] Failed to get active runs:", error);
    return [];
  }
}

/**
 * Gets the current slot count for a specific run.
 *
 * @param runId - The source run ID
 * @returns Current slot count
 */
export async function getRunSlotCount(runId: string): Promise<number> {
  try {
    const value = await redis.get(buildFairnessSlotKey(runId));
    return value ? Math.max(0, parseInt(value, 10)) : 0;
  } catch (error) {
    console.error(`[Fairness] Failed to get slot count for run ${runId}:`, error);
    return 0;
  }
}

/**
 * Gets fairness metrics for monitoring.
 *
 * @returns FairnessMetrics snapshot
 */
export async function getFairnessMetrics(): Promise<FairnessMetrics> {
  const config = getFairnessConfig();

  try {
    const activeRuns = await getActiveRuns();
    const runSlots: Record<string, number> = {};
    let totalSlotsInUse = 0;

    // Get slot count for each active run
    for (const runId of activeRuns) {
      const slots = await getRunSlotCount(runId);
      runSlots[runId] = slots;
      totalSlotsInUse += slots;
    }

    const fairShare = calculateFairShare(
      config.totalSlots,
      activeRuns.length,
      config.minSlotsPerRun,
      config.maxSlotsPerRun
    );

    return {
      activeRunCount: activeRuns.length,
      totalSlotsInUse,
      totalSlotsAvailable: config.totalSlots,
      runSlots,
      fairSharePerRun: fairShare,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[Fairness] Failed to get metrics:", error);
    return {
      activeRunCount: 0,
      totalSlotsInUse: 0,
      totalSlotsAvailable: config.totalSlots,
      runSlots: {},
      fairSharePerRun: config.totalSlots,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Checks if a run is registered with the fairness scheduler.
 *
 * @param runId - The source run ID
 * @returns true if registered
 */
export async function isRunRegistered(runId: string): Promise<boolean> {
  const config = getFairnessConfig();

  if (!config.enabled) {
    return false;
  }

  try {
    const result = await redis.sismember(FAIRNESS_ACTIVE_RUNS_KEY, runId);
    return result === 1;
  } catch (error) {
    console.error(`[Fairness] Failed to check if run ${runId} is registered:`, error);
    return false;
  }
}

/**
 * Cleans up all fairness state. Use with caution - typically only for testing.
 */
export async function resetFairnessState(): Promise<void> {
  try {
    const activeRuns = await redis.smembers(FAIRNESS_ACTIVE_RUNS_KEY);

    const pipeline = redis.pipeline();
    pipeline.del(FAIRNESS_ACTIVE_RUNS_KEY);

    for (const runId of activeRuns) {
      pipeline.del(buildFairnessSlotKey(runId));
      pipeline.del(buildFairnessLastServedKey(runId));
    }

    await pipeline.exec();
  } catch (error) {
    console.error("[Fairness] Failed to reset state:", error);
  }
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when a fairness slot cannot be acquired.
 * This error should trigger a delayed retry, not an immediate failure.
 */
export class FairnessSlotUnavailableError extends Error {
  public readonly retryDelayMs: number;
  public readonly runId: string;
  public readonly slotResult: FairnessSlotResult;

  constructor(runId: string, slotResult: FairnessSlotResult) {
    super(`Fairness slot unavailable for run ${runId}: ${slotResult.reason}`);
    this.name = "FairnessSlotUnavailableError";
    this.retryDelayMs = slotResult.retryDelayMs || 500;
    this.runId = runId;
    this.slotResult = slotResult;
  }
}

/**
 * Checks if an error is a FairnessSlotUnavailableError.
 */
export function isFairnessSlotError(error: unknown): error is FairnessSlotUnavailableError {
  return error instanceof FairnessSlotUnavailableError;
}
