import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import { systemSettings } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { auth, requireSystemAdmin, withRequestRLS } from "../../middleware/auth";
import { BadRequestError } from "../../middleware/error-handler";
import { emailService } from "../../services/email";
import {
  runHealthCheck,
  startHealthAlertScheduler,
  stopHealthAlertScheduler,
  isSchedulerRunning,
  getLastCheckTime,
} from "../../services/health-alerts";
import { getFairnessMetrics, resetFairnessState } from "@grounded/queue";

export const adminSettingsRoutes = new Hono();

// All routes require system admin
adminSettingsRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// Types and Metadata
// ============================================================================

type SettingCategory = "auth" | "quotas" | "email" | "alerts" | "general" | "workers";

interface SettingMeta {
  category: SettingCategory;
  isSecret: boolean;
  description: string;
  defaultValue: string | number | boolean;
}

const SETTINGS_METADATA: Record<string, SettingMeta> = {
  // Auth Settings
  "auth.local_registration_enabled": {
    category: "auth",
    isSecret: false,
    description: "Allow local user registration",
    defaultValue: true,
  },
  "auth.oidc_enabled": {
    category: "auth",
    isSecret: false,
    description: "Enable OIDC authentication",
    defaultValue: false,
  },
  "auth.oidc_issuer": {
    category: "auth",
    isSecret: false,
    description: "OIDC issuer URL",
    defaultValue: "",
  },
  "auth.oidc_client_id": {
    category: "auth",
    isSecret: false,
    description: "OIDC client ID",
    defaultValue: "",
  },
  "auth.oidc_client_secret": {
    category: "auth",
    isSecret: true,
    description: "OIDC client secret",
    defaultValue: "",
  },

  // Default Quota Settings
  "quotas.default_max_kbs": {
    category: "quotas",
    isSecret: false,
    description: "Default max knowledge bases per tenant",
    defaultValue: 10,
  },
  "quotas.default_max_agents": {
    category: "quotas",
    isSecret: false,
    description: "Default max agents per tenant",
    defaultValue: 10,
  },
  "quotas.default_max_uploaded_docs": {
    category: "quotas",
    isSecret: false,
    description: "Default monthly upload limit per tenant",
    defaultValue: 1000,
  },
  "quotas.default_max_scraped_pages": {
    category: "quotas",
    isSecret: false,
    description: "Default monthly scrape limit per tenant",
    defaultValue: 1000,
  },
  "quotas.default_chat_rate_limit": {
    category: "quotas",
    isSecret: false,
    description: "Default chat rate limit per minute",
    defaultValue: 60,
  },

  // Email/SMTP Settings
  "email.smtp_enabled": {
    category: "email",
    isSecret: false,
    description: "Enable SMTP email sending",
    defaultValue: false,
  },
  "email.smtp_host": {
    category: "email",
    isSecret: false,
    description: "SMTP server hostname",
    defaultValue: "",
  },
  "email.smtp_port": {
    category: "email",
    isSecret: false,
    description: "SMTP server port (usually 587 for TLS, 465 for SSL)",
    defaultValue: 587,
  },
  "email.smtp_secure": {
    category: "email",
    isSecret: false,
    description: "Use SSL/TLS (true for port 465, false for STARTTLS on 587)",
    defaultValue: false,
  },
  "email.smtp_user": {
    category: "email",
    isSecret: false,
    description: "SMTP authentication username",
    defaultValue: "",
  },
  "email.smtp_password": {
    category: "email",
    isSecret: true,
    description: "SMTP authentication password",
    defaultValue: "",
  },
  "email.from_address": {
    category: "email",
    isSecret: false,
    description: "Default sender email address",
    defaultValue: "",
  },
  "email.from_name": {
    category: "email",
    isSecret: false,
    description: "Default sender display name",
    defaultValue: "Grounded Platform",
  },

  // Alert Settings
  "alerts.enabled": {
    category: "alerts",
    isSecret: false,
    description: "Enable email alerts for system events",
    defaultValue: false,
  },
  "alerts.recipient_emails": {
    category: "alerts",
    isSecret: false,
    description: "Comma-separated list of email addresses to receive alerts",
    defaultValue: "",
  },
  "alerts.check_interval_minutes": {
    category: "alerts",
    isSecret: false,
    description: "How often to check for alert conditions (in minutes)",
    defaultValue: 60,
  },
  "alerts.error_rate_threshold": {
    category: "alerts",
    isSecret: false,
    description: "Error rate percentage threshold to trigger alert",
    defaultValue: 10,
  },
  "alerts.quota_warning_threshold": {
    category: "alerts",
    isSecret: false,
    description: "Quota usage percentage threshold for warnings",
    defaultValue: 80,
  },
  "alerts.inactivity_days": {
    category: "alerts",
    isSecret: false,
    description: "Days of inactivity before alerting (0 to disable)",
    defaultValue: 7,
  },
  "alerts.include_healthy_summary": {
    category: "alerts",
    isSecret: false,
    description: "Include summary even when all tenants are healthy",
    defaultValue: false,
  },

  // Worker/Fairness Settings
  "workers.fairness_enabled": {
    category: "workers",
    isSecret: false,
    description: "Enable fairness scheduler to distribute worker capacity across concurrent runs",
    defaultValue: true,
  },
  "workers.fairness_total_slots": {
    category: "workers",
    isSecret: false,
    description: "Total worker slots available for scraping (defaults to WORKER_CONCURRENCY)",
    defaultValue: 5,
  },
  "workers.fairness_min_slots_per_run": {
    category: "workers",
    isSecret: false,
    description: "Minimum slots guaranteed per run (prevents starvation)",
    defaultValue: 1,
  },
  "workers.fairness_max_slots_per_run": {
    category: "workers",
    isSecret: false,
    description: "Maximum slots a single run can use (prevents monopolization)",
    defaultValue: 10,
  },
  "workers.fairness_retry_delay_ms": {
    category: "workers",
    isSecret: false,
    description: "Delay in milliseconds before retrying when slots unavailable",
    defaultValue: 500,
  },
  "workers.scraper_concurrency": {
    category: "workers",
    isSecret: false,
    description: "Number of concurrent page fetch jobs per scraper worker",
    defaultValue: 5,
  },
  "workers.ingestion_concurrency": {
    category: "workers",
    isSecret: false,
    description: "Number of concurrent page processing jobs per ingestion worker",
    defaultValue: 5,
  },
  "workers.embed_concurrency": {
    category: "workers",
    isSecret: false,
    description: "Number of concurrent embedding jobs per worker",
    defaultValue: 4,
  },
};

