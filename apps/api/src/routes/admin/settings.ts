import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@kcb/db";
import { systemSettings } from "@kcb/db/schema";
import { eq } from "drizzle-orm";
import { auth, requireSystemAdmin } from "../../middleware/auth";
import { BadRequestError } from "../../middleware/error-handler";

export const adminSettingsRoutes = new Hono();

// All routes require system admin
adminSettingsRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// Types and Metadata
// ============================================================================

type SettingCategory = "llm" | "embedding" | "auth" | "quotas" | "general";

interface SettingMeta {
  category: SettingCategory;
  isSecret: boolean;
  description: string;
  defaultValue: string | number | boolean;
}

const SETTINGS_METADATA: Record<string, SettingMeta> = {
  // LLM Settings
  "llm.api_url": {
    category: "llm",
    isSecret: false,
    description: "LLM API endpoint URL",
    defaultValue: "https://api.openai.com/v1",
  },
  "llm.api_key": {
    category: "llm",
    isSecret: true,
    description: "LLM API key",
    defaultValue: "",
  },
  "llm.model": {
    category: "llm",
    isSecret: false,
    description: "Default LLM model",
    defaultValue: "gpt-4o-mini",
  },
  "llm.max_tokens": {
    category: "llm",
    isSecret: false,
    description: "Maximum response tokens",
    defaultValue: 1024,
  },
  "llm.temperature": {
    category: "llm",
    isSecret: false,
    description: "Generation temperature (0-2)",
    defaultValue: 0.1,
  },

  // Embedding Settings
  "embedding.api_url": {
    category: "embedding",
    isSecret: false,
    description: "Embedding API endpoint URL",
    defaultValue: "https://api.openai.com/v1",
  },
  "embedding.api_key": {
    category: "embedding",
    isSecret: true,
    description: "Embedding API key",
    defaultValue: "",
  },
  "embedding.model": {
    category: "embedding",
    isSecret: false,
    description: "Embedding model",
    defaultValue: "text-embedding-3-small",
  },
  "embedding.dimensions": {
    category: "embedding",
    isSecret: false,
    description: "Vector dimensions",
    defaultValue: 1536,
  },

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
  const dbSettings = await db.query.systemSettings.findMany();
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

  const setting = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, key),
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

    await db
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

      await db
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
