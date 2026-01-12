import type { LanguageModelV3, EmbeddingModelV3 } from "@ai-sdk/provider";

export type ProviderType = "openai" | "anthropic" | "google" | "openai-compatible";
export type ModelType = "chat" | "embedding";

export interface ProviderConfig {
  id: string;
  name: string;
  displayName: string;
  type: ProviderType;
  baseUrl: string | null;
  apiKey: string;
  isEnabled: boolean;
}

export interface ModelConfig {
  id: string;
  providerId: string;
  providerName: string;
  providerType: ProviderType;
  modelId: string;
  displayName: string;
  modelType: ModelType;
  maxTokens: number | null;
  temperature: number | null;
  supportsStreaming: boolean | null;
  supportsTools: boolean | null;
  dimensions: number | null;
  isEnabled: boolean;
  isDefault: boolean;
}

export interface AIProviderRegistry {
  /**
   * Get a language model by config ID.
   * If no ID provided, returns the default chat model.
   * Returns null if no model is configured.
   */
  getLanguageModel(modelConfigId?: string): Promise<LanguageModelV3 | null>;

  /**
   * Get an embedding model by config ID.
   * If no ID provided, returns the default embedding model.
   * Returns null if no model is configured.
   */
  getEmbeddingModel(modelConfigId?: string): Promise<EmbeddingModelV3 | null>;

  /**
   * Check if at least one chat model is available.
   */
  hasChatModel(): Promise<boolean>;

  /**
   * Check if at least one embedding model is available.
   */
  hasEmbeddingModel(): Promise<boolean>;

  /**
   * List all configured models, optionally filtered by type.
   */
  listModels(type?: ModelType): Promise<ModelConfig[]>;

  /**
   * List all configured providers.
   */
  listProviders(): Promise<ProviderConfig[]>;

  /**
   * Get the default model config for a given type.
   */
  getDefaultModel(type: ModelType): Promise<ModelConfig | null>;

  /**
   * Refresh configuration from database.
   */
  refreshConfig(): Promise<void>;

  /**
   * Check if the registry has been initialized.
   */
  isInitialized(): boolean;
}