function getValidSettingKeys(): string[] {
  return Object.keys(SETTINGS_METADATA);
}

function getSettingMetadata(key: string): SettingMeta | null {
  return SETTINGS_METADATA[key] || null;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const updateSettingsSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    })
  ),
});

// ============================================================================
// Get All Settings
// ============================================================================

adminSettingsRoutes.get("/", async (c) => {
  const category = c.req.query("category") as SettingCategory | undefined;

  // Get all settings from database
  const dbSettings = await withRequestRLS(c, async (tx) => {
    return tx.query.systemSettings.findMany();
  });
  const dbSettingsMap = new Map(dbSettings.map((s) => [s.key, s]));

  // Build response with all known settings (from metadata)
  const settings = Object.entries(SETTINGS_METADATA)
    .filter(([_, meta]) => !category || meta.category === category)
    .map(([key, meta]) => {
      const dbSetting = dbSettingsMap.get(key);
      let value: string | number | boolean;

      if (dbSetting) {
        value = meta.isSecret ? "***REDACTED***" : JSON.parse(dbSetting.value);
      } else {
        value = meta.isSecret && meta.defaultValue ? "***REDACTED***" : meta.defaultValue;
      }

      return {
        key,
        value,
        category: meta.category,
        isSecret: meta.isSecret,
        description: meta.description,
        isConfigured: !!dbSetting,
        updatedAt: dbSetting?.updatedAt || null,
      };
    });

  return c.json({ settings });
});

// ============================================================================
// Get Single Setting
// ============================================================================

adminSettingsRoutes.get("/:key", async (c) => {
  const key = c.req.param("key");
  const meta = getSettingMetadata(key);

  if (!meta) {
    return c.json({ key, value: null, exists: false });
  }

  const setting = await withRequestRLS(c, async (tx) => {
    return tx.query.systemSettings.findFirst({
      where: eq(systemSettings.key, key),
    });
  });

  return c.json({
    key,
    value: setting
      ? meta.isSecret
        ? "***REDACTED***"
        : JSON.parse(setting.value)
      : meta.defaultValue,
    category: meta.category,
    isSecret: meta.isSecret,
    description: meta.description,
    isConfigured: !!setting,
    exists: true,
  });
});

// ============================================================================
// Update Single Setting
// ============================================================================

adminSettingsRoutes.put(
  "/:key",
  zValidator("json", updateSettingSchema),
  async (c) => {
    const key = c.req.param("key");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    // Validate setting key
    const meta = getSettingMetadata(key);
    if (!meta) {
      throw new BadRequestError(`Unknown setting key: ${key}`);
    }

    // Don't update secrets with empty or redacted values
    if (meta.isSecret) {
      const valueStr = String(body.value);
      if (!valueStr || valueStr === "***REDACTED***") {
        return c.json({ message: "Skipped - no value provided", key });
      }
    }

    await withRequestRLS(c, async (tx) => {
      return tx
        .insert(systemSettings)
        .values({
          key,
          value: JSON.stringify(body.value),
          category: meta.category,
          isSecret: meta.isSecret,
          description: meta.description,
          updatedBy: authContext.user.id,
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value: JSON.stringify(body.value),
            updatedAt: new Date(),
            updatedBy: authContext.user.id,
          },
        });
    });

    return c.json({ message: "Setting updated", key });
  }
);

