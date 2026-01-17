import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import { modelProviders, modelConfigurations, type ProviderType, type ModelType } from "@grounded/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { auth, requireSystemAdmin, withRequestRLS } from "../../middleware/auth";
import { BadRequestError, NotFoundError } from "../../middleware/error-handler";
import { getAIRegistry, resetAIRegistry } from "@grounded/ai-providers";

export const adminModelsRoutes = new Hono();

// All routes require system admin
adminModelsRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// Validation Schemas
// ============================================================================

const providerTypes = ["openai", "anthropic", "google", "openai-compatible"] as const;
const modelTypes = ["chat", "embedding"] as const;

const createProviderSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Must be lowercase alphanumeric with hyphens"),
  displayName: z.string().min(1).max(200),
  type: z.enum(providerTypes),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1),
  isEnabled: z.boolean().optional().default(true),
});

const updateProviderSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  type: z.enum(providerTypes).optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
});

const createModelSchema = z.object({
  providerId: z.string().uuid(),
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  modelType: z.enum(modelTypes),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  supportsStreaming: z.boolean().optional().default(true),
  supportsTools: z.boolean().optional().default(false),
  dimensions: z.number().int().positive().optional().nullable(),
  isEnabled: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});

const updateModelSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  supportsStreaming: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  dimensions: z.number().int().positive().optional().nullable(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

// ============================================================================
// Provider Routes
// ============================================================================

// List all providers
adminModelsRoutes.get("/providers", async (c) => {
  const providers = await withRequestRLS(c, async (tx) => {
    return tx.query.modelProviders.findMany({
      orderBy: (providers, { asc }) => [asc(providers.displayName)],
    });
  });

  // Mask API keys
  const maskedProviders = providers.map((p) => ({
    ...p,
    apiKey: "***REDACTED***",
  }));

  return c.json({ providers: maskedProviders });
});

// Get single provider
adminModelsRoutes.get("/providers/:id", async (c) => {
  const id = c.req.param("id");

  const provider = await withRequestRLS(c, async (tx) => {
    return tx.query.modelProviders.findFirst({
      where: eq(modelProviders.id, id),
      with: { models: true },
    });
  });

  if (!provider) {
    throw new NotFoundError("Provider not found");
  }

  return c.json({
    provider: {
      ...provider,
      apiKey: "***REDACTED***",
    },
  });
});

// Create provider
adminModelsRoutes.post(
  "/providers",
  zValidator("json", createProviderSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    // Check for duplicate name
    const existing = await withRequestRLS(c, async (tx) => {
      return tx.query.modelProviders.findFirst({
        where: eq(modelProviders.name, body.name),
      });
    });

    if (existing) {
      throw new BadRequestError(`Provider with name "${body.name}" already exists`);
    }

    // Validate baseUrl required for openai-compatible
    if (body.type === "openai-compatible" && !body.baseUrl) {
      throw new BadRequestError("Base URL is required for OpenAI-compatible providers");
    }

    const [provider] = await withRequestRLS(c, async (tx) => {
      return tx
        .insert(modelProviders)
        .values({
          name: body.name,
          displayName: body.displayName,
          type: body.type as ProviderType,
          baseUrl: body.baseUrl || null,
          apiKey: body.apiKey,
          isEnabled: body.isEnabled,
          createdBy: authContext.user.id,
        })
        .returning();
    });

    // Reset registry to pick up new provider
    resetAIRegistry();

    return c.json({
      message: "Provider created",
      provider: { ...provider, apiKey: "***REDACTED***" },
    }, 201);
  }
);

// Update provider
adminModelsRoutes.patch(
  "/providers/:id",
  zValidator("json", updateProviderSchema),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await withRequestRLS(c, async (tx) => {
      return tx.query.modelProviders.findFirst({
        where: eq(modelProviders.id, id),
      });
    });

    if (!existing) {
      throw new NotFoundError("Provider not found");
    }

    // Validate baseUrl if changing type to openai-compatible
    if (body.type === "openai-compatible" && !body.baseUrl && !existing.baseUrl) {
      throw new BadRequestError("Base URL is required for OpenAI-compatible providers");
    }

    // Build update object, excluding undefined values
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.type !== undefined) updates.type = body.type;
    if (body.baseUrl !== undefined) updates.baseUrl = body.baseUrl;
    if (body.apiKey !== undefined) updates.apiKey = body.apiKey;
    if (body.isEnabled !== undefined) updates.isEnabled = body.isEnabled;

    const [provider] = await withRequestRLS(c, async (tx) => {
      return tx
        .update(modelProviders)
        .set(updates)
        .where(eq(modelProviders.id, id))
        .returning();
    });

    // Reset registry to pick up changes
    resetAIRegistry();

    return c.json({
      message: "Provider updated",
      provider: { ...provider, apiKey: "***REDACTED***" },
    });
  }
);

