export type RagType = "simple" | "advanced";

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  welcomeMessage: string | null;
  logoUrl: string | null;
  isEnabled: boolean;
  ragType: RagType;
  showReasoningSteps: boolean;
  suggestedQuestions: string[];
  kbIds: string[];
  llmModelConfigId: string | null;
  widgetConfig: {
    id: string;
    agentId: string;
    isPublic: boolean;
    allowedDomains: string[];
    oidcRequired: boolean;
    theme: {
      primaryColor: string;
      backgroundColor: string;
      textColor: string;
      buttonPosition: "bottom-right" | "bottom-left";
      borderRadius: number;
      buttonStyle: "circle" | "pill" | "square";
      buttonSize: "small" | "medium" | "large";
      buttonText: string;
      buttonIcon: "chat" | "help" | "question" | "message";
      buttonColor: string;
      customIconUrl: string | null;
      customIconSize: number | null;
    };
    createdAt: string;
    updatedAt: string;
  } | null;
  retrievalConfig: {
    topK: number;
    candidateK: number;
    maxCitations: number;
    similarityThreshold: number;
    historyTurns: number;
    advancedMaxSubqueries: number;
  };
  createdAt: string;
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
