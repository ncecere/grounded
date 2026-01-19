/**
 * Settings Client for Workers
 * 
 * This module provides a client for workers to fetch configuration from the API.
 * Settings are fetched from the database via the internal API endpoint, with
 * fallback to environment variables and defaults.
 * 
 * Features:
 * - Fetch settings from API at startup
 * - Periodic refresh to pick up Admin UI changes
 * - Graceful fallback to env vars/defaults on API failure
 * - Caching to minimize API calls
 */

import { getEnv, getEnvNumber, getEnvBool } from "../utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Fairness scheduler settings.
 */
export interface FairnessSettings {
  enabled: boolean;
  totalSlots: number;
  minSlotsPerRun: number;
  maxSlotsPerRun: number;
  retryDelayMs: number;
}

/**
 * All worker settings.
 */
export interface WorkerSettings {
  fairness: FairnessSettings;
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

/**
 * Response from the internal API.
 */
interface SettingsApiResponse {
  success: boolean;
  settings: WorkerSettings;
  timestamp: string;
  error?: string;
}

/**
 * Response from the fairness settings API.
 */
interface FairnessApiResponse {
  success: boolean;
  fairness: FairnessSettings;
  timestamp: string;
  error?: string;
}

// ============================================================================
// Defaults (match SETTINGS_METADATA in admin/settings.ts)
// ============================================================================

const DEFAULT_FAIRNESS_SETTINGS: FairnessSettings = {
  enabled: true,
  totalSlots: 5,
  minSlotsPerRun: 1,
  maxSlotsPerRun: 10,
  retryDelayMs: 500,
};

const DEFAULT_WORKER_SETTINGS: WorkerSettings = {
  fairness: DEFAULT_FAIRNESS_SETTINGS,
  scraper: { concurrency: 5 },
  ingestion: { concurrency: 5 },
  embed: { concurrency: 4 },
};

// ============================================================================
// Settings Client
// ============================================================================

/**
 * Client for fetching worker settings from the API.
 * Implements caching and automatic refresh.
 */
export class WorkerSettingsClient {
  private apiUrl: string;
  private apiKey: string;
  private cachedSettings: WorkerSettings | null = null;
  private lastFetchTime: number = 0;
  private refreshIntervalMs: number;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private onSettingsUpdate?: (settings: WorkerSettings) => void;

  /**
   * Creates a new settings client.
   * 
   * @param options - Client options
   * @param options.apiUrl - Base URL of the API (e.g., http://localhost:3001)
   * @param options.apiKey - Internal API key for authentication
   * @param options.refreshIntervalMs - How often to refresh settings (default: 60000ms = 1 minute)
   * @param options.onSettingsUpdate - Callback when settings are updated
   */
  constructor(options: {
    apiUrl?: string;
    apiKey?: string;
    refreshIntervalMs?: number;
    onSettingsUpdate?: (settings: WorkerSettings) => void;
  } = {}) {
    this.apiUrl = options.apiUrl || getEnv("API_URL", "http://localhost:3001");
    this.apiKey = options.apiKey || getEnv("INTERNAL_API_KEY", "");
    this.refreshIntervalMs = options.refreshIntervalMs || getEnvNumber("SETTINGS_REFRESH_INTERVAL_MS", 60000);
    this.onSettingsUpdate = options.onSettingsUpdate;
  }

  /**
   * Fetches all worker settings from the API.
   * Falls back to environment variables/defaults on failure.
   */
  async fetchSettings(): Promise<WorkerSettings> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/internal/workers/settings`, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        console.warn(`[SettingsClient] API returned ${response.status}, using fallback settings`);
        return this.getFallbackSettings();
      }

      const data = await response.json() as SettingsApiResponse;
      
      if (data.success && data.settings) {
        this.cachedSettings = data.settings;
        this.lastFetchTime = Date.now();
        
        if (this.onSettingsUpdate) {
          this.onSettingsUpdate(data.settings);
        }
        
        return data.settings;
      }

      console.warn("[SettingsClient] API returned unsuccessful response, using fallback settings");
      return this.getFallbackSettings();
    } catch (error) {
      console.warn("[SettingsClient] Failed to fetch settings from API:", error);
      return this.getFallbackSettings();
    }
  }

  /**
   * Fetches only fairness settings from the API.
   * More efficient than fetching all settings.
   */
  async fetchFairnessSettings(): Promise<FairnessSettings> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/internal/workers/settings/fairness`, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        console.warn(`[SettingsClient] API returned ${response.status}, using fallback fairness settings`);
        return this.getFallbackFairnessSettings();
      }

      const data = await response.json() as FairnessApiResponse;
      
      if (data.success && data.fairness) {
        // Update cached settings if we have them
        if (this.cachedSettings) {
          this.cachedSettings.fairness = data.fairness;
        }
        
        return data.fairness;
      }

