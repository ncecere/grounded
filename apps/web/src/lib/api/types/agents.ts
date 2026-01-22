import type {
  Agent as SharedAgent,
  RagType as SharedRagType,
  RetrievalConfig as SharedRetrievalConfig,
  WidgetConfig,
} from "@grounded/shared/types/api";

export type RagType = SharedRagType;

export type RetrievalConfig = Omit<SharedRetrievalConfig, "rerankerEnabled" | "rerankerType"> & {
  maxCitations: number;
  similarityThreshold: number;
  rerankerEnabled?: SharedRetrievalConfig["rerankerEnabled"];
  rerankerType?: SharedRetrievalConfig["rerankerType"];
};

export type AgentWidgetConfig = WidgetConfig & {
  id: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
};

export interface Agent extends SharedAgent {
  description: string | null;
  welcomeMessage: string | null;
  logoUrl: string | null;
  isEnabled: boolean;
  showReasoningSteps: boolean;
  suggestedQuestions: string[];
  kbIds: string[];
  llmModelConfigId: string | null;
  widgetConfig: AgentWidgetConfig | null;
  retrievalConfig: RetrievalConfig;
  updatedAt: string;
}

export interface LLMModel {
  id: string;
  modelId: string;
  displayName: string;
  providerName: string;
  isDefault: boolean;
}

export interface ChatEndpoint {
  id: string;
  name: string | null;
  token: string;
  endpointType: "api" | "hosted";
  createdAt: string;
}
