import type { Agent, ChatEndpoint, RagType } from "../../lib/api";

export type { Agent, ChatEndpoint, RagType };

export interface AgentFormData {
  name: string;
  description: string;
  systemPrompt: string;
  welcomeMessage: string;
  logoUrl: string;
  kbIds: string[];
  llmModelConfigId: string;
  ragType: RagType;
  showReasoningSteps: boolean;
}

export interface RetrievalConfig {
  candidateK: number;
  topK: number;
  maxCitations: number;
  similarityThreshold: number;
  historyTurns: number;
  advancedMaxSubqueries: number;
}

export interface ButtonConfig {
  buttonStyle: "circle" | "pill" | "square";
  buttonSize: "small" | "medium" | "large";
  buttonText: string;
  buttonIcon: "chat" | "help" | "question" | "message";
  buttonColor: string;
  buttonPosition: "bottom-right" | "bottom-left";
  customIconUrl: string;
  customIconSize: number | null;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  isShared?: boolean;
}

export interface LLMModel {
  id: string;
  displayName: string;
  providerName: string;
  isDefault?: boolean;
}

export const defaultAgentForm: AgentFormData = {
  name: "",
  description: "",
  systemPrompt: "You are a helpful assistant. Answer questions based on the provided context. If you don't know the answer, say so.",
  welcomeMessage: "How can I help?",
  logoUrl: "",
  kbIds: [],
  llmModelConfigId: "",
  ragType: "simple",
  showReasoningSteps: true,
};

export const defaultRetrievalConfig: RetrievalConfig = {
  candidateK: 40,
  topK: 8,
  maxCitations: 3,
  similarityThreshold: 0.5,
  historyTurns: 5,
  advancedMaxSubqueries: 3,
};

export const defaultButtonConfig: ButtonConfig = {
  buttonStyle: "circle",
  buttonSize: "medium",
  buttonText: "Chat with us",
  buttonIcon: "chat",
  buttonColor: "#2563eb",
  buttonPosition: "bottom-right",
  customIconUrl: "",
  customIconSize: null,
};

export const colorPresets = [
  { name: "Blue", value: "#2563eb" },
  { name: "Indigo", value: "#4f46e5" },
  { name: "Purple", value: "#7c3aed" },
  { name: "Pink", value: "#db2777" },
  { name: "Red", value: "#dc2626" },
  { name: "Orange", value: "#ea580c" },
  { name: "Green", value: "#16a34a" },
  { name: "Teal", value: "#0d9488" },
  { name: "Slate", value: "#475569" },
  { name: "Black", value: "#18181b" },
];