      console.warn("[SettingsClient] API returned unsuccessful response, using fallback fairness settings");
      return this.getFallbackFairnessSettings();
    } catch (error) {
      console.warn("[SettingsClient] Failed to fetch fairness settings from API:", error);
      return this.getFallbackFairnessSettings();
    }
  }

  /**
   * Gets cached settings or fetches if not cached.
   */
  async getSettings(): Promise<WorkerSettings> {
    if (this.cachedSettings && this.isCacheValid()) {
      return this.cachedSettings;
    }
    return this.fetchSettings();
  }

  /**
   * Gets cached fairness settings or fetches if not cached.
   */
  async getFairnessSettings(): Promise<FairnessSettings> {
    if (this.cachedSettings && this.isCacheValid()) {
      return this.cachedSettings.fairness;
    }
    const settings = await this.fetchSettings();
    return settings.fairness;
  }

  /**
   * Starts automatic periodic refresh of settings.
   */
  startPeriodicRefresh(): void {
    if (this.refreshTimer) {
      return; // Already running
    }

    this.refreshTimer = setInterval(async () => {
      try {
        await this.fetchSettings();
      } catch (error) {
        console.warn("[SettingsClient] Periodic refresh failed:", error);
      }
    }, this.refreshIntervalMs);

    console.log(`[SettingsClient] Started periodic refresh every ${this.refreshIntervalMs}ms`);
  }

  /**
   * Stops automatic periodic refresh.
   */
  stopPeriodicRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      console.log("[SettingsClient] Stopped periodic refresh");
    }
  }

  /**
   * Invalidates the cache, forcing a fresh fetch on next access.
   */
  invalidateCache(): void {
    this.cachedSettings = null;
    this.lastFetchTime = 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["X-Internal-API-Key"] = this.apiKey;
    }

    return headers;
  }

  private isCacheValid(): boolean {
    return Date.now() - this.lastFetchTime < this.refreshIntervalMs;
  }

  /**
   * Gets fallback settings from environment variables and defaults.
   */
  private getFallbackSettings(): WorkerSettings {
    return {
      fairness: this.getFallbackFairnessSettings(),
      scraper: {
        concurrency: getEnvNumber("WORKER_CONCURRENCY", DEFAULT_WORKER_SETTINGS.scraper.concurrency),
      },
      ingestion: {
        concurrency: getEnvNumber("WORKER_CONCURRENCY", DEFAULT_WORKER_SETTINGS.ingestion.concurrency),
      },
      embed: {
        concurrency: getEnvNumber("EMBED_WORKER_CONCURRENCY", DEFAULT_WORKER_SETTINGS.embed.concurrency),
      },
    };
  }

  /**
   * Gets fallback fairness settings from environment variables and defaults.
   */
  private getFallbackFairnessSettings(): FairnessSettings {
    const workerConcurrency = getEnvNumber("WORKER_CONCURRENCY", DEFAULT_FAIRNESS_SETTINGS.totalSlots);
    
    return {
      enabled: !getEnvBool("FAIRNESS_DISABLED", false),
      totalSlots: getEnvNumber("FAIRNESS_TOTAL_SLOTS", workerConcurrency),
      minSlotsPerRun: getEnvNumber("FAIRNESS_MIN_SLOTS_PER_RUN", DEFAULT_FAIRNESS_SETTINGS.minSlotsPerRun),
      maxSlotsPerRun: getEnvNumber("FAIRNESS_MAX_SLOTS_PER_RUN", DEFAULT_FAIRNESS_SETTINGS.maxSlotsPerRun),
      retryDelayMs: getEnvNumber("FAIRNESS_RETRY_DELAY_MS", DEFAULT_FAIRNESS_SETTINGS.retryDelayMs),
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultClient: WorkerSettingsClient | null = null;

/**
 * Gets or creates the default settings client.
 */
export function getSettingsClient(): WorkerSettingsClient {
  if (!defaultClient) {
    defaultClient = new WorkerSettingsClient();
  }
  return defaultClient;
}

/**
 * Initializes the settings client with custom options.
 * Must be called before getSettingsClient() to take effect.
 */
export function initSettingsClient(options: {
  apiUrl?: string;
  apiKey?: string;
  refreshIntervalMs?: number;
  onSettingsUpdate?: (settings: WorkerSettings) => void;
}): WorkerSettingsClient {
  defaultClient = new WorkerSettingsClient(options);
  return defaultClient;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Fetches all worker settings using the default client.
 */
export async function fetchWorkerSettings(): Promise<WorkerSettings> {
  return getSettingsClient().fetchSettings();
}

/**
 * Fetches fairness settings using the default client.
 */
export async function fetchFairnessSettings(): Promise<FairnessSettings> {
  return getSettingsClient().fetchFairnessSettings();
}
