import { request } from "./client";
import type { Agent, ChatEndpoint, LLMModel, RagType } from "./types/agents";

export const agentsApi = {
  listAgents: async () => {
    const res = await request<{ agents: Agent[] }>("/agents");
    return res.agents;
  },

  listLLMModels: async () => {
    const res = await request<{ models: LLMModel[] }>("/agents/models");
    return res.models;
  },

  getAgent: async (id: string) => {
    const res = await request<{ agent: Agent }>(`/agents/${id}`);
    return res.agent;
  },

  createAgent: async (data: {
    name: string;
    description?: string;
    systemPrompt: string;
    welcomeMessage?: string;
    suggestedQuestions?: string[];
    kbIds: string[];
    llmModelConfigId?: string;
    ragType?: RagType;
    showReasoningSteps?: boolean;
  }) => {
    const res = await request<{ agent: Agent }>("/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.agent;
  },

  updateAgent: async (
    id: string,
    data: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      welcomeMessage?: string;
      logoUrl?: string | null;
      isEnabled?: boolean;
      ragType?: RagType;
      showReasoningSteps?: boolean;
      suggestedQuestions?: string[];
      kbIds?: string[];
      llmModelConfigId?: string | null;
      widgetConfig?: Record<string, unknown>;
      retrievalConfig?: Record<string, unknown>;
    }
  ) => {
    const res = await request<{ agent: Agent }>(`/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.agent;
  },

  deleteAgent: (id: string) => request<void>(`/agents/${id}`, { method: "DELETE" }),

  getWidgetToken: (id: string) => request<{ token: string }>(`/agents/${id}/widget-token`),

  getWidgetConfig: async (agentId: string) => {
    const res = await request<{ widgetConfig: Agent["widgetConfig"]; tokens: { id: string; name: string; token: string }[] }>(`/agents/${agentId}/widget`);
    return res;
  },

  updateWidgetConfig: async (
    agentId: string,
    data: {
      isPublic?: boolean;
      allowedDomains?: string[];
      oidcRequired?: boolean;
      theme?: {
        primaryColor?: string;
        backgroundColor?: string;
        textColor?: string;
        buttonPosition?: "bottom-right" | "bottom-left";
        borderRadius?: number;
        buttonStyle?: "circle" | "pill" | "square";
        buttonSize?: "small" | "medium" | "large";
        buttonText?: string;
        buttonIcon?: "chat" | "help" | "question" | "message";
        buttonColor?: string;
        customIconUrl?: string | null;
        customIconSize?: number | null;
      };
    }
  ) => {
    const res = await request<{ widgetConfig: Agent["widgetConfig"] }>(`/agents/${agentId}/widget`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.widgetConfig;
  },

  getRetrievalConfig: async (agentId: string) => {
    const res = await request<{ retrievalConfig: Agent["retrievalConfig"] }>(`/agents/${agentId}/retrieval-config`);
    return res.retrievalConfig;
  },

  updateRetrievalConfig: async (
    agentId: string,
    data: {
      topK?: number;
      candidateK?: number;
      maxCitations?: number;
      rerankerEnabled?: boolean;
      similarityThreshold?: number;
      historyTurns?: number;
      advancedMaxSubqueries?: number;
    }
  ) => {
    const res = await request<{ retrievalConfig: Agent["retrievalConfig"] }>(`/agents/${agentId}/retrieval-config`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.retrievalConfig;
  },

  // Chat Endpoints
  listChatEndpoints: async (agentId: string) => {
    const res = await request<{ chatEndpoints: ChatEndpoint[] }>(`/agents/${agentId}/chat-endpoints`);
    return res.chatEndpoints;
  },

  createChatEndpoint: async (
    agentId: string,
    data: { name?: string; endpointType: "api" | "hosted" }
  ) => {
    const res = await request<{ chatEndpoint: ChatEndpoint }>(`/agents/${agentId}/chat-endpoints`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.chatEndpoint;
  },

  deleteChatEndpoint: (agentId: string, endpointId: string) =>
    request<{ message: string }>(`/agents/${agentId}/chat-endpoints/${endpointId}`, { method: "DELETE" }),
};
