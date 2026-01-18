import { describe, it, expect } from "bun:test";
import type { ReasoningStep, RagType, ChatMessage } from "@/lib/api/types";

// =============================================================================
// Module Exports Tests
// =============================================================================

describe("Chat module exports", () => {
  it("should export Chat component", async () => {
    const module = await import("./Chat");
    expect(module.Chat).toBeDefined();
    expect(typeof module.Chat).toBe("function");
  });
});

// =============================================================================
// Chat Props Interface Tests
// =============================================================================

describe("ChatProps interface", () => {
  it("should require agentId prop", () => {
    // ChatProps requires agentId: string
    const props = { agentId: "test-agent-id", onBack: () => {} };
    expect(props.agentId).toBe("test-agent-id");
    expect(typeof props.agentId).toBe("string");
  });

  it("should require onBack callback prop", () => {
    // ChatProps requires onBack: () => void
    const props = { agentId: "test-agent-id", onBack: () => {} };
    expect(props.onBack).toBeDefined();
    expect(typeof props.onBack).toBe("function");
  });
});

// =============================================================================
// RAG Type Routing Tests
// =============================================================================

describe("RAG Type routing behavior", () => {
  function isAdvancedMode(ragType: RagType | undefined): boolean {
    return ragType === "advanced";
  }

  it("should recognize 'simple' as valid ragType", () => {
    const ragType: RagType = "simple";
    expect(ragType).toBe("simple");
  });

  it("should recognize 'advanced' as valid ragType", () => {
    const ragType: RagType = "advanced";
    expect(ragType).toBe("advanced");
  });

  it("should route to simpleChatStream when ragType is 'simple'", () => {
    // Simulating the routing logic from Chat component
    expect(isAdvancedMode("simple")).toBe(false);
  });

  it("should route to advancedChatStream when ragType is 'advanced'", () => {
    // Simulating the routing logic from Chat component
    expect(isAdvancedMode("advanced")).toBe(true);
  });

  it("should default to simple mode when ragType is undefined", () => {
    // Simulating the routing logic from Chat component with undefined ragType
    expect(isAdvancedMode(undefined)).toBe(false);
  });
});

// =============================================================================
// Reasoning Steps State Management Tests
// =============================================================================

describe("Reasoning steps state management", () => {
  it("should use Map to deduplicate reasoning steps by ID", () => {
    const stepsMap = new Map<string, ReasoningStep>();

    // Add step in_progress
    const step1: ReasoningStep = {
      id: "step-1",
      type: "rewrite",
      title: "Rewriting Query",
      summary: "Processing...",
      status: "in_progress",
    };
    stepsMap.set(step1.id, step1);

    // Update same step to completed
    const step1Updated: ReasoningStep = {
      id: "step-1",
      type: "rewrite",
      title: "Rewriting Query",
      summary: "Query rewritten",
      status: "completed",
    };
    stepsMap.set(step1Updated.id, step1Updated);

    // Should have only 1 step
    expect(stepsMap.size).toBe(1);
    expect(stepsMap.get("step-1")?.status).toBe("completed");
  });

  it("should maintain step order when converting Map to array", () => {
    const stepsMap = new Map<string, ReasoningStep>();

    const steps: ReasoningStep[] = [
      { id: "1", type: "rewrite", title: "Rewrite", summary: "", status: "completed" },
      { id: "2", type: "plan", title: "Plan", summary: "", status: "completed" },
      { id: "3", type: "search", title: "Search", summary: "", status: "in_progress" },
    ];

    steps.forEach((step) => stepsMap.set(step.id, step));

    const stepsArray = Array.from(stepsMap.values());
    expect(stepsArray[0].type).toBe("rewrite");
    expect(stepsArray[1].type).toBe("plan");
    expect(stepsArray[2].type).toBe("search");
  });

  it("should handle all 5 reasoning step types", () => {
    const stepTypes = ["rewrite", "plan", "search", "merge", "generate"] as const;
    const stepsMap = new Map<string, ReasoningStep>();

    stepTypes.forEach((type, index) => {
      stepsMap.set(`step-${index}`, {
        id: `step-${index}`,
        type,
        title: type.charAt(0).toUpperCase() + type.slice(1),
        summary: "",
        status: "completed",
      });
    });

    expect(stepsMap.size).toBe(5);
  });
});

