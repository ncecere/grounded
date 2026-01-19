/**
 * Internal API routes for worker settings.
 * 
 * These endpoints are designed for internal use by workers (scraper, ingestion, etc.)
 * to fetch their configuration from the database instead of relying solely on
 * environment variables.
 * 
 * Authentication: Uses INTERNAL_API_KEY header for simplicity.
 * In production, this should only be accessible from within the cluster.
 */

import { Hono } from "hono";
import { db } from "@grounded/db";
import { systemSettings } from "@grounded/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getEnv } from "@grounded/shared";

export const internalWorkersRoutes = new Hono();

// ============================================================================
// Middleware: Internal API Key Authentication
// ============================================================================

/**
 * Simple middleware that validates the internal API key.
 * Falls back to allowing requests if no key is configured (dev mode).
 */
internalWorkersRoutes.use("*", async (c, next) => {
  const configuredKey = getEnv("INTERNAL_API_KEY", "");
  
  // In dev mode without a configured key, allow all requests
  if (!configuredKey) {
    return next();
  }
  
  const providedKey = c.req.header("X-Internal-API-Key");
  
  if (providedKey !== configuredKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  
  return next();
});

// ============================================================================
// Types
// ============================================================================

interface WorkerSettings {
  fairness: {
    enabled: boolean;
    totalSlots: number;
    minSlotsPerRun: number;
    maxSlotsPerRun: number;
    retryDelayMs: number;
  };
  scraper: {
    concurrency: number;
  };
  ingestion: {
    concurrency: number;
  };
  embed: {
    concurrency: number;
  };
}

// Default values (should match SETTINGS_METADATA in admin/settings.ts)
const DEFAULTS: WorkerSettings = {
  fairness: {
    enabled: true,
    totalSlots: 5,
    minSlotsPerRun: 1,
    maxSlotsPerRun: 10,
    retryDelayMs: 500,
  },
  scraper: {
    concurrency: 5,
  },
  ingestion: {
    concurrency: 5,
  },
  embed: {
    concurrency: 4,
  },
};

// Setting keys we care about
const WORKER_SETTING_KEYS = [
  "workers.fairness_enabled",
  "workers.fairness_total_slots",
  "workers.fairness_min_slots_per_run",
  "workers.fairness_max_slots_per_run",
  "workers.fairness_retry_delay_ms",
  "workers.scraper_concurrency",
  "workers.ingestion_concurrency",
  "workers.embed_concurrency",
];

// ============================================================================
// Get All Worker Settings
// ============================================================================

/**
 * GET /internal/workers/settings
 * 
 * Returns all worker-related settings in a structured format.
 * Workers can call this at startup and periodically to refresh config.
 */
internalWorkersRoutes.get("/settings", async (c) => {
  try {
    // Fetch all worker settings from database
    const dbSettings = await db.query.systemSettings.findMany({
      where: inArray(systemSettings.key, WORKER_SETTING_KEYS),
    });
    
    // Build a map for easy lookup
    const settingsMap = new Map<string, string | number | boolean>();
    for (const setting of dbSettings) {
      try {
        settingsMap.set(setting.key, JSON.parse(setting.value));
      } catch {
        // Skip malformed values
      }
    }
    
    // Helper to get a value with fallback to default
    const getValue = <T>(key: string, defaultValue: T): T => {
      const value = settingsMap.get(key);
      if (value === undefined || value === null) {
        return defaultValue;
      }
      return value as T;
    };
    
    // Build response with resolved values
    const settings: WorkerSettings = {
      fairness: {
        enabled: getValue("workers.fairness_enabled", DEFAULTS.fairness.enabled),
        totalSlots: getValue("workers.fairness_total_slots", DEFAULTS.fairness.totalSlots),
        minSlotsPerRun: getValue("workers.fairness_min_slots_per_run", DEFAULTS.fairness.minSlotsPerRun),
        maxSlotsPerRun: getValue("workers.fairness_max_slots_per_run", DEFAULTS.fairness.maxSlotsPerRun),
        retryDelayMs: getValue("workers.fairness_retry_delay_ms", DEFAULTS.fairness.retryDelayMs),
      },
      scraper: {
        concurrency: getValue("workers.scraper_concurrency", DEFAULTS.scraper.concurrency),
      },
      ingestion: {
        concurrency: getValue("workers.ingestion_concurrency", DEFAULTS.ingestion.concurrency),
      },
      embed: {
        concurrency: getValue("workers.embed_concurrency", DEFAULTS.embed.concurrency),
      },
    };
    
    return c.json({
      success: true,
      settings,
      // Include last update time for cache validation
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Internal API] Failed to fetch worker settings:", error);
    return c.json({
      success: false,
      error: "Failed to fetch settings",
      // Return defaults on error so workers can still function
      settings: DEFAULTS,
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /internal/workers/settings/fairness
 * 
 * Returns only fairness scheduler settings.
 * Optimized endpoint for the fairness scheduler refresh.
 */
internalWorkersRoutes.get("/settings/fairness", async (c) => {
  try {
    const fairnessKeys = [
      "workers.fairness_enabled",
      "workers.fairness_total_slots",
      "workers.fairness_min_slots_per_run",
      "workers.fairness_max_slots_per_run",
      "workers.fairness_retry_delay_ms",
    ];
    
    const dbSettings = await db.query.systemSettings.findMany({
      where: inArray(systemSettings.key, fairnessKeys),
    });
    
    const settingsMap = new Map<string, string | number | boolean>();
    for (const setting of dbSettings) {
      try {
        settingsMap.set(setting.key, JSON.parse(setting.value));
      } catch {
        // Skip malformed values
      }
    }
    
    const getValue = <T>(key: string, defaultValue: T): T => {
      const value = settingsMap.get(key);
      if (value === undefined || value === null) {
        return defaultValue;
      }
      return value as T;
    };
    
    return c.json({
      success: true,
      fairness: {
        enabled: getValue("workers.fairness_enabled", DEFAULTS.fairness.enabled),
        totalSlots: getValue("workers.fairness_total_slots", DEFAULTS.fairness.totalSlots),
        minSlotsPerRun: getValue("workers.fairness_min_slots_per_run", DEFAULTS.fairness.minSlotsPerRun),
        maxSlotsPerRun: getValue("workers.fairness_max_slots_per_run", DEFAULTS.fairness.maxSlotsPerRun),
        retryDelayMs: getValue("workers.fairness_retry_delay_ms", DEFAULTS.fairness.retryDelayMs),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Internal API] Failed to fetch fairness settings:", error);
    return c.json({
      success: false,
      error: "Failed to fetch fairness settings",
      fairness: DEFAULTS.fairness,
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /internal/workers/health
 * 
 * Simple health check for internal API.
 */
internalWorkersRoutes.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});
