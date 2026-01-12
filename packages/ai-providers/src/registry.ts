import type { LanguageModelV1, EmbeddingModelV1 } from "@ai-sdk/provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { db } from "@grounded/db";
import { modelProviders, modelConfigurations } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import type {
  ProviderConfig,
  ModelConfig,
  AIProviderRegistry,
  ProviderType,
  ModelType,
} from "./types";

// Provider instance type
type ProviderInstance = ReturnType<typeof createOpenAI> |
                        ReturnType<typeof createAnthropic> |
                        ReturnType<typeof createGoogleGenerativeAI> |
                        ReturnType<typeof createOpenAICompatible>;

// Singleton registry instance
let registryInstance: AIProviderRegistryImpl | null = null;

export class AIProviderRegistryImpl implements AIProviderRegistry {
  private providers: Map<string, ProviderInstance> = new Map();
  private providerConfigs: Map<string, ProviderConfig> = new Map();
  private models: Map<string, ModelConfig> = new Map();
  private defaultChatModelId: string | null = null;
  private defaultEmbeddingModelId: string | null = null;
  private lastRefresh: number = 0;
  private initialized: boolean = false;
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  async getLanguageModel(modelConfigId?: string): Promise<LanguageModelV1 | null> {
    await this.ensureFresh();

    const configId = modelConfigId || this.defaultChatModelId;
    if (!configId) {
      console.warn("[AI Registry] No chat model configured. Please configure a default chat model in AI Models.");
      return null;
    }

    const config = this.models.get(configId);
    if (!config || config.modelType !== "chat") {
      console.warn(`[AI Registry] Chat model not found: ${configId}`);
      return null;
    }

    const provider = this.providers.get(config.providerName);
    if (!provider) {
      console.warn(`[AI Registry] Provider not found: ${config.providerName}`);
      return null;
    }

    // Return the language model based on provider type
    return provider.languageModel(config.modelId);
  }

  async getEmbeddingModel(modelConfigId?: string): Promise<EmbeddingModelV1<string> | null> {
    await this.ensureFresh();

    const configId = modelConfigId || this.defaultEmbeddingModelId;
    if (!configId) {
      console.warn("[AI Registry] No embedding model configured. Please configure a default embedding model in AI Models.");
      return null;
    }

    const config = this.models.get(configId);
    if (!config || config.modelType !== "embedding") {
      console.warn(`[AI Registry] Embedding model not found: ${configId}`);
      return null;
    }

    const provider = this.providers.get(config.providerName);
    if (!provider) {
      console.warn(`[AI Registry] Provider not found: ${config.providerName}`);
      return null;
    }

    // Return the embedding model based on provider type
    return provider.textEmbeddingModel(config.modelId);
  }

  /**
   * Check if a chat model is available
   */
  async hasChatModel(): Promise<boolean> {
    await this.ensureFresh();
    return this.defaultChatModelId !== null || this.models.size > 0;
  }

  /**
   * Check if an embedding model is available
   */
  async hasEmbeddingModel(): Promise<boolean> {
    await this.ensureFresh();
    const embeddingModels = Array.from(this.models.values()).filter(m => m.modelType === "embedding");
    return embeddingModels.length > 0;
  }

  async listModels(type?: ModelType): Promise<ModelConfig[]> {
    await this.ensureFresh();
    const models = Array.from(this.models.values());
    return type ? models.filter((m) => m.modelType === type) : models;
  }

  async listProviders(): Promise<ProviderConfig[]> {
    await this.ensureFresh();
    return Array.from(this.providerConfigs.values());
  }