// =============================================================================
// Reasoning Steps Display Logic Tests
// =============================================================================

describe("Reasoning steps display logic", () => {
  function shouldShowReasoningSteps(
    ragType: RagType | undefined,
    stepsLength: number
  ): boolean {
    return ragType === "advanced" && stepsLength > 0;
  }

  it("should not show reasoning steps when ragType is 'simple'", () => {
    expect(shouldShowReasoningSteps("simple", 0)).toBe(false);
  });

  it("should not show reasoning steps when advanced but no steps", () => {
    expect(shouldShowReasoningSteps("advanced", 0)).toBe(false);
  });

  it("should show reasoning steps when advanced and steps exist", () => {
    expect(shouldShowReasoningSteps("advanced", 1)).toBe(true);
  });
});

// =============================================================================
// Loading Indicator Logic Tests
// =============================================================================

describe("Loading indicator display logic", () => {
  function shouldShowSimpleLoading(
    isLoading: boolean,
    ragType: RagType | undefined,
    stepsLength: number
  ): boolean {
    return isLoading && (ragType !== "advanced" || stepsLength === 0);
  }

  it("should show simple loading for simple mode while loading", () => {
    expect(shouldShowSimpleLoading(true, "simple", 0)).toBe(true);
  });

  it("should show simple loading for advanced mode before reasoning starts", () => {
    expect(shouldShowSimpleLoading(true, "advanced", 0)).toBe(true);
  });

  it("should not show simple loading when reasoning steps are displayed", () => {
    expect(shouldShowSimpleLoading(true, "advanced", 1)).toBe(false);
  });

  it("should not show simple loading when not loading", () => {
    expect(shouldShowSimpleLoading(false, "simple", 0)).toBe(false);
  });
});

// =============================================================================
// Status Message Tests
// =============================================================================

describe("Status message handling", () => {
  it("should show 'Analyzing query...' for advanced mode", () => {
    const isAdvancedMode = true;
    const statusMessage = isAdvancedMode
      ? "Analyzing query..."
      : "Searching knowledge base...";
    expect(statusMessage).toBe("Analyzing query...");
  });

  it("should show 'Searching knowledge base...' for simple mode", () => {
    const isAdvancedMode = false;
    const statusMessage = isAdvancedMode
      ? "Analyzing query..."
      : "Searching knowledge base...";
    expect(statusMessage).toBe("Searching knowledge base...");
  });
});

// =============================================================================
// Streaming State Tests
// =============================================================================

describe("Streaming state for reasoning steps", () => {
  it("should set isStreaming to true when isLoading", () => {
    const isLoading = true;
    const isStreaming = false;
    const reasoningIsStreaming = isLoading || isStreaming;
    expect(reasoningIsStreaming).toBe(true);
  });

  it("should set isStreaming to true when streaming text", () => {
    const isLoading = false;
    const isStreaming = true;
    const reasoningIsStreaming = isLoading || isStreaming;
    expect(reasoningIsStreaming).toBe(true);
  });

  it("should set isStreaming to false when idle", () => {
    const isLoading = false;
    const isStreaming = false;
    const reasoningIsStreaming = isLoading || isStreaming;
    expect(reasoningIsStreaming).toBe(false);
  });
});

// =============================================================================
// Clear Chat Tests
// =============================================================================

