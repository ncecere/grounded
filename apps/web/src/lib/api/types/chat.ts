export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Array<{
    index: number;
    title: string;
    url?: string;
    snippet: string;
  }>;
}

export type ReasoningStepType = "rewrite" | "plan" | "search" | "merge" | "generate";
export type ReasoningStepStatus = "pending" | "in_progress" | "completed" | "error";

export interface ReasoningStep {
  id: string;
  type: ReasoningStepType;
  title: string;
  summary: string;
  status: ReasoningStepStatus;
  details?: Record<string, unknown>;
}
