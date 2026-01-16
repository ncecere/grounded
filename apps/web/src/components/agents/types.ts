import type { Agent, ChatEndpoint } from "../../lib/api";

export type { Agent, ChatEndpoint };

export interface AgentFormData {
  name: string;
  description: string;
  systemPrompt: string;
  welcomeMessage: string;
  logoUrl: string;
  kbIds: string[];
  llmModelConfigId: string;
}

export interface RetrievalConfig {
  candidateK: number;
  topK: number;
  maxCitations: number;
  rerankerEnabled: boolean;
  similarityThreshold: number;
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
};

export const defaultRetrievalConfig: RetrievalConfig = {
  candidateK: 40,
  topK: 8,
  maxCitations: 3,
  rerankerEnabled: true,
  similarityThreshold: 0.5,
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