// Delete provider
adminModelsRoutes.delete("/providers/:id", async (c) => {
  const id = c.req.param("id");

  const existing = await withRequestRLS(c, async (tx) => {
    return tx.query.modelProviders.findFirst({
      where: eq(modelProviders.id, id),
      with: { models: true },
    });
  });

  if (!existing) {
    throw new NotFoundError("Provider not found");
  }

  // Check if any models are set as default
  const hasDefaultModels = existing.models.some((m) => m.isDefault);
  if (hasDefaultModels) {
    throw new BadRequestError("Cannot delete provider with default models. Remove defaults first.");
  }

  await withRequestRLS(c, async (tx) => {
    return tx.delete(modelProviders).where(eq(modelProviders.id, id));
  });

  // Reset registry
  resetAIRegistry();

  return c.json({ message: "Provider deleted" });
});

// Test provider connection
adminModelsRoutes.post("/providers/:id/test", async (c) => {
  const id = c.req.param("id");

  const provider = await withRequestRLS(c, async (tx) => {
    return tx.query.modelProviders.findFirst({
      where: eq(modelProviders.id, id),
    });
  });

  if (!provider) {
    throw new NotFoundError("Provider not found");
  }

  try {
    // Force refresh the registry to get the latest provider config
    resetAIRegistry();
    const registry = getAIRegistry();
    await registry.refreshConfig();

    // Try to list models or make a simple API call
    // This validates that the API key and URL are correct
    const models = await registry.listModels();
    const providerModels = models.filter((m) => m.providerName === provider.name);

    return c.json({
      success: true,
      message: "Connection successful",
      modelsFound: providerModels.length,
    });
  } catch (error) {
    return c.json({
      success: false,
      message: error instanceof Error ? error.message : "Connection failed",
    }, 400);
  }
});

// ============================================================================
// Model Configuration Routes
// ============================================================================

// List all models
adminModelsRoutes.get("/models", async (c) => {
  const type = c.req.query("type") as ModelType | undefined;
  const providerId = c.req.query("providerId");

  let whereClause = undefined;
  if (type && providerId) {
    whereClause = and(
      eq(modelConfigurations.modelType, type),
      eq(modelConfigurations.providerId, providerId)
    );
  } else if (type) {
    whereClause = eq(modelConfigurations.modelType, type);
  } else if (providerId) {
    whereClause = eq(modelConfigurations.providerId, providerId);
  }

  const models = await withRequestRLS(c, async (tx) => {
    return tx.query.modelConfigurations.findMany({
      where: whereClause,
      with: { provider: true },
      orderBy: (models, { asc, desc }) => [desc(models.isDefault), asc(models.displayName)],
    });
  });

  return c.json({ models });
});

// Get single model
adminModelsRoutes.get("/models/:id", async (c) => {
  const id = c.req.param("id");

  const model = await withRequestRLS(c, async (tx) => {
    return tx.query.modelConfigurations.findFirst({
      where: eq(modelConfigurations.id, id),
      with: { provider: true },
    });
  });

  if (!model) {
    throw new NotFoundError("Model configuration not found");
  }

  return c.json({ model });
});

// Create model configuration
adminModelsRoutes.post(
  "/models",
  zValidator("json", createModelSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    // Verify provider exists
    const provider = await withRequestRLS(c, async (tx) => {
      return tx.query.modelProviders.findFirst({
        where: eq(modelProviders.id, body.providerId),
      });
    });

    if (!provider) {
      throw new BadRequestError("Provider not found");
    }

    // Check for duplicate
    const existing = await withRequestRLS(c, async (tx) => {
      return tx.query.modelConfigurations.findFirst({
        where: and(
          eq(modelConfigurations.providerId, body.providerId),
          eq(modelConfigurations.modelId, body.modelId),
          eq(modelConfigurations.modelType, body.modelType)
        ),
      });
    });

    if (existing) {
      throw new BadRequestError("Model configuration already exists for this provider and type");
    }

    // Validate dimensions for embedding models
    if (body.modelType === "embedding" && !body.dimensions) {
      throw new BadRequestError("Dimensions are required for embedding models");
    }

    const [model] = await withRequestRLS(c, async (tx) => {
      // If setting as default, unset other defaults of same type
      if (body.isDefault) {
        await tx
          .update(modelConfigurations)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(modelConfigurations.modelType, body.modelType));
      }

      return tx
        .insert(modelConfigurations)
        .values({
          providerId: body.providerId,
          modelId: body.modelId,
          displayName: body.displayName,
          modelType: body.modelType as ModelType,
          maxTokens: body.maxTokens || 4096,
          temperature: body.temperature?.toString() || "0.1",
          supportsStreaming: body.supportsStreaming,
          supportsTools: body.supportsTools,
          dimensions: body.dimensions || null,
          isEnabled: body.isEnabled,
          isDefault: body.isDefault,
          createdBy: authContext.user.id,
        })
        .returning();
    });

    // Reset registry
    resetAIRegistry();

    return c.json({
      message: "Model configuration created",
      model,
    }, 201);
  }
);

