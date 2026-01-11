import type { LanguageModelV1, EmbeddingModelV1 } from "@ai-sdk/provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { db } from "@kcb/db";
import { modelProviders, modelConfigurations } from "@kcb/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@kcb/shared";
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

  async getLanguageModel(modelConfigId?: string): Promise<LanguageModelV1> {
    await this.ensureFresh();

    const configId = modelConfigId || this.defaultChatModelId;
    if (!configId) {
      throw new Error("No chat model configured. Please configure a default chat model in settings.");
    }

    const config = this.models.get(configId);
    if (!config || config.modelType !== "chat") {
      throw new Error(`Chat model not found: ${configId}`);
    }

    const provider = this.providers.get(config.providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${config.providerName}`);
    }

    // Return the language model based on provider type
    return provider.languageModel(config.modelId);
  }

  async getEmbeddingModel(modelConfigId?: string): Promise<EmbeddingModelV1<string>> {
    await this.ensureFresh();

    const configId = modelConfigId || this.defaultEmbeddingModelId;
    if (!configId) {
      throw new Error("No embedding model configured. Please configure a default embedding model in settings.");
    }

    const config = this.models.get(configId);
    if (!config || config.modelType !== "embedding") {
      throw new Error(`Embedding model not found: ${configId}`);
    }

    const provider = this.providers.get(config.providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${config.providerName}`);
    }

    // Return the embedding model based on provider type
    return provider.textEmbeddingModel(config.modelId);
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

      // If no providers configured in DB, fallback to environment variables
      if (this.providers.size === 0) {
        this.initializeFromEnvVars();
      }

      this.lastRefresh = Date.now();
      this.initialized = true;

      console.log(
        `[AI Registry] Loaded ${this.providers.size} providers, ${this.models.size} models`
      );
    } catch (error) {
      console.error("[AI Registry] Failed to refresh config:", error);
      // Try env var fallback on error
      if (this.providers.size === 0) {
        this.initializeFromEnvVars();
      }
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

  private initializeFromEnvVars(): void {
    console.log("[AI Registry] No database config found, falling back to environment variables");

    // LLM configuration from env
    const llmApiKey = getEnv("LLM_API_KEY", "");
    const llmApiUrl = getEnv("LLM_API_URL", "https://api.openai.com/v1");
    const llmModel = getEnv("LLM_MODEL", "gpt-4o-mini");

    // Embedding configuration from env
    const embeddingApiKey = getEnv("EMBEDDING_API_KEY", "");
    const embeddingApiUrl = getEnv("EMBEDDING_API_URL", "https://api.openai.com/v1");
    const embeddingModel = getEnv("EMBEDDING_MODEL", "text-embedding-3-small");
    const embeddingDimensions = parseInt(getEnv("EMBEDDING_DIMENSIONS", "1536"));

    if (llmApiKey) {
      // Create OpenAI provider for LLM
      const llmProviderConfig: ProviderConfig = {
        id: "env-llm",
        name: "openai-env",
        displayName: "OpenAI (Environment)",
        type: "openai",
        baseUrl: llmApiUrl !== "https://api.openai.com/v1" ? llmApiUrl : null,
        apiKey: llmApiKey,
        isEnabled: true,
      };

      const provider = this.createProvider(llmProviderConfig);
      if (provider) {
        this.providers.set("openai-env", provider);
        this.providerConfigs.set("openai-env", llmProviderConfig);

        // Create chat model config
        const chatConfig: ModelConfig = {
          id: "env-chat",
          providerId: "env-llm",
          providerName: "openai-env",
          providerType: "openai",
          modelId: llmModel,
          displayName: `${llmModel} (env)`,
          modelType: "chat",
          maxTokens: parseInt(getEnv("LLM_MAX_TOKENS", "1024")),
          temperature: parseFloat(getEnv("LLM_TEMPERATURE", "0.1")),
          supportsStreaming: true,
          supportsTools: true,
          dimensions: null,
          isEnabled: true,
          isDefault: true,
        };

        this.models.set("env-chat", chatConfig);
        this.defaultChatModelId = "env-chat";
      }
    }

    if (embeddingApiKey) {
      // Check if we need a separate provider for embeddings
      const sameProvider = llmApiKey === embeddingApiKey && llmApiUrl === embeddingApiUrl;

      if (!sameProvider) {
        const embeddingProviderConfig: ProviderConfig = {
          id: "env-embedding",
          name: "openai-env-embedding",
          displayName: "OpenAI Embedding (Environment)",
          type: "openai",
          baseUrl: embeddingApiUrl !== "https://api.openai.com/v1" ? embeddingApiUrl : null,
          apiKey: embeddingApiKey,
          isEnabled: true,
        };

        const provider = this.createProvider(embeddingProviderConfig);
        if (provider) {
          this.providers.set("openai-env-embedding", provider);
          this.providerConfigs.set("openai-env-embedding", embeddingProviderConfig);
        }
      }

      // Create embedding model config
      const embeddingConfig: ModelConfig = {
        id: "env-embedding",
        providerId: sameProvider ? "env-llm" : "env-embedding",
        providerName: sameProvider ? "openai-env" : "openai-env-embedding",
        providerType: "openai",
        modelId: embeddingModel,
        displayName: `${embeddingModel} (env)`,
        modelType: "embedding",
        maxTokens: null,
        temperature: null,
        supportsStreaming: false,
        supportsTools: false,
        dimensions: embeddingDimensions,
        isEnabled: true,
        isDefault: true,
      };

      this.models.set("env-embedding", embeddingConfig);
      this.defaultEmbeddingModelId = "env-embedding";
    }

    this.initialized = true;
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
