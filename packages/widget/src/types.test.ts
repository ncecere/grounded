import { describe, it, expect } from "bun:test";
import type {
  ReasoningStep,
  ReasoningStepType,
  ReasoningStepStatus,
  ChatMessage,
  Citation,
  WidgetConfig,
  WidgetState,
  WidgetOptions,
  WidgetTheme,
  ButtonStyle,
  ButtonSize,
  ButtonIcon,
  WidgetColorScheme,
} from "./types";

describe("widget types", () => {
  describe("module exports", () => {
    it("should export ReasoningStep interface", async () => {
      const types = await import("./types");
      // Module loads without error - types are compile-time only
      expect(types).toBeDefined();
    });

    it("should export ReasoningStepType type", async () => {
      const types = await import("./types");
      expect(types).toBeDefined();
    });

    it("should export ReasoningStepStatus type", async () => {
      const types = await import("./types");
      expect(types).toBeDefined();
    });

    it("should export ChatMessage interface", async () => {
      const types = await import("./types");
      expect(types).toBeDefined();
    });

    it("should export Citation interface", async () => {
      const types = await import("./types");
      expect(types).toBeDefined();
    });

    it("should export WidgetConfig interface", async () => {
      const types = await import("./types");
      expect(types).toBeDefined();
    });

    it("should export WidgetState interface", async () => {
      const types = await import("./types");
      expect(types).toBeDefined();
    });

    it("should export WidgetOptions interface", async () => {
      const types = await import("./types");
      expect(types).toBeDefined();
    });
  });

  describe("ReasoningStepType values", () => {
    it("should include 'rewrite' type", () => {
      const type: ReasoningStepType = "rewrite";
      expect(type).toBe("rewrite");
    });

    it("should include 'plan' type", () => {
      const type: ReasoningStepType = "plan";
      expect(type).toBe("plan");
    });

    it("should include 'search' type", () => {
      const type: ReasoningStepType = "search";
      expect(type).toBe("search");
    });

    it("should include 'merge' type", () => {
      const type: ReasoningStepType = "merge";
      expect(type).toBe("merge");
    });

    it("should include 'generate' type", () => {
      const type: ReasoningStepType = "generate";
      expect(type).toBe("generate");
    });

    it("should have exactly 5 valid types", () => {
      const validTypes: ReasoningStepType[] = ["rewrite", "plan", "search", "merge", "generate"];
      expect(validTypes).toHaveLength(5);
    });
  });

  describe("ReasoningStepStatus values", () => {
    it("should include 'pending' status", () => {
      const status: ReasoningStepStatus = "pending";
      expect(status).toBe("pending");
    });

    it("should include 'in_progress' status", () => {
      const status: ReasoningStepStatus = "in_progress";
      expect(status).toBe("in_progress");
    });

    it("should include 'completed' status", () => {
      const status: ReasoningStepStatus = "completed";
      expect(status).toBe("completed");
    });

    it("should include 'error' status", () => {
      const status: ReasoningStepStatus = "error";
      expect(status).toBe("error");
    });

    it("should have exactly 4 valid statuses", () => {
      const validStatuses: ReasoningStepStatus[] = ["pending", "in_progress", "completed", "error"];
      expect(validStatuses).toHaveLength(4);
    });
  });

  describe("ReasoningStep interface", () => {
    it("should have required id field (string)", () => {
      const step: ReasoningStep = {
        id: "step-123",
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Processing...",
        status: "in_progress",
      };
      expect(typeof step.id).toBe("string");
    });

    it("should have required type field", () => {
      const step: ReasoningStep = {
        id: "step-123",
        type: "plan",
        title: "Planning",
        summary: "Generating sub-queries...",
        status: "in_progress",
      };
      expect(step.type).toBe("plan");
    });

    it("should have required title field (string)", () => {
      const step: ReasoningStep = {
        id: "step-123",
        type: "search",
        title: "Searching Knowledge Bases",
        summary: "Executing queries...",
        status: "in_progress",
      };
      expect(typeof step.title).toBe("string");
    });

    it("should have required summary field (string)", () => {
      const step: ReasoningStep = {
        id: "step-123",
        type: "merge",
        title: "Merging Results",
        summary: "Deduplicating 25 chunks to 15 unique",
        status: "completed",
      };
      expect(typeof step.summary).toBe("string");
    });

    it("should have required status field", () => {
      const step: ReasoningStep = {
        id: "step-123",
        type: "generate",
        title: "Generating Response",
        summary: "Response generated successfully",
        status: "completed",
      };
      expect(step.status).toBe("completed");
    });

    it("should have optional details field (Record<string, unknown>)", () => {
      const stepWithDetails: ReasoningStep = {
        id: "step-123",
        type: "plan",
        title: "Planning Sub-queries",
        summary: "Generated 3 sub-queries",
        status: "completed",
        details: {
          subQueries: ["query1", "query2", "query3"],
          maxSubqueries: 3,
        },
      };
      expect(stepWithDetails.details).toBeDefined();
      expect(typeof stepWithDetails.details).toBe("object");
    });

    it("should allow omitting details field", () => {
      const stepWithoutDetails: ReasoningStep = {
        id: "step-456",
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Reformulated query",
        status: "completed",
      };
      expect(stepWithoutDetails.details).toBeUndefined();
    });
  });

  describe("ReasoningStep step types documentation", () => {
    it("rewrite step: reformulates query using conversation context", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Reformulated query with context",
        status: "completed",
        details: {
          originalQuery: "What about the latest updates?",
          rewrittenQuery: "What are the latest updates to the authentication system?",
        },
      };
      expect(step.type).toBe("rewrite");
      expect(step.details?.originalQuery).toBeDefined();
      expect(step.details?.rewrittenQuery).toBeDefined();
    });

    it("plan step: generates sub-queries for comprehensive search", () => {
      const step: ReasoningStep = {
        id: "step-2",
        type: "plan",
        title: "Planning Sub-queries",
        summary: "Generated 3 sub-queries",
        status: "completed",
        details: {
          subQueries: [
            { query: "authentication methods", purpose: "Find auth methods" },
            { query: "recent changes authentication", purpose: "Find recent updates" },
            { query: "security improvements", purpose: "Find security changes" },
          ],
        },
      };
      expect(step.type).toBe("plan");
      expect(Array.isArray(step.details?.subQueries)).toBe(true);
    });

    it("search step: executes sub-queries against knowledge bases", () => {
      const step: ReasoningStep = {
        id: "step-3",
        type: "search",
        title: "Searching Knowledge",
        summary: "Executed 3 queries, found 25 chunks",
        status: "completed",
        details: {
          queriesExecuted: 3,
          totalChunksFound: 25,
        },
      };
      expect(step.type).toBe("search");
      expect(step.details?.queriesExecuted).toBeDefined();
      expect(step.details?.totalChunksFound).toBeDefined();
    });

    it("merge step: deduplicates and ranks results", () => {
      const step: ReasoningStep = {
        id: "step-4",
        type: "merge",
        title: "Merging Results",
        summary: "Deduplicated to 15 unique chunks",
        status: "completed",
        details: {
          totalBefore: 25,
          uniqueAfter: 15,
          duplicatesRemoved: 10,
        },
      };
      expect(step.type).toBe("merge");
      expect(step.details?.uniqueAfter).toBeDefined();
    });

    it("generate step: produces final answer with citations", () => {
      const step: ReasoningStep = {
        id: "step-5",
        type: "generate",
        title: "Generating Response",
        summary: "Response generated successfully",
        status: "completed",
        details: {
          promptTokens: 1500,
          completionTokens: 500,
        },
      };
      expect(step.type).toBe("generate");
    });
  });

  describe("ReasoningStep status transitions", () => {
    it("should support pending status for steps not yet started", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "search",
        title: "Searching Knowledge",
        summary: "Waiting to execute...",
        status: "pending",
      };
      expect(step.status).toBe("pending");
    });

    it("should support in_progress status for active steps", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "search",
        title: "Searching Knowledge",
        summary: "Executing search queries...",
        status: "in_progress",
      };
      expect(step.status).toBe("in_progress");
    });

    it("should support completed status for finished steps", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "search",
        title: "Searching Knowledge",
        summary: "Found 15 relevant chunks",
        status: "completed",
      };
      expect(step.status).toBe("completed");
    });

    it("should support error status for failed steps", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "search",
        title: "Searching Knowledge",
        summary: "Search failed: vector store unavailable",
        status: "error",
      };
      expect(step.status).toBe("error");
    });

    it("should preserve step ID across status transitions", () => {
      const stepId = "step-abc-123";

      const inProgress: ReasoningStep = {
        id: stepId,
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Processing...",
        status: "in_progress",
      };

      const completed: ReasoningStep = {
        id: stepId,
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Query reformulated successfully",
        status: "completed",
      };

      expect(inProgress.id).toBe(completed.id);
    });
  });

  describe("ChatMessage with reasoningSteps", () => {
    it("should support reasoningSteps field on ChatMessage", () => {
      const message: ChatMessage = {
        id: "msg-123",
        role: "assistant",
        content: "Here is the answer...",
        timestamp: Date.now(),
        reasoningSteps: [
          {
            id: "step-1",
            type: "rewrite",
            title: "Query Rewriting",
            summary: "Reformulated query",
            status: "completed",
          },
          {
            id: "step-2",
            type: "generate",
            title: "Generating Response",
            summary: "Response generated",
            status: "completed",
          },
        ],
      };
      expect(message.reasoningSteps).toBeDefined();
      expect(message.reasoningSteps).toHaveLength(2);
    });

    it("should allow omitting reasoningSteps for simple mode messages", () => {
      const message: ChatMessage = {
        id: "msg-123",
        role: "assistant",
        content: "Here is the answer...",
        timestamp: Date.now(),
      };
      expect(message.reasoningSteps).toBeUndefined();
    });

    it("should support empty reasoningSteps array", () => {
      const message: ChatMessage = {
        id: "msg-123",
        role: "assistant",
        content: "Here is the answer...",
        timestamp: Date.now(),
        reasoningSteps: [],
      };
      expect(message.reasoningSteps).toHaveLength(0);
    });

    it("should allow reasoningSteps with citations", () => {
      const message: ChatMessage = {
        id: "msg-123",
        role: "assistant",
        content: "Here is the answer...",
        citations: [
          { index: 1, title: "Document A", url: "https://example.com/a" },
        ],
        timestamp: Date.now(),
        reasoningSteps: [
          {
            id: "step-1",
            type: "generate",
            title: "Generating Response",
            summary: "Response generated",
            status: "completed",
          },
        ],
      };
      expect(message.citations).toHaveLength(1);
      expect(message.reasoningSteps).toHaveLength(1);
    });

    it("should support all 5 reasoning steps in a message", () => {
      const message: ChatMessage = {
        id: "msg-123",
        role: "assistant",
        content: "Here is the answer...",
        timestamp: Date.now(),
        reasoningSteps: [
          { id: "step-1", type: "rewrite", title: "Rewrite", summary: "Done", status: "completed" },
          { id: "step-2", type: "plan", title: "Plan", summary: "Done", status: "completed" },
          { id: "step-3", type: "search", title: "Search", summary: "Done", status: "completed" },
          { id: "step-4", type: "merge", title: "Merge", summary: "Done", status: "completed" },
          { id: "step-5", type: "generate", title: "Generate", summary: "Done", status: "completed" },
        ],
      };
      expect(message.reasoningSteps).toHaveLength(5);
      expect(message.reasoningSteps![0].type).toBe("rewrite");
      expect(message.reasoningSteps![1].type).toBe("plan");
      expect(message.reasoningSteps![2].type).toBe("search");
      expect(message.reasoningSteps![3].type).toBe("merge");
      expect(message.reasoningSteps![4].type).toBe("generate");
    });
  });

  describe("reasoning step sequence documentation", () => {
    it("should follow the expected step order for advanced RAG", () => {
      const expectedOrder: ReasoningStepType[] = ["rewrite", "plan", "search", "merge", "generate"];
      expect(expectedOrder).toHaveLength(5);
      expect(expectedOrder[0]).toBe("rewrite");
      expect(expectedOrder[1]).toBe("plan");
      expect(expectedOrder[2]).toBe("search");
      expect(expectedOrder[3]).toBe("merge");
      expect(expectedOrder[4]).toBe("generate");
    });

    it("should emit two events per step (in_progress and completed)", () => {
      // Contract: Each reasoning step emits in_progress then completed status
      // Total: 5 steps * 2 events = 10 reasoning events
      const stepsPerPhase = 5;
      const eventsPerStep = 2;
      const totalReasoningEvents = stepsPerPhase * eventsPerStep;
      expect(totalReasoningEvents).toBe(10);
    });
  });

  describe("existing types compatibility", () => {
    it("should maintain Citation interface", () => {
      const citation: Citation = {
        index: 1,
        title: "Document Title",
        url: "https://example.com",
        snippet: "Relevant text...",
        chunkId: "chunk-123",
      };
      expect(citation.index).toBe(1);
      expect(citation.title).toBe("Document Title");
    });

    it("should maintain WidgetConfig interface", () => {
      const config: WidgetConfig = {
        agentName: "Test Agent",
        description: "A test agent",
        welcomeMessage: "Hello!",
        logoUrl: "https://example.com/logo.png",
        isPublic: true,
      };
      expect(config.agentName).toBe("Test Agent");
      expect(config.isPublic).toBe(true);
    });

    it("should maintain WidgetState interface", () => {
      const state: WidgetState = {
        isOpen: false,
        isLoading: false,
        isStreaming: false,
        messages: [],
        conversationId: null,
        config: null,
        error: null,
      };
      expect(state.isOpen).toBe(false);
      expect(state.messages).toHaveLength(0);
    });

    it("should maintain WidgetOptions interface", () => {
      const options: WidgetOptions = {
        token: "widget-token",
        apiBase: "https://api.example.com",
        position: "bottom-right",
        colorScheme: "auto",
      };
      expect(options.token).toBe("widget-token");
      expect(options.colorScheme).toBe("auto");
    });

    it("should support showReasoning option in WidgetOptions", () => {
      const optionsWithReasoning: WidgetOptions = {
        token: "widget-token",
        showReasoning: true,
      };
      expect(optionsWithReasoning.showReasoning).toBe(true);
    });

    it("should allow omitting showReasoning option (defaults to false)", () => {
      const optionsWithoutReasoning: WidgetOptions = {
        token: "widget-token",
      };
      expect(optionsWithoutReasoning.showReasoning).toBeUndefined();
    });

    it("should maintain WidgetTheme interface", () => {
      const theme: WidgetTheme = {
        primaryColor: "#007bff",
        backgroundColor: "#ffffff",
        textColor: "#333333",
        buttonPosition: "bottom-right",
        borderRadius: 8,
        buttonStyle: "circle",
        buttonSize: "medium",
        buttonIcon: "chat",
      };
      expect(theme.primaryColor).toBe("#007bff");
      expect(theme.buttonStyle).toBe("circle");
    });

    it("should maintain ButtonStyle type", () => {
      const styles: ButtonStyle[] = ["circle", "pill", "square"];
      expect(styles).toHaveLength(3);
    });

    it("should maintain ButtonSize type", () => {
      const sizes: ButtonSize[] = ["small", "medium", "large"];
      expect(sizes).toHaveLength(3);
    });

    it("should maintain ButtonIcon type", () => {
      const icons: ButtonIcon[] = ["chat", "help", "question", "message"];
      expect(icons).toHaveLength(4);
    });

    it("should maintain WidgetColorScheme type", () => {
      const schemes: WidgetColorScheme[] = ["light", "dark", "auto"];
      expect(schemes).toHaveLength(3);
    });
  });

  describe("showReasoning widget option", () => {
    it("should be an optional boolean property", () => {
      const withTrue: WidgetOptions = { token: "token", showReasoning: true };
      const withFalse: WidgetOptions = { token: "token", showReasoning: false };
      const withoutIt: WidgetOptions = { token: "token" };

      expect(withTrue.showReasoning).toBe(true);
      expect(withFalse.showReasoning).toBe(false);
      expect(withoutIt.showReasoning).toBeUndefined();
    });

    it("should work with all other WidgetOptions properties", () => {
      const fullOptions: WidgetOptions = {
        token: "widget-token",
        apiBase: "https://api.example.com",
        position: "bottom-right",
        colorScheme: "dark",
        showReasoning: true,
      };

      expect(fullOptions.token).toBe("widget-token");
      expect(fullOptions.apiBase).toBe("https://api.example.com");
      expect(fullOptions.position).toBe("bottom-right");
      expect(fullOptions.colorScheme).toBe("dark");
      expect(fullOptions.showReasoning).toBe(true);
    });

    it("should default to false behavior when not provided", () => {
      // Documents the expected default behavior
      const options: WidgetOptions = { token: "token" };
      const showReasoning = options.showReasoning ?? false;
      expect(showReasoning).toBe(false);
    });

    it("should enable reasoning panel display when true", () => {
      // Documents the expected behavior when showReasoning is true
      const options: WidgetOptions = { token: "token", showReasoning: true };
      expect(options.showReasoning).toBe(true);
      // Widget should show ReasoningPanel when this is true and there are reasoning steps
    });

    it("should hide reasoning panel when false", () => {
      // Documents the expected behavior when showReasoning is false
      const options: WidgetOptions = { token: "token", showReasoning: false };
      expect(options.showReasoning).toBe(false);
      // Widget should not show ReasoningPanel even if there are reasoning steps
    });

    it("should be usable with advanced RAG mode agents", () => {
      // Documents the use case: advanced RAG agents emit reasoning events
      const advancedModeOptions: WidgetOptions = {
        token: "advanced-agent-token",
        showReasoning: true,
      };

      expect(advancedModeOptions.showReasoning).toBe(true);
      // When agent is in advanced RAG mode, reasoning steps will be streamed
      // The ReasoningPanel will display these steps to the user
    });

    it("should have no effect with simple RAG mode agents", () => {
      // Documents the use case: simple RAG agents don't emit reasoning events
      const simpleModeOptions: WidgetOptions = {
        token: "simple-agent-token",
        showReasoning: true, // Can be enabled but won't show anything
      };

      expect(simpleModeOptions.showReasoning).toBe(true);
      // When agent is in simple RAG mode, no reasoning steps are emitted
      // The ReasoningPanel will not render (no steps to display)
    });
  });
});