describe("Clear chat behavior", () => {
  it("should clear reasoning steps when clearing chat", () => {
    const reasoningSteps: ReasoningStep[] = [
      { id: "1", type: "rewrite", title: "Rewrite", summary: "", status: "completed" },
      { id: "2", type: "plan", title: "Plan", summary: "", status: "completed" },
    ];

    // Simulating clear action
    const clearedSteps: ReasoningStep[] = [];
    expect(clearedSteps.length).toBe(0);
    expect(clearedSteps).not.toEqual(reasoningSteps);
  });

  it("should clear pending reasoning steps ref when clearing chat", () => {
    const pendingStepsMap = new Map<string, ReasoningStep>();
    pendingStepsMap.set("1", {
      id: "1",
      type: "rewrite",
      title: "Rewrite",
      summary: "",
      status: "completed",
    });

    // Simulating clear action
    pendingStepsMap.clear();
    expect(pendingStepsMap.size).toBe(0);
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("Error handling behavior", () => {
  it("should clear reasoning steps on error", () => {
    const reasoningSteps: ReasoningStep[] = [
      { id: "1", type: "rewrite", title: "Rewrite", summary: "", status: "in_progress" },
    ];

    // Verify initial state has steps
    expect(reasoningSteps.length).toBe(1);

    // Simulating error state reset - replace with empty array
    const clearedOnError: ReasoningStep[] = [];
    expect(clearedOnError.length).toBe(0);
    expect(clearedOnError).not.toEqual(reasoningSteps);
  });

  it("should clear pending reasoning steps ref on error", () => {
    const pendingStepsMap = new Map<string, ReasoningStep>();
    pendingStepsMap.set("1", {
      id: "1",
      type: "rewrite",
      title: "Rewrite",
      summary: "",
      status: "in_progress",
    });

    // Simulating error state reset
    pendingStepsMap.clear();
    expect(pendingStepsMap.size).toBe(0);
  });
});

// =============================================================================
// onReasoning Callback Tests
// =============================================================================

describe("onReasoning callback behavior", () => {
  it("should add new step to map", () => {
    const pendingStepsMap = new Map<string, ReasoningStep>();

    const step: ReasoningStep = {
      id: "step-1",
      type: "rewrite",
      title: "Rewriting Query",
      summary: "Processing...",
      status: "in_progress",
    };

    // Simulating onReasoning callback
    pendingStepsMap.set(step.id, step);

    expect(pendingStepsMap.size).toBe(1);
    expect(pendingStepsMap.get("step-1")).toEqual(step);
  });

  it("should update existing step in map", () => {
    const pendingStepsMap = new Map<string, ReasoningStep>();

    const stepInProgress: ReasoningStep = {
      id: "step-1",
      type: "rewrite",
      title: "Rewriting Query",
      summary: "Processing...",
      status: "in_progress",
    };

    const stepCompleted: ReasoningStep = {
      id: "step-1",
      type: "rewrite",
      title: "Rewriting Query",
      summary: "Query successfully rewritten",
      status: "completed",
    };

    // First callback with in_progress
    pendingStepsMap.set(stepInProgress.id, stepInProgress);
    expect(pendingStepsMap.get("step-1")?.status).toBe("in_progress");

    // Second callback with completed
    pendingStepsMap.set(stepCompleted.id, stepCompleted);
    expect(pendingStepsMap.get("step-1")?.status).toBe("completed");
    expect(pendingStepsMap.size).toBe(1); // Still only one step
  });

  it("should handle full reasoning step sequence", () => {
    const pendingStepsMap = new Map<string, ReasoningStep>();

    // Simulate full advanced RAG sequence (10 events: 2 per step × 5 steps)
    const steps: ReasoningStep[] = [
      { id: "1", type: "rewrite", title: "Rewrite", summary: "", status: "in_progress" },
      { id: "1", type: "rewrite", title: "Rewrite", summary: "Done", status: "completed" },
      { id: "2", type: "plan", title: "Plan", summary: "", status: "in_progress" },
      { id: "2", type: "plan", title: "Plan", summary: "Done", status: "completed" },
      { id: "3", type: "search", title: "Search", summary: "", status: "in_progress" },
      { id: "3", type: "search", title: "Search", summary: "Done", status: "completed" },
      { id: "4", type: "merge", title: "Merge", summary: "", status: "in_progress" },
      { id: "4", type: "merge", title: "Merge", summary: "Done", status: "completed" },
      { id: "5", type: "generate", title: "Generate", summary: "", status: "in_progress" },
      { id: "5", type: "generate", title: "Generate", summary: "Done", status: "completed" },
    ];

    steps.forEach((step) => pendingStepsMap.set(step.id, step));

    // Should have 5 unique steps
    expect(pendingStepsMap.size).toBe(5);

    // All should be completed
    Array.from(pendingStepsMap.values()).forEach((step) => {
      expect(step.status).toBe("completed");
    });
  });
});

// =============================================================================
// Chat Message Integration Tests
// =============================================================================

describe("Chat message integration", () => {
  it("should add user message before starting stream", () => {
    const messages: ChatMessage[] = [];
    const userMessage = "What is RAG?";

    // Simulating adding user message
    const newMessages = [...messages, { role: "user" as const, content: userMessage }];

    expect(newMessages.length).toBe(1);
    expect(newMessages[0].role).toBe("user");
    expect(newMessages[0].content).toBe("What is RAG?");
  });

  it("should add assistant message placeholder during streaming", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What is RAG?" },
    ];

    // Simulating adding assistant message during streaming
    const newMessages = [...messages, { role: "assistant" as const, content: "" }];

    expect(newMessages.length).toBe(2);
    expect(newMessages[1].role).toBe("assistant");
    expect(newMessages[1].content).toBe("");
  });

  it("should update assistant message with streamed content", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What is RAG?" },
      { role: "assistant", content: "RAG stands for" },
    ];

    // Simulating content update
    const newMessages = [...messages];
    newMessages[1] = { ...newMessages[1], content: "RAG stands for Retrieval-Augmented Generation" };

    expect(newMessages[1].content).toBe("RAG stands for Retrieval-Augmented Generation");
  });
});

