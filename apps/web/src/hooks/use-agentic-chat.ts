import { useState, useCallback, useRef } from "react";
import { api, type ChainOfThoughtStep, type ChatMessage } from "@/lib/api";
import type { AgenticStreamState, StreamingStatus } from "@/components/ai-elements/agentic-chat-display";

export interface UseAgenticChatOptions {
  agentId: string;
  onError?: (error: string) => void;
  onComplete?: (data: {
    conversationId: string;
    citations: ChatMessage["citations"];
    chainOfThought?: ChainOfThoughtStep[];
    toolCallsCount?: number;
  }) => void;
}

export interface UseAgenticChatReturn {
  state: AgenticStreamState;
  sendMessage: (message: string, conversationId?: string) => Promise<void>;
  reset: () => void;
  isStreaming: boolean;
}

const initialState: AgenticStreamState = {
  status: "idle",
  steps: [],
  responseText: "",
  isStreaming: false,
};

export function useAgenticChat({
  agentId,
  onError,
  onComplete,
}: UseAgenticChatOptions): UseAgenticChatReturn {
  const [state, setState] = useState<AgenticStreamState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState(initialState);
  }, []);

  const sendMessage = useCallback(
    async (message: string, conversationId?: string) => {
      // Reset state for new message
      setState({
        status: "thinking",
        statusMessage: "Analyzing your question...",
        steps: [],
        responseText: "",
        isStreaming: true,
      });

      try {
        await api.agenticChatStream(
          agentId,
          message,
          conversationId,
          // onChunk - text streaming
          (text: string) => {
            setState((prev) => ({
              ...prev,
              status: "generating",
              responseText: prev.responseText + text,
            }));
          },
          // onDone
          (data) => {
            setState((prev) => ({
              ...prev,
              status: "complete",
              isStreaming: false,
              steps: data.chainOfThought || prev.steps,
            }));
            onComplete?.(data);
          },
          // onError
          (error: string) => {
            setState((prev) => ({
              ...prev,
              status: "error",
              isStreaming: false,
              error,
            }));
            onError?.(error);
          },
          // onStatus
          (statusData) => {
            setState((prev) => {
              const newStatus = mapStatus(statusData.status);
              return {
                ...prev,
                status: newStatus,
                statusMessage: statusData.message,
                currentToolName: statusData.toolName,
              };
            });
          },
          // onChainOfThought
          (step: ChainOfThoughtStep) => {
            setState((prev) => ({
              ...prev,
              steps: [...prev.steps, step],
              // Update status based on step type
              status: mapStepTypeToStatus(step.type),
              statusMessage: getStepMessage(step),
              currentToolName: step.toolName,
            }));
          }
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to send message";
        setState((prev) => ({
          ...prev,
          status: "error",
          isStreaming: false,
          error: errorMessage,
        }));
        onError?.(errorMessage);
      }
    },
    [agentId, onComplete, onError]
  );

  return {
    state,
    sendMessage,
    reset,
    isStreaming: state.isStreaming,
  };
}

// Helper to map backend status strings to our StreamingStatus type
function mapStatus(status: string): StreamingStatus {
  switch (status) {
    case "searching":
      return "searching";
    case "tool_call":
      return "tool_call";
    case "generating":
      return "generating";
    default:
      return "thinking";
  }
}

// Helper to map step types to status
function mapStepTypeToStatus(type: ChainOfThoughtStep["type"]): StreamingStatus {
  switch (type) {
    case "thinking":
      return "thinking";
    case "searching":
      return "searching";
    case "tool_call":
      return "tool_call";
    case "tool_result":
      return "tool_call"; // Still in tool_call phase
    case "answering":
      return "generating";
    default:
      return "thinking";
  }
}

// Helper to get a human-readable message for a step
function getStepMessage(step: ChainOfThoughtStep): string {
  switch (step.type) {
    case "thinking":
      return "Analyzing your question...";
    case "searching":
      return step.kbName
        ? `Searching "${step.kbName}"...`
        : "Searching knowledge base...";
    case "tool_call":
      return step.toolName
        ? `Using ${step.toolName}...`
        : "Executing tool...";
    case "tool_result":
      return step.toolName
        ? `${step.toolName} completed`
        : "Tool completed";
    case "answering":
      return "Generating response...";
    default:
      return step.content || "Processing...";
  }
}
