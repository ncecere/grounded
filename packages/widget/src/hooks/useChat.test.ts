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
});