  async getDefaultModel(type: ModelType): Promise<ModelConfig | null> {
    await this.ensureFresh();
    const defaultId = type === "chat" ? this.defaultChatModelId : this.defaultEmbeddingModelId;
    return defaultId ? this.models.get(defaultId) || null : null;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async refreshConfig(): Promise<void> {
    try {
      // Load providers from database
      const dbProviders = await db.query.modelProviders.findMany({
        where: eq(modelProviders.isEnabled, true),
      });

      // Load model configurations
      const dbModels = await db.query.modelConfigurations.findMany({
        where: eq(modelConfigurations.isEnabled, true),
        with: { provider: true },
      });

      // Clear existing
      this.providers.clear();
      this.providerConfigs.clear();
      this.models.clear();
      this.defaultChatModelId = null;
      this.defaultEmbeddingModelId = null;

      // Initialize providers
      for (const p of dbProviders) {
        const providerConfig: ProviderConfig = {
          id: p.id,
          name: p.name,
          displayName: p.displayName,
          type: p.type as ProviderType,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          isEnabled: p.isEnabled,
        };

        const provider = this.createProvider(providerConfig);
        if (provider) {
          this.providers.set(p.name, provider);
          this.providerConfigs.set(p.name, providerConfig);
        }
      }

      // Register models
      for (const m of dbModels) {
        if (!m.provider) continue;

        const config: ModelConfig = {
          id: m.id,
          providerId: m.providerId,
          providerName: m.provider.name,
          providerType: m.provider.type as ProviderType,
          modelId: m.modelId,
          displayName: m.displayName,
          modelType: m.modelType as ModelType,
          maxTokens: m.maxTokens,
          temperature: m.temperature ? parseFloat(m.temperature) : null,
          supportsStreaming: m.supportsStreaming,
          supportsTools: m.supportsTools,
          dimensions: m.dimensions,
          isEnabled: m.isEnabled,
          isDefault: m.isDefault,
        };

        this.models.set(m.id, config);

        if (m.isDefault) {
          if (m.modelType === "chat") this.defaultChatModelId = m.id;
          if (m.modelType === "embedding") this.defaultEmbeddingModelId = m.id;
        }
      }

      this.lastRefresh = Date.now();
      this.initialized = true;

      if (this.providers.size === 0) {
        console.warn("[AI Registry] No AI providers configured. Please configure providers in AI Models settings.");
      } else {
        console.log(
          `[AI Registry] Loaded ${this.providers.size} providers, ${this.models.size} models`
        );
      }
    } catch (error) {
      console.error("[AI Registry] Failed to refresh config:", error);
      this.initialized = true; // Mark as initialized even on error to prevent retry loops
      throw error;
    }
  }

  private createProvider(config: ProviderConfig): ProviderInstance | null {
    try {
      switch (config.type) {
        case "openai":
          return createOpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl || undefined,
          });

        case "anthropic":
          return createAnthropic({
            apiKey: config.apiKey,
          });

        case "google":
          return createGoogleGenerativeAI({
            apiKey: config.apiKey,
          });

        case "openai-compatible":
          if (!config.baseUrl) {
            console.warn(`[AI Registry] OpenAI-compatible provider ${config.name} missing baseUrl`);
            return null;
          }
          return createOpenAICompatible({
            name: config.name,
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
          });

        default:
          console.warn(`[AI Registry] Unknown provider type: ${config.type}`);
          return null;
      }
    } catch (error) {
      console.error(`[AI Registry] Failed to create provider ${config.name}:`, error);
      return null;
    }
  }

  private async ensureFresh(): Promise<void> {
    if (!this.initialized || Date.now() - this.lastRefresh > this.CACHE_TTL_MS) {
      await this.refreshConfig();
    }
  }
}

/**
 * Get the singleton AI registry instance.
 */
export function getAIRegistry(): AIProviderRegistryImpl {
  if (!registryInstance) {
    registryInstance = new AIProviderRegistryImpl();
  }
  return registryInstance;
}

/**
 * Initialize the AI registry on application startup.
 * This should be called once when the app starts.
 */
export async function initializeAIRegistry(): Promise<void> {
  const registry = getAIRegistry();
  await registry.refreshConfig();
  console.log("[AI Registry] Initialized successfully");
}

/**
 * Reset the registry instance (for testing).
 */
export function resetAIRegistry(): void {
  registryInstance = null;
}