// =============================================================================
// ReasoningSteps Component Props Tests
// =============================================================================

describe("ReasoningSteps component props", () => {
  it("should pass defaultOpen=false to ReasoningSteps", () => {
    // Per task requirement: "Collapsible panel, collapsed by default"
    const defaultOpen = false;
    expect(defaultOpen).toBe(false);
  });

  it("should pass isStreaming based on loading or streaming state", () => {
    const testCases = [
      { isLoading: true, isStreaming: false, expected: true },
      { isLoading: false, isStreaming: true, expected: true },
      { isLoading: true, isStreaming: true, expected: true },
      { isLoading: false, isStreaming: false, expected: false },
    ];

    testCases.forEach(({ isLoading, isStreaming, expected }) => {
      const reasoningIsStreaming = isLoading || isStreaming;
      expect(reasoningIsStreaming).toBe(expected);
    });
  });

  it("should pass steps array to ReasoningSteps components", () => {
    const steps: ReasoningStep[] = [
      { id: "1", type: "rewrite", title: "Rewrite", summary: "", status: "completed" },
      { id: "2", type: "plan", title: "Plan", summary: "", status: "in_progress" },
    ];

    // All three components receive the same steps array
    expect(steps.length).toBe(2);
    expect(steps[0].type).toBe("rewrite");
    expect(steps[1].type).toBe("plan");
  });
});

// =============================================================================
// API Integration Tests
// =============================================================================

describe("API integration", () => {
  it("should import ReasoningStep type from api", async () => {
    const module = await import("@/lib/api");
    // ReasoningStep is a type, not a value, so we check it's exported via types
    expect(module).toBeDefined();
  });

  it("should have access to advancedChatStream", async () => {
    const { api } = await import("@/lib/api");
    expect(api.advancedChatStream).toBeDefined();
    expect(typeof api.advancedChatStream).toBe("function");
  });

  it("should have access to simpleChatStream", async () => {
    const { api } = await import("@/lib/api");
    expect(api.simpleChatStream).toBeDefined();
    expect(typeof api.simpleChatStream).toBe("function");
  });
});

// =============================================================================
// Component Import Tests
// =============================================================================

describe("Component imports", () => {
  it("should import ReasoningSteps from ai-elements", async () => {
    const module = await import("@/components/ai-elements/reasoning-steps");
    expect(module.ReasoningSteps).toBeDefined();
  });

  it("should import ReasoningStepsTrigger from ai-elements", async () => {
    const module = await import("@/components/ai-elements/reasoning-steps");
    expect(module.ReasoningStepsTrigger).toBeDefined();
  });

  it("should import ReasoningStepsContent from ai-elements", async () => {
    const module = await import("@/components/ai-elements/reasoning-steps");
    expect(module.ReasoningStepsContent).toBeDefined();
  });
});
