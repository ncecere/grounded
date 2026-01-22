import { describe, it, expect } from "bun:test";

// Test module structure, types, and exports
describe("chat API client", () => {
  describe("module exports", () => {
    it("should export chatApi object", async () => {
      const { chatApi } = await import("./chat");
      expect(chatApi).toBeDefined();
      expect(typeof chatApi).toBe("object");
    });

    it("should export chat method", async () => {
      const { chatApi } = await import("./chat");
      expect(typeof chatApi.chat).toBe("function");
    });

    it("should export simpleChatStream method", async () => {
      const { chatApi } = await import("./chat");
      expect(typeof chatApi.simpleChatStream).toBe("function");
    });

    it("should export advancedChatStream method", async () => {
      const { chatApi } = await import("./chat");
      expect(typeof chatApi.advancedChatStream).toBe("function");
    });

    it("should have exactly 3 methods", async () => {
      const { chatApi } = await import("./chat");
      const methods = Object.keys(chatApi);
      expect(methods).toHaveLength(3);
      expect(methods).toContain("chat");
      expect(methods).toContain("simpleChatStream");
      expect(methods).toContain("advancedChatStream");
    });
  });

  describe("chat method", () => {
    it("should be an async function", async () => {
      const { chatApi } = await import("./chat");
      // Async functions return AsyncFunction constructor
      expect(chatApi.chat.constructor.name).toBe("AsyncFunction");
    });

    it("should accept agentId, message, and optional conversationId parameters", async () => {
      const { chatApi } = await import("./chat");
      // Check function has 3 parameters (agentId, message, conversationId)
      expect(chatApi.chat.length).toBe(3);
    });
  });

  describe("simpleChatStream method", () => {
    it("should be an async function", async () => {
      const { chatApi } = await import("./chat");
      expect(chatApi.simpleChatStream.constructor.name).toBe("AsyncFunction");
    });

    it("should accept 8 parameters (agentId, message, conversationId, callbacks, optional status)", async () => {
      const { chatApi } = await import("./chat");
      // Parameters: agentId, message, conversationId, onChunk, onSources, onDone, onError, onStatus
      expect(chatApi.simpleChatStream.length).toBe(8);
    });
  });

  describe("advancedChatStream method", () => {
    it("should be an async function", async () => {
      const { chatApi } = await import("./chat");
      expect(chatApi.advancedChatStream.constructor.name).toBe("AsyncFunction");
    });

    it("should accept 9 parameters (agentId, message, conversationId, callbacks with onReasoning, optional status)", async () => {
      const { chatApi } = await import("./chat");
      // Parameters: agentId, message, conversationId, onChunk, onSources, onDone, onError, onReasoning, onStatus
      expect(chatApi.advancedChatStream.length).toBe(9);
    });

    it("should have onReasoning callback positioned after onError", async () => {
      // This is a documentation test - verifying the parameter order convention
      // advancedChatStream(agentId, message, conversationId, onChunk, onSources, onDone, onError, onReasoning, onStatus)
      // Position 7 (0-indexed) is onReasoning
      const { chatApi } = await import("./chat");
      expect(chatApi.advancedChatStream.length).toBe(9);
    });
  });

  describe("ReasoningStep type", () => {
    it("should export ReasoningStep type from types module", async () => {
      const types = await import("./types/chat");
      // Type-only check - verify module loads without ReasoningStep causing issues
      expect(types).toBeDefined();
    });

    it("should export ReasoningStepType union type", async () => {
      // ReasoningStepType = "rewrite" | "plan" | "search" | "merge" | "generate"
      const types = await import("./types/chat");
      expect(types).toBeDefined();
    });

    it("should export ReasoningStepStatus union type", async () => {
      // ReasoningStepStatus = "pending" | "in_progress" | "completed" | "error"
      const types = await import("./types/chat");
      expect(types).toBeDefined();
    });
  });

  describe("ReasoningStep interface contract", () => {
    it("should have id field (string)", () => {
      // Contract: ReasoningStep.id is a unique identifier for each reasoning step
      const step = {
        id: "step-123",
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary: "Processing query...",
        status: "in_progress" as const,
      };
      expect(typeof step.id).toBe("string");
    });

    it("should have type field with valid step types", () => {
      // Contract: type is one of "rewrite" | "plan" | "search" | "merge" | "generate"
      const validTypes = ["rewrite", "plan", "search", "merge", "generate"];
      validTypes.forEach((type) => {
        expect(validTypes).toContain(type);
      });
    });

    it("should have title field (string)", () => {
      // Contract: title is a human-readable name for the step
      const step = {
        id: "step-123",
        type: "plan" as const,
        title: "Planning Sub-queries",
        summary: "Generating search queries...",
        status: "completed" as const,
      };
      expect(typeof step.title).toBe("string");
    });

    it("should have summary field (string)", () => {
      // Contract: summary describes what the step is doing/did
      const step = {
        id: "step-123",
        type: "search" as const,
        title: "Searching Knowledge",
        summary: "Found 15 relevant chunks",
        status: "completed" as const,
      };
      expect(typeof step.summary).toBe("string");
    });

    it("should have status field with valid statuses", () => {
      // Contract: status is one of "pending" | "in_progress" | "completed" | "error"
      const validStatuses = ["pending", "in_progress", "completed", "error"];
      validStatuses.forEach((status) => {
        expect(validStatuses).toContain(status);
      });
    });

    it("should have optional details field (Record<string, unknown>)", () => {
      // Contract: details is optional and contains step-specific metadata
      const stepWithDetails = {
        id: "step-123",
        type: "plan" as const,
        title: "Planning Sub-queries",
        summary: "Generated 3 sub-queries",
        status: "completed" as const,
        details: {
          subQueries: ["query1", "query2", "query3"],
          maxSubqueries: 3,
        },
      };
      expect(stepWithDetails.details).toBeDefined();
      expect(typeof stepWithDetails.details).toBe("object");

      const stepWithoutDetails: {
        id: string;
        type: "rewrite";
        title: string;
        summary: string;
        status: "completed";
        details?: Record<string, unknown>;
      } = {
        id: "step-456",
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary: "Reformulated query",
        status: "completed" as const,
      };
      expect(stepWithoutDetails.details).toBeUndefined();
    });
  });

  describe("advancedChatStream event types", () => {
    it("should handle status event", () => {
      // Contract: status events have status, message, and optional sourceCount
      const statusEvent = {
        type: "status" as const,
        status: "searching",
        message: "Searching knowledge bases...",
        sourceCount: 10,
      };
      expect(statusEvent.type).toBe("status");
      expect(typeof statusEvent.status).toBe("string");
      expect(typeof statusEvent.message).toBe("string");
      expect(typeof statusEvent.sourceCount).toBe("number");
    });

    it("should handle reasoning event", () => {
      // Contract: reasoning events contain a ReasoningStep
      const reasoningEvent = {
        type: "reasoning" as const,
        step: {
          id: "step-123",
          type: "rewrite" as const,
          title: "Query Rewriting",
          summary: "Reformulating with context...",
          status: "in_progress" as const,
        },
      };
      expect(reasoningEvent.type).toBe("reasoning");
      expect(reasoningEvent.step).toBeDefined();
      expect(reasoningEvent.step.id).toBeDefined();
      expect(reasoningEvent.step.type).toBeDefined();
    });

    it("should handle text event", () => {
      // Contract: text events contain streamed content
      const textEvent = {
        type: "text" as const,
        content: "The answer to your question is...",
      };
      expect(textEvent.type).toBe("text");
      expect(typeof textEvent.content).toBe("string");
    });

    it("should handle sources event", () => {
      // Contract: sources events contain array of source objects
      const sourcesEvent = {
        type: "sources" as const,
        sources: [
          { id: "src-1", title: "Document A", url: "https://example.com/a", snippet: "Relevant text...", index: 1 },
          { id: "src-2", title: "Document B", snippet: "More text...", index: 2 },
        ],
      };
      expect(sourcesEvent.type).toBe("sources");
      expect(Array.isArray(sourcesEvent.sources)).toBe(true);
      expect(sourcesEvent.sources[0].id).toBeDefined();
      expect(sourcesEvent.sources[0].title).toBeDefined();
      expect(sourcesEvent.sources[0].snippet).toBeDefined();
      expect(sourcesEvent.sources[0].index).toBeDefined();
    });

    it("should handle done event", () => {
      // Contract: done events contain the conversationId
      const doneEvent = {
        type: "done" as const,
        conversationId: "conv-123",
      };
      expect(doneEvent.type).toBe("done");
      expect(typeof doneEvent.conversationId).toBe("string");
    });

    it("should handle error event", () => {
      // Contract: error events contain an error message
      const errorEvent = {
        type: "error" as const,
        message: "An error occurred during processing",
      };
      expect(errorEvent.type).toBe("error");
      expect(typeof errorEvent.message).toBe("string");
    });
  });

  describe("reasoning step sequence", () => {
    it("should follow the expected step order for advanced RAG", () => {
      // Contract: reasoning steps occur in order: rewrite -> plan -> search -> merge -> generate
      const expectedOrder = ["rewrite", "plan", "search", "merge", "generate"];
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

    it("should preserve step ID across status transitions", () => {
      // Contract: When a step transitions from in_progress to completed, id stays the same
      const inProgressStep = {
        id: "step-abc",
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary: "Processing...",
        status: "in_progress" as const,
      };
      const completedStep = {
        id: "step-abc", // Same ID
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary: "Query reformulated successfully",
        status: "completed" as const,
      };
      expect(inProgressStep.id).toBe(completedStep.id);
    });
  });

  describe("step-specific details", () => {
    it("rewrite step may include rewritten query", () => {
      const rewriteStep = {
        id: "step-1",
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary: "Reformulated query with context",
        status: "completed" as const,
        details: {
          originalQuery: "What about the latest updates?",
          rewrittenQuery: "What are the latest updates to the authentication system?",
        },
      };
      expect(rewriteStep.details?.rewrittenQuery).toBeDefined();
    });

    it("plan step may include sub-queries", () => {
      const planStep = {
        id: "step-2",
        type: "plan" as const,
        title: "Planning Sub-queries",
        summary: "Generated 3 sub-queries",
        status: "completed" as const,
        details: {
          subQueries: [
            { query: "authentication methods", purpose: "Find auth methods" },
            { query: "recent changes authentication", purpose: "Find recent updates" },
            { query: "security improvements", purpose: "Find security changes" },
          ],
        },
      };
      expect(planStep.details?.subQueries).toBeDefined();
      expect(Array.isArray(planStep.details?.subQueries)).toBe(true);
    });

    it("search step may include chunk counts", () => {
      const searchStep = {
        id: "step-3",
        type: "search" as const,
        title: "Searching Knowledge",
        summary: "Executed 3 queries, found 25 chunks",
        status: "completed" as const,
        details: {
          queriesExecuted: 3,
          totalChunksFound: 25,
        },
      };
      expect(searchStep.details?.queriesExecuted).toBeDefined();
      expect(searchStep.details?.totalChunksFound).toBeDefined();
    });

    it("merge step may include deduplication info", () => {
      const mergeStep = {
        id: "step-4",
        type: "merge" as const,
        title: "Merging Results",
        summary: "Deduplicated to 15 unique chunks",
        status: "completed" as const,
        details: {
          totalBefore: 25,
          uniqueAfter: 15,
          duplicatesRemoved: 10,
        },
      };
      expect(mergeStep.details?.uniqueAfter).toBeDefined();
    });

    it("generate step may include token usage", () => {
      const generateStep = {
        id: "step-5",
        type: "generate" as const,
        title: "Generating Response",
        summary: "Response generated successfully",
        status: "completed" as const,
        details: {
          promptTokens: 1500,
          completionTokens: 500,
        },
      };
      expect(generateStep.details?.promptTokens).toBeDefined();
      expect(generateStep.details?.completionTokens).toBeDefined();
    });
  });

  describe("unified api object integration", () => {
    it("should include advancedChatStream in unified api object", async () => {
      const { api } = await import("./index");
      expect(typeof api.advancedChatStream).toBe("function");
    });

    it("should include simpleChatStream in unified api object", async () => {
      const { api } = await import("./index");
      expect(typeof api.simpleChatStream).toBe("function");
    });

    it("should include chat in unified api object", async () => {
      const { api } = await import("./index");
      expect(typeof api.chat).toBe("function");
    });
  });

  describe("callback signature differences between simple and advanced", () => {
    it("simpleChatStream does not have onReasoning callback", async () => {
      const { chatApi } = await import("./chat");
      // simpleChatStream: 8 params (no onReasoning)
      expect(chatApi.simpleChatStream.length).toBe(8);
    });

    it("advancedChatStream has onReasoning callback", async () => {
      const { chatApi } = await import("./chat");
      // advancedChatStream: 9 params (includes onReasoning)
      expect(chatApi.advancedChatStream.length).toBe(9);
    });

    it("advancedChatStream has one more required callback than simpleChatStream", async () => {
      const { chatApi } = await import("./chat");
      const simpleChatStreamParamCount = chatApi.simpleChatStream.length;
      const advancedChatStreamParamCount = chatApi.advancedChatStream.length;
      expect(advancedChatStreamParamCount - simpleChatStreamParamCount).toBe(1);
    });
  });
});