// Update model configuration
adminModelsRoutes.patch(
  "/models/:id",
  zValidator("json", updateModelSchema),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await withRequestRLS(c, async (tx) => {
      return tx.query.modelConfigurations.findFirst({
        where: eq(modelConfigurations.id, id),
      });
    });

    if (!existing) {
      throw new NotFoundError("Model configuration not found");
    }

    // Build update object
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.maxTokens !== undefined) updates.maxTokens = body.maxTokens;
    if (body.temperature !== undefined) updates.temperature = body.temperature.toString();
    if (body.supportsStreaming !== undefined) updates.supportsStreaming = body.supportsStreaming;
    if (body.supportsTools !== undefined) updates.supportsTools = body.supportsTools;
    if (body.dimensions !== undefined) updates.dimensions = body.dimensions;
    if (body.isEnabled !== undefined) updates.isEnabled = body.isEnabled;
    if (body.isDefault !== undefined) updates.isDefault = body.isDefault;

    const [model] = await withRequestRLS(c, async (tx) => {
      // If setting as default, unset other defaults of same type
      if (body.isDefault && !existing.isDefault) {
        await tx
          .update(modelConfigurations)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(
            eq(modelConfigurations.modelType, existing.modelType),
            ne(modelConfigurations.id, id)
          ));
      }

      return tx
        .update(modelConfigurations)
        .set(updates)
        .where(eq(modelConfigurations.id, id))
        .returning();
    });

    // Reset registry
    resetAIRegistry();

    return c.json({ message: "Model configuration updated", model });
  }
);

// Delete model configuration
adminModelsRoutes.delete("/models/:id", async (c) => {
  const id = c.req.param("id");

  const existing = await withRequestRLS(c, async (tx) => {
    return tx.query.modelConfigurations.findFirst({
      where: eq(modelConfigurations.id, id),
    });
  });

  if (!existing) {
    throw new NotFoundError("Model configuration not found");
  }

  if (existing.isDefault) {
    throw new BadRequestError("Cannot delete a default model. Set another model as default first.");
  }

  await withRequestRLS(c, async (tx) => {
    return tx.delete(modelConfigurations).where(eq(modelConfigurations.id, id));
  });

  // Reset registry
  resetAIRegistry();

  return c.json({ message: "Model configuration deleted" });
});

// Set model as default
adminModelsRoutes.post("/models/:id/set-default", async (c) => {
  const id = c.req.param("id");

  const model = await withRequestRLS(c, async (tx) => {
    return tx.query.modelConfigurations.findFirst({
      where: eq(modelConfigurations.id, id),
    });
  });

  if (!model) {
    throw new NotFoundError("Model configuration not found");
  }

  if (!model.isEnabled) {
    throw new BadRequestError("Cannot set a disabled model as default");
  }

  await withRequestRLS(c, async (tx) => {
    // Unset other defaults of same type
    await tx
      .update(modelConfigurations)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(modelConfigurations.modelType, model.modelType));

    // Set this one as default
    await tx
      .update(modelConfigurations)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(modelConfigurations.id, id));
  });

  // Reset registry
  resetAIRegistry();

  return c.json({ message: "Model set as default", modelType: model.modelType });
});

// ============================================================================
// Registry Status
// ============================================================================

// Get current registry status
adminModelsRoutes.get("/status", async (c) => {
  try {
    const registry = getAIRegistry();
    const providers = await registry.listProviders();
    const chatModels = await registry.listModels("chat");
    const embeddingModels = await registry.listModels("embedding");
    const defaultChat = await registry.getDefaultModel("chat");
    const defaultEmbedding = await registry.getDefaultModel("embedding");

    return c.json({
      initialized: registry.isInitialized(),
      providerCount: providers.length,
      chatModelCount: chatModels.length,
      embeddingModelCount: embeddingModels.length,
      defaultChatModel: defaultChat?.displayName || null,
      defaultEmbeddingModel: defaultEmbedding?.displayName || null,
    });
  } catch (error) {
    return c.json({
      initialized: false,
      error: error instanceof Error ? error.message : "Failed to get registry status",
    });
  }
});

// Force refresh registry
adminModelsRoutes.post("/refresh", async (c) => {
  try {
    resetAIRegistry();
    const registry = getAIRegistry();
    await registry.refreshConfig();

    return c.json({ message: "Registry refreshed successfully" });
  } catch (error) {
    return c.json({
      message: "Registry refresh failed",
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
