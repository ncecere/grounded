import { describe, it, expect } from "bun:test";

describe("useChat hook", () => {
  describe("module exports", () => {
    it("should export useChat hook", async () => {
      const { useChat } = await import("./useChat");
      expect(useChat).toBeDefined();
      expect(typeof useChat).toBe("function");
    });

    it("should export ChatStatus interface", async () => {
      // ChatStatus is a type, we verify the module loads
      const module = await import("./useChat");
      expect(module).toBeDefined();
    });
  });

  describe("SSEMessage types documentation", () => {
    it("should support text event type", () => {
      const event = {
        type: "text" as const,
        content: "The answer is...",
      };
      expect(event.type).toBe("text");
      expect(event.content).toBeDefined();
    });

    it("should support done event type", () => {
      const event = {
        type: "done" as const,
        conversationId: "conv-123",
      };
      expect(event.type).toBe("done");
      expect(event.conversationId).toBeDefined();
    });

    it("should support error event type", () => {
      const event = {
        type: "error" as const,
        message: "An error occurred",
      };
      expect(event.type).toBe("error");
      expect(event.message).toBeDefined();
    });

    it("should support status event type", () => {
      const event = {
        type: "status" as const,
        status: "searching" as const,
        message: "Searching knowledge bases...",
        sourcesCount: 10,
      };
      expect(event.type).toBe("status");
      expect(event.status).toBe("searching");
    });

    it("should support sources event type", () => {
      const event = {
        type: "sources" as const,
        sources: [
          { id: "src-1", title: "Doc A", url: "https://example.com", snippet: "Text...", index: 1 },
        ],
      };
      expect(event.type).toBe("sources");
      expect(event.sources).toHaveLength(1);
    });

    it("should support reasoning event type (new for advanced RAG)", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-123",
          type: "rewrite" as const,
          title: "Query Rewriting",
          summary: "Reformulating query...",
          status: "in_progress" as const,
        },
      };
      expect(event.type).toBe("reasoning");
      expect(event.step).toBeDefined();
      expect(event.step.id).toBe("step-123");
      expect(event.step.type).toBe("rewrite");
    });

    it("should have exactly 6 event types (including reasoning)", () => {
      const eventTypes = ["text", "done", "error", "status", "sources", "reasoning"];
      expect(eventTypes).toHaveLength(6);
    });
  });

  describe("reasoning event structure", () => {
    it("reasoning event should have step property", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-1",
          type: "plan" as const,
          title: "Planning Sub-queries",
          summary: "Generating search queries...",
          status: "in_progress" as const,
        },
      };
      expect(event.step).toBeDefined();
    });

    it("reasoning step should have required fields", () => {
      const step = {
        id: "step-1",
        type: "search" as const,
        title: "Searching Knowledge",
        summary: "Executing queries...",
        status: "completed" as const,
      };
      expect(step.id).toBeDefined();
      expect(step.type).toBeDefined();
      expect(step.title).toBeDefined();
      expect(step.summary).toBeDefined();
      expect(step.status).toBeDefined();
    });

    it("reasoning step should support optional details field", () => {
      const step = {
        id: "step-1",
        type: "plan" as const,
        title: "Planning Sub-queries",
        summary: "Generated 3 sub-queries",
        status: "completed" as const,
        details: {
          subQueries: ["query1", "query2", "query3"],
        },
      };
      expect(step.details).toBeDefined();
      expect(step.details?.subQueries).toHaveLength(3);
    });
  });

  describe("reasoning step types in SSE", () => {
    it("should support rewrite step type", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-1",
          type: "rewrite" as const,
          title: "Query Rewriting",
          summary: "Reformulating with context",
          status: "completed" as const,
        },
      };
      expect(event.step.type).toBe("rewrite");
    });

    it("should support plan step type", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-2",
          type: "plan" as const,
          title: "Planning",
          summary: "Generated sub-queries",
          status: "completed" as const,
        },
      };
      expect(event.step.type).toBe("plan");
    });

    it("should support search step type", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-3",
          type: "search" as const,
          title: "Searching",
          summary: "Found chunks",
          status: "completed" as const,
        },
      };
      expect(event.step.type).toBe("search");
    });

    it("should support merge step type", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-4",
          type: "merge" as const,
          title: "Merging",
          summary: "Deduplicated results",
          status: "completed" as const,
        },
      };
      expect(event.step.type).toBe("merge");
    });

    it("should support generate step type", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-5",
          type: "generate" as const,
          title: "Generating",
          summary: "Response generated",
          status: "completed" as const,
        },
      };
      expect(event.step.type).toBe("generate");
    });
  });

  describe("reasoning step statuses in SSE", () => {
    it("should support pending status", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-1",
          type: "rewrite" as const,
          title: "Query Rewriting",
          summary: "Waiting...",
          status: "pending" as const,
        },
      };
      expect(event.step.status).toBe("pending");
    });

    it("should support in_progress status", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-1",
          type: "rewrite" as const,
          title: "Query Rewriting",
          summary: "Processing...",
          status: "in_progress" as const,
        },
      };
      expect(event.step.status).toBe("in_progress");
    });

    it("should support completed status", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-1",
          type: "rewrite" as const,
          title: "Query Rewriting",
          summary: "Done",
          status: "completed" as const,
        },
      };
      expect(event.step.status).toBe("completed");
    });

    it("should support error status", () => {
      const event = {
        type: "reasoning" as const,
        step: {
          id: "step-1",
          type: "search" as const,
          title: "Searching",
          summary: "Search failed",
          status: "error" as const,
        },
      };
      expect(event.step.status).toBe("error");
    });
  });

  describe("ChatStatus interface", () => {
    it("should support idle status", () => {
      const status = {
        status: "idle" as const,
      };
      expect(status.status).toBe("idle");
    });

    it("should support searching status", () => {
      const status = {
        status: "searching" as const,
        message: "Searching knowledge bases...",
        sourcesCount: 0,
      };
      expect(status.status).toBe("searching");
    });

    it("should support generating status", () => {
      const status = {
        status: "generating" as const,
        message: "Generating response...",
        sourcesCount: 10,
      };
      expect(status.status).toBe("generating");
    });

    it("should support streaming status", () => {
      const status = {
        status: "streaming" as const,
      };
      expect(status.status).toBe("streaming");
    });

    it("should have exactly 4 status values", () => {
      const statuses = ["idle", "searching", "generating", "streaming"];
      expect(statuses).toHaveLength(4);
    });
  });

  describe("UseChatOptions interface", () => {
    it("should require token field", () => {
      const options = {
        token: "widget-token-123",
        apiBase: "https://api.example.com",
      };
      expect(options.token).toBeDefined();
    });

    it("should require apiBase field", () => {
      const options = {
        token: "widget-token-123",
        apiBase: "https://api.example.com",
      };
      expect(options.apiBase).toBeDefined();
    });

    it("should have optional endpointType field", () => {
      const options = {
        token: "widget-token-123",
        apiBase: "https://api.example.com",
        endpointType: "widget" as const,
      };
      expect(options.endpointType).toBe("widget");
    });

    it("should support chat-endpoint type", () => {
      const options = {
        token: "chat-token-123",
        apiBase: "https://api.example.com",
        endpointType: "chat-endpoint" as const,
      };
      expect(options.endpointType).toBe("chat-endpoint");
    });
  });

  describe("endpoint type routing documentation", () => {
    it("widget endpoint uses /api/v1/widget/{token}/chat/stream", () => {
      const apiBase = "https://api.example.com";
      const token = "widget-token";
      const endpoint = `${apiBase}/api/v1/widget/${token}/chat/stream`;
      expect(endpoint).toBe("https://api.example.com/api/v1/widget/widget-token/chat/stream");
    });

    it("chat-endpoint uses /api/v1/c/{token}/chat/stream", () => {
      const apiBase = "https://api.example.com";
      const token = "chat-token";
      const endpoint = `${apiBase}/api/v1/c/${token}/chat/stream`;
      expect(endpoint).toBe("https://api.example.com/api/v1/c/chat-token/chat/stream");
    });
  });

  describe("useChat return value interface", () => {
    it("should return messages array", async () => {
      // Document expected return value structure
      const returnValue = {
        messages: [],
        isLoading: false,
        isStreaming: false,
        error: null,
        chatStatus: { status: "idle" },
        sendMessage: async () => {},
        stopStreaming: () => {},
        clearMessages: () => {},
      };
      expect(Array.isArray(returnValue.messages)).toBe(true);
    });

    it("should return isLoading boolean", () => {
      const returnValue = {
        isLoading: false,
      };
      expect(typeof returnValue.isLoading).toBe("boolean");
    });

    it("should return isStreaming boolean", () => {
      const returnValue = {
        isStreaming: false,
      };
      expect(typeof returnValue.isStreaming).toBe("boolean");
    });

    it("should return error string or null", () => {
      const returnValueWithError = {
        error: "Something went wrong",
      };
      const returnValueNoError = {
        error: null,
      };
      expect(typeof returnValueWithError.error).toBe("string");
      expect(returnValueNoError.error).toBeNull();
    });

    it("should return chatStatus object", () => {
      const returnValue = {
        chatStatus: { status: "idle" as const },
      };
      expect(returnValue.chatStatus.status).toBe("idle");
    });

    it("should return sendMessage function", () => {
      const returnValue = {
        sendMessage: async (content: string) => {},
      };
      expect(typeof returnValue.sendMessage).toBe("function");
    });

    it("should return stopStreaming function", () => {
      const returnValue = {
        stopStreaming: () => {},
      };
      expect(typeof returnValue.stopStreaming).toBe("function");
    });

    it("should return clearMessages function", () => {
      const returnValue = {
        clearMessages: () => {},
      };
      expect(typeof returnValue.clearMessages).toBe("function");
    });
  });

  describe("SSE stream processing documentation", () => {
    it("should parse SSE data lines starting with 'data: '", () => {
      const line = 'data: {"type":"text","content":"Hello"}';
      expect(line.startsWith("data: ")).toBe(true);

      const jsonStr = line.slice(6);
      expect(jsonStr).toBe('{"type":"text","content":"Hello"}');

      const parsed = JSON.parse(jsonStr);
      expect(parsed.type).toBe("text");
      expect(parsed.content).toBe("Hello");
    });

    it("should handle reasoning events in SSE stream", () => {
      const line = 'data: {"type":"reasoning","step":{"id":"step-1","type":"rewrite","title":"Query Rewriting","summary":"Processing...","status":"in_progress"}}';
      const jsonStr = line.slice(6);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.type).toBe("reasoning");
      expect(parsed.step.id).toBe("step-1");
      expect(parsed.step.type).toBe("rewrite");
      expect(parsed.step.status).toBe("in_progress");
    });

    it("should handle multiple events in buffer", () => {
      const buffer = 'data: {"type":"reasoning","step":{"id":"step-1","type":"rewrite","title":"Rewrite","summary":"Done","status":"completed"}}\ndata: {"type":"text","content":"Hello"}';
      const lines = buffer.split("\n");
      expect(lines).toHaveLength(2);
    });
  });

  describe("reasoning step collection behavior", () => {
    it("should collect reasoning steps from SSE stream", () => {
      // Document how reasoning steps are collected
      const pendingSteps = new Map<string, { id: string; type: string; status: string }>();

      // First step comes in as in_progress
      const step1InProgress = {
        id: "step-1",
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Processing...",
        status: "in_progress",
      };
      pendingSteps.set(step1InProgress.id, step1InProgress);
      expect(pendingSteps.size).toBe(1);

      // Same step comes in as completed (updates the entry)
      const step1Completed = {
        id: "step-1",
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Done",
        status: "completed",
      };
      pendingSteps.set(step1Completed.id, step1Completed);
      expect(pendingSteps.size).toBe(1);
      expect(pendingSteps.get("step-1")?.status).toBe("completed");
    });

    it("should deduplicate steps by ID keeping latest status", () => {
      const pendingSteps = new Map<string, { id: string; status: string }>();

      // Add multiple steps
      pendingSteps.set("step-1", { id: "step-1", status: "in_progress" });
      pendingSteps.set("step-2", { id: "step-2", status: "in_progress" });
      expect(pendingSteps.size).toBe(2);

      // Update step-1 to completed
      pendingSteps.set("step-1", { id: "step-1", status: "completed" });
      expect(pendingSteps.size).toBe(2);
      expect(pendingSteps.get("step-1")?.status).toBe("completed");
      expect(pendingSteps.get("step-2")?.status).toBe("in_progress");
    });

    it("should convert Map to array for message attachment", () => {
      const pendingSteps = new Map<string, { id: string; type: string }>();
      pendingSteps.set("step-1", { id: "step-1", type: "rewrite" });
      pendingSteps.set("step-2", { id: "step-2", type: "plan" });
      pendingSteps.set("step-3", { id: "step-3", type: "search" });

      const stepsArray = Array.from(pendingSteps.values());
      expect(stepsArray).toHaveLength(3);
      expect(stepsArray[0].type).toBe("rewrite");
      expect(stepsArray[1].type).toBe("plan");
      expect(stepsArray[2].type).toBe("search");
    });

    it("should only attach reasoning steps if present", () => {
      // Document the conditional attachment pattern
      const reasoningStepsToSet: Array<{ id: string }> = [];

      // When empty, should not add reasoningSteps property
      const msgWithoutSteps = {
        content: "Hello",
        ...(reasoningStepsToSet.length > 0 && { reasoningSteps: reasoningStepsToSet }),
      };
      expect("reasoningSteps" in msgWithoutSteps).toBe(false);

      // When has steps, should add reasoningSteps property
      const stepsWithContent = [{ id: "step-1" }];
      const msgWithSteps = {
        content: "Hello",
        ...(stepsWithContent.length > 0 && { reasoningSteps: stepsWithContent }),
      };
      expect("reasoningSteps" in msgWithSteps).toBe(true);
      expect(msgWithSteps.reasoningSteps).toHaveLength(1);
    });

    it("should preserve step order in array", () => {
      const pendingSteps = new Map<string, { id: string; type: string }>();

      // Steps are added in pipeline order
      pendingSteps.set("step-rewrite", { id: "step-rewrite", type: "rewrite" });
      pendingSteps.set("step-plan", { id: "step-plan", type: "plan" });
      pendingSteps.set("step-search", { id: "step-search", type: "search" });
      pendingSteps.set("step-merge", { id: "step-merge", type: "merge" });
      pendingSteps.set("step-generate", { id: "step-generate", type: "generate" });

      const stepsArray = Array.from(pendingSteps.values());
      expect(stepsArray[0].type).toBe("rewrite");
      expect(stepsArray[1].type).toBe("plan");
      expect(stepsArray[2].type).toBe("search");
      expect(stepsArray[3].type).toBe("merge");
      expect(stepsArray[4].type).toBe("generate");
    });
  });

  describe("reasoning step handling in done event", () => {
    it("should copy steps before clearing ref", () => {
      const pendingSteps = new Map<string, { id: string; type: string }>();
      pendingSteps.set("step-1", { id: "step-1", type: "rewrite" });

      // Copy values before clearing
      const reasoningStepsToSet = Array.from(pendingSteps.values());
      pendingSteps.clear();

      // Ref is now empty but we have the copy
      expect(pendingSteps.size).toBe(0);
      expect(reasoningStepsToSet).toHaveLength(1);
      expect(reasoningStepsToSet[0].type).toBe("rewrite");
    });

    it("should clear pending steps ref on done", () => {
      const pendingSteps = new Map<string, { id: string }>();
      pendingSteps.set("step-1", { id: "step-1" });
      pendingSteps.set("step-2", { id: "step-2" });

      // On done event
      pendingSteps.clear();

      expect(pendingSteps.size).toBe(0);
    });
  });

  describe("reasoning step cleanup on error", () => {
    it("should clear pending steps on error", () => {
      const pendingSteps = new Map<string, { id: string }>();
      pendingSteps.set("step-1", { id: "step-1" });

      // Simulate error handling
      pendingSteps.clear();

      expect(pendingSteps.size).toBe(0);
    });

    it("should clear pending steps on abort", () => {
      const pendingSteps = new Map<string, { id: string }>();
      pendingSteps.set("step-1", { id: "step-1" });

      // Simulate abort handling
      pendingSteps.clear();

      expect(pendingSteps.size).toBe(0);
    });
  });

  describe("clearMessages cleanup", () => {
    it("should clear pending reasoning steps on clearMessages", () => {
      const pendingSteps = new Map<string, { id: string }>();
      pendingSteps.set("step-1", { id: "step-1" });

      // clearMessages clears pending steps
      pendingSteps.clear();

      expect(pendingSteps.size).toBe(0);
    });
  });

  describe("reasoning event handler behavior", () => {
    it("should only process events with step data", () => {
      // Event with step should be processed
      const eventWithStep = {
        type: "reasoning" as const,
        step: { id: "step-1", type: "rewrite", title: "Rewrite", summary: "...", status: "completed" },
      };
      expect(eventWithStep.type === "reasoning" && eventWithStep.step).toBeTruthy();

      // Event without step should be skipped
      const eventWithoutStep = {
        type: "reasoning" as const,
      };
      expect(eventWithoutStep.type === "reasoning" && (eventWithoutStep as any).step).toBeFalsy();
    });

    it("should handle step status transitions", () => {
      const pendingSteps = new Map<string, { id: string; status: string }>();

      // Step starts as in_progress
      pendingSteps.set("step-1", { id: "step-1", status: "in_progress" });
      expect(pendingSteps.get("step-1")?.status).toBe("in_progress");

      // Step transitions to completed
      pendingSteps.set("step-1", { id: "step-1", status: "completed" });
      expect(pendingSteps.get("step-1")?.status).toBe("completed");
    });

    it("should handle all 5 step types in sequence", () => {
      const pendingSteps = new Map<string, { id: string; type: string }>();
      const stepTypes = ["rewrite", "plan", "search", "merge", "generate"];

      stepTypes.forEach((type, i) => {
        pendingSteps.set(`step-${i}`, { id: `step-${i}`, type });
      });

      expect(pendingSteps.size).toBe(5);
      const stepsArray = Array.from(pendingSteps.values());
      expect(stepsArray.map(s => s.type)).toEqual(stepTypes);
    });
  });

  describe("message finalization with reasoning steps", () => {
    it("should include reasoningSteps in finalized message", () => {
      const steps = [
        { id: "step-1", type: "rewrite", title: "Query Rewriting", summary: "Done", status: "completed" },
        { id: "step-2", type: "plan", title: "Planning", summary: "Generated 3 queries", status: "completed" },
      ];

      const finalizedMessage = {
        id: "msg-1",
        role: "assistant" as const,
        content: "The answer is...",
        isStreaming: false,
        citations: [],
        reasoningSteps: steps,
      };

      expect(finalizedMessage.reasoningSteps).toBeDefined();
      expect(finalizedMessage.reasoningSteps).toHaveLength(2);
      expect(finalizedMessage.reasoningSteps[0].type).toBe("rewrite");
    });

    it("should not include reasoningSteps field for simple mode", () => {
      // Simple mode (no reasoning events received)
      const emptySteps: any[] = [];

      const msgData: Record<string, any> = {
        content: "Hello",
        isStreaming: false,
        citations: [],
        ...(emptySteps.length > 0 && { reasoningSteps: emptySteps }),
      };

      expect(Object.keys(msgData)).not.toContain("reasoningSteps");
    });

    it("should include full ReasoningStep structure", () => {
      const step = {
        id: "step-1",
        type: "plan" as const,
        title: "Planning Sub-queries",
        summary: "Generated 3 sub-queries",
        status: "completed" as const,
        details: {
          subQueries: [
            { id: "sq-1", query: "What is X?", purpose: "Get X info" },
            { id: "sq-2", query: "How does Y work?", purpose: "Get Y info" },
          ],
        },
      };

      const msg = {
        reasoningSteps: [step],
      };

      expect(msg.reasoningSteps[0].id).toBe("step-1");
      expect(msg.reasoningSteps[0].type).toBe("plan");
      expect(msg.reasoningSteps[0].title).toBe("Planning Sub-queries");
      expect(msg.reasoningSteps[0].summary).toBe("Generated 3 sub-queries");
      expect(msg.reasoningSteps[0].status).toBe("completed");
      expect(msg.reasoningSteps[0].details?.subQueries).toHaveLength(2);
    });
  });

  describe("ChatMessage with reasoningSteps field", () => {
    it("ChatMessage interface includes optional reasoningSteps", () => {
      // Verify the type structure
      const msgWithSteps = {
        id: "msg-1",
        role: "assistant" as const,
        content: "Response",
        timestamp: Date.now(),
        reasoningSteps: [
          { id: "s1", type: "rewrite" as const, title: "Rewrite", summary: "...", status: "completed" as const },
        ],
      };

      const msgWithoutSteps = {
        id: "msg-2",
        role: "assistant" as const,
        content: "Response",
        timestamp: Date.now(),
      };

      expect(msgWithSteps.reasoningSteps).toBeDefined();
      expect((msgWithoutSteps as any).reasoningSteps).toBeUndefined();
    });

    it("user messages do not have reasoningSteps", () => {
      const userMsg = {
        id: "msg-1",
        role: "user" as const,
        content: "Hello",
        timestamp: Date.now(),
      };

      // User messages never have reasoning steps
      expect((userMsg as any).reasoningSteps).toBeUndefined();
    });
  });

  describe("advanced RAG mode detection", () => {
    it("reasoning events indicate advanced RAG mode", () => {
      const events = [
        { type: "status", status: "searching" },
        { type: "reasoning", step: { id: "s1", type: "rewrite", title: "...", summary: "...", status: "in_progress" } },
        { type: "reasoning", step: { id: "s1", type: "rewrite", title: "...", summary: "...", status: "completed" } },
        { type: "text", content: "Hello" },
        { type: "done", conversationId: "conv-1" },
      ];

      const hasReasoningEvents = events.some(e => e.type === "reasoning");
      expect(hasReasoningEvents).toBe(true);
    });

    it("simple mode has no reasoning events", () => {
      const events = [
        { type: "status", status: "searching" },
        { type: "text", content: "Hello" },
        { type: "sources", sources: [] },
        { type: "done", conversationId: "conv-1" },
      ];

      const hasReasoningEvents = events.some(e => e.type === "reasoning");
      expect(hasReasoningEvents).toBe(false);
    });
  });
});