// ============================================================================
// Bulk Update Settings
// ============================================================================

adminSettingsRoutes.put(
  "/",
  zValidator("json", updateSettingsSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");
    let updatedCount = 0;

    await withRequestRLS(c, async (tx) => {
      for (const setting of body.settings) {
        const meta = getSettingMetadata(setting.key);
        if (!meta) {
          continue; // Skip unknown keys
        }

        // Skip empty secret values
        if (meta.isSecret) {
          const valueStr = String(setting.value);
          if (!valueStr || valueStr === "***REDACTED***") {
            continue;
          }
        }

        await tx
          .insert(systemSettings)
          .values({
            key: setting.key,
            value: JSON.stringify(setting.value),
            category: meta.category,
            isSecret: meta.isSecret,
            description: meta.description,
            updatedBy: authContext.user.id,
          })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: {
              value: JSON.stringify(setting.value),
              updatedAt: new Date(),
              updatedBy: authContext.user.id,
            },
          });

        updatedCount++;
      }
    });

    return c.json({ message: "Settings updated", count: updatedCount });
  }
);

// ============================================================================
// Get Settings Schema (for UI generation)
// ============================================================================

adminSettingsRoutes.get("/schema/all", async (c) => {
  const schema = Object.entries(SETTINGS_METADATA).map(([key, meta]) => ({
    key,
    category: meta.category,
    isSecret: meta.isSecret,
    description: meta.description,
    defaultValue: meta.isSecret ? undefined : meta.defaultValue,
    type: typeof meta.defaultValue,
  }));

  return c.json({ schema });
});

// ============================================================================
// Email Testing Endpoints
// ============================================================================

const testEmailSchema = z.object({
  email: z.string().email(),
});

adminSettingsRoutes.post("/email/verify", async (c) => {
  // Invalidate cache to ensure we use latest settings
  emailService.invalidateCache();

  const isConfigured = await emailService.isConfigured();
  if (!isConfigured) {
    return c.json({
      success: false,
      message: "SMTP is not configured. Please configure SMTP settings first.",
    });
  }

  const result = await emailService.verifyConnection();
  return c.json({
    success: result.success,
    message: result.success
      ? "SMTP connection verified successfully"
      : `SMTP connection failed: ${result.error}`,
  });
});

adminSettingsRoutes.post(
  "/email/test",
  zValidator("json", testEmailSchema),
  async (c) => {
    const body = c.req.valid("json");

    // Invalidate cache to ensure we use latest settings
    emailService.invalidateCache();

    const isConfigured = await emailService.isConfigured();
    if (!isConfigured) {
      return c.json({
        success: false,
        message: "SMTP is not configured. Please configure SMTP settings first.",
      });
    }

    const result = await emailService.sendTestEmail(body.email);
    return c.json({
      success: result.success,
      message: result.success
        ? `Test email sent successfully to ${body.email}`
        : `Failed to send test email: ${result.error}`,
    });
  }
);

adminSettingsRoutes.get("/email/status", async (c) => {
  emailService.invalidateCache();
  const isConfigured = await emailService.isConfigured();

  return c.json({
    configured: isConfigured,
  });
});

// ============================================================================
// Alert Endpoints
// ============================================================================

adminSettingsRoutes.get("/alerts/status", async (c) => {
  const lastCheck = getLastCheckTime();

  return c.json({
    schedulerRunning: isSchedulerRunning(),
    lastCheckTime: lastCheck?.toISOString() || null,
  });
});

adminSettingsRoutes.post("/alerts/check", async (c) => {
  const result = await runHealthCheck();
  return c.json(result);
});

adminSettingsRoutes.post("/alerts/start", async (c) => {
  await startHealthAlertScheduler();
  return c.json({
    success: true,
    running: isSchedulerRunning(),
    message: isSchedulerRunning()
      ? "Alert scheduler started"
      : "Alert scheduler could not start (check configuration)",
  });
});

adminSettingsRoutes.post("/alerts/stop", async (c) => {
  stopHealthAlertScheduler();
  return c.json({
    success: true,
    running: false,
    message: "Alert scheduler stopped",
  });
});

// ============================================================================
// Worker/Fairness Endpoints
// ============================================================================

/**
 * Get current fairness scheduler metrics
 * Shows active runs, slot allocation, and throughput
 */
adminSettingsRoutes.get("/workers/fairness/metrics", async (c) => {
  try {
    const metrics = await getFairnessMetrics();
    return c.json({
      success: true,
      metrics,
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get fairness metrics",
      metrics: null,
    });
  }
});

/**
 * Reset fairness state (emergency use only)
 * Clears all active run registrations and slot counts
 */
adminSettingsRoutes.post("/workers/fairness/reset", async (c) => {
  try {
    await resetFairnessState();
    return c.json({
      success: true,
      message: "Fairness state reset successfully",
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset fairness state",
    });
  }
});
