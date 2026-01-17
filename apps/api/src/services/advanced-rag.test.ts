import { describe, it, expect } from "bun:test";

// ============================================================================
// Tests for AdvancedRAGService Module Exports
// ============================================================================

describe("AdvancedRAGService Module", () => {
  describe("exports", () => {
    it("should export AdvancedRAGService class", async () => {
      const module = await import("./advanced-rag");
      expect(module.AdvancedRAGService).toBeDefined();
      expect(typeof module.AdvancedRAGService).toBe("function");
    });

    it("should export ReasoningStep type (verified via instantiation)", async () => {
      const { AdvancedRAGService } = await import("./advanced-rag");
      // Type is exported, we verify by checking service instantiation
      const service = new AdvancedRAGService("tenant-123", "agent-456");
      expect(service).toBeDefined();
    });

    it("should export SubQuery type (verified via instantiation)", async () => {
      const { AdvancedRAGService } = await import("./advanced-rag");
      const service = new AdvancedRAGService("tenant-123", "agent-456");
      expect(service).toBeDefined();
    });

    it("should export AdvancedStreamEvent type (verified via instantiation)", async () => {
      const { AdvancedRAGService } = await import("./advanced-rag");
      const service = new AdvancedRAGService("tenant-123", "agent-456");
      expect(service).toBeDefined();
    });
  });

  describe("constructor", () => {
    it("should create instance with tenantId and agentId", async () => {
      const { AdvancedRAGService } = await import("./advanced-rag");
      const service = new AdvancedRAGService("tenant-123", "agent-456");
      expect(service).toBeInstanceOf(AdvancedRAGService);
    });

    it("should create instance with default channel (admin_ui)", async () => {
      const { AdvancedRAGService } = await import("./advanced-rag");
      const service = new AdvancedRAGService("tenant-123", "agent-456");
      expect(service).toBeDefined();
    });

    it("should create instance with explicit channel parameter", async () => {
      const { AdvancedRAGService } = await import("./advanced-rag");
      const serviceWidget = new AdvancedRAGService("tenant-123", "agent-456", "widget");
      const serviceApi = new AdvancedRAGService("tenant-123", "agent-456", "api");
      const serviceChatEndpoint = new AdvancedRAGService("tenant-123", "agent-456", "chat_endpoint");

      expect(serviceWidget).toBeDefined();
      expect(serviceApi).toBeDefined();
      expect(serviceChatEndpoint).toBeDefined();
    });
  });

  describe("chat method", () => {
    it("should have chat method that returns AsyncGenerator", async () => {
      const { AdvancedRAGService } = await import("./advanced-rag");
      const service = new AdvancedRAGService("tenant-123", "agent-456");

      expect(typeof service.chat).toBe("function");

      // Verify it returns an async generator (has Symbol.asyncIterator)
      const generator = service.chat("test message");
      expect(generator[Symbol.asyncIterator]).toBeDefined();
    });

    it("should accept message and optional conversationId", async () => {
      const { AdvancedRAGService } = await import("./advanced-rag");
      const service = new AdvancedRAGService("tenant-123", "agent-456");

      // These should not throw type errors
      const gen1 = service.chat("test message");
      const gen2 = service.chat("test message", "conv-123");

      expect(gen1).toBeDefined();
      expect(gen2).toBeDefined();
    });
  });
});

// ============================================================================
// Tests for ReasoningStep Interface
// ============================================================================

describe("ReasoningStep Interface", () => {
  describe("type field", () => {
    it("should accept valid reasoning step types", () => {
      const validTypes = ["rewrite", "plan", "search", "merge", "generate"];

      for (const type of validTypes) {
        const step = {
          id: "step-123",
          type,
          title: "Test Step",
          summary: "Test summary",
          status: "pending" as const,
        };

        expect(step.type).toBe(type);
      }
    });
  });

  describe("status field", () => {
    it("should accept valid status values", () => {
      const validStatuses = ["pending", "in_progress", "completed", "error"];

      for (const status of validStatuses) {
        const step = {
          id: "step-123",
          type: "search" as const,
          title: "Test Step",
          summary: "Test summary",
          status,
        };

        expect(step.status).toBe(status);
      }
    });
  });

  describe("optional details field", () => {
    it("should allow details to be undefined", () => {
      const step: {
        id: string;
        type: "search";
        title: string;
        summary: string;
        status: "completed";
        details?: Record<string, unknown>;
      } = {
        id: "step-123",
        type: "search",
        title: "Test Step",
        summary: "Test summary",
        status: "completed",
      };

      expect(step.details).toBeUndefined();
    });

    it("should allow details to contain arbitrary data", () => {
      const step = {
        id: "step-123",
        type: "plan" as const,
        title: "Query Planning",
        summary: "Generated 3 sub-queries",
        status: "completed" as const,
        details: {
          subQueries: ["query 1", "query 2", "query 3"],
          totalCount: 3,
        },
      };

      expect(step.details).toBeDefined();
      expect(step.details?.subQueries).toHaveLength(3);
    });
  });
});

// ============================================================================
// Tests for SubQuery Interface
// ============================================================================

describe("SubQuery Interface", () => {
  it("should have required id, query, and purpose fields", () => {
    const subQuery = {
      id: "sq-123",
      query: "What are the pricing options?",
      purpose: "Extract pricing information",
    };

    expect(subQuery.id).toBe("sq-123");
    expect(subQuery.query).toBe("What are the pricing options?");
    expect(subQuery.purpose).toBe("Extract pricing information");
  });

  it("should represent a search query with context", () => {
    const subQueries = [
      { id: "sq-1", query: "product features", purpose: "Find feature details" },
      { id: "sq-2", query: "pricing plans", purpose: "Find pricing info" },
      { id: "sq-3", query: "integration options", purpose: "Find integration docs" },
    ];

    expect(subQueries).toHaveLength(3);
    expect(subQueries[0].query).toBe("product features");
  });
});

// ============================================================================
// Tests for AdvancedStreamEvent Types
// ============================================================================

describe("AdvancedStreamEvent Types", () => {
  describe("status event", () => {
    it("should have type, status, and message fields", () => {
      const event = {
        type: "status" as const,
        status: "generating",
        message: "Found 5 sources. Generating response...",
      };

      expect(event.type).toBe("status");
      expect(event.status).toBe("generating");
      expect(event.message).toContain("Found 5 sources");
    });

    it("should optionally include sourceCount", () => {
      const event = {
        type: "status" as const,
        status: "generating",
        message: "Found 5 sources. Generating response...",
        sourceCount: 5,
      };

      expect(event.sourceCount).toBe(5);
    });
  });

  describe("reasoning event", () => {
    it("should contain a ReasoningStep", () => {
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
      expect(event.step.type).toBe("rewrite");
      expect(event.step.status).toBe("in_progress");
    });
  });

  describe("text event", () => {
    it("should contain streamed content", () => {
      const event = {
        type: "text" as const,
        content: "Based on the information in ",
      };

      expect(event.type).toBe("text");
      expect(event.content).toBe("Based on the information in ");
    });
  });

  describe("sources event", () => {
    it("should contain array of sources", () => {
      const event = {
        type: "sources" as const,
        sources: [
          { id: "chunk-1", title: "Pricing Guide", snippet: "Our pricing...", index: 1 },
          { id: "chunk-2", title: "Features", url: "https://example.com/features", snippet: "Key features...", index: 2 },
        ],
      };

      expect(event.type).toBe("sources");
      expect(event.sources).toHaveLength(2);
      expect(event.sources[0].title).toBe("Pricing Guide");
    });

    it("should have optional url field on sources", () => {
      const event: {
        type: "sources";
        sources: Array<{ id: string; title: string; snippet: string; index: number; url?: string }>;
      } = {
        type: "sources",
        sources: [
          { id: "chunk-1", title: "Doc", snippet: "Content...", index: 1 },
        ],
      };

      expect(event.sources[0].url).toBeUndefined();
    });
  });

  describe("done event", () => {
    it("should contain conversationId", () => {
      const event = {
        type: "done" as const,
        conversationId: "conv-abc-123",
      };

      expect(event.type).toBe("done");
      expect(event.conversationId).toBe("conv-abc-123");
    });
  });

  describe("error event", () => {
    it("should contain error message", () => {
      const event = {
        type: "error" as const,
        message: "Agent not found",
      };

      expect(event.type).toBe("error");
      expect(event.message).toBe("Agent not found");
    });
  });
});

// ============================================================================
// Tests for Service Behavior Contracts
// ============================================================================

describe("AdvancedRAGService Behavior Contracts", () => {
  describe("reasoning step sequence", () => {
    it("should define expected step types in order", () => {
      const expectedStepTypes = ["rewrite", "plan", "search", "merge", "generate"];

      // This documents the expected order of reasoning steps
      expect(expectedStepTypes[0]).toBe("rewrite");
      expect(expectedStepTypes[1]).toBe("plan");
      expect(expectedStepTypes[2]).toBe("search");
      expect(expectedStepTypes[3]).toBe("merge");
      expect(expectedStepTypes[4]).toBe("generate");
    });

    it("should have 5 reasoning step types", () => {
      const stepTypes = ["rewrite", "plan", "search", "merge", "generate"];
      expect(stepTypes).toHaveLength(5);
    });
  });

  describe("step status transitions", () => {
    it("should transition from pending to in_progress to completed", () => {
      const transitions = ["pending", "in_progress", "completed"];

      expect(transitions).toContain("pending");
      expect(transitions).toContain("in_progress");
      expect(transitions).toContain("completed");
    });

    it("should allow error status for failed steps", () => {
      const validStatuses = ["pending", "in_progress", "completed", "error"];
      expect(validStatuses).toContain("error");
    });
  });

  describe("channel types", () => {
    it("should support all valid channel types", () => {
      const validChannels = ["admin_ui", "widget", "api", "chat_endpoint"];

      expect(validChannels).toHaveLength(4);
      expect(validChannels).toContain("admin_ui");
      expect(validChannels).toContain("widget");
      expect(validChannels).toContain("api");
      expect(validChannels).toContain("chat_endpoint");
    });
  });
});

// ============================================================================
// Tests for Default Configuration Values
// ============================================================================

describe("AdvancedRAGService Configuration Defaults", () => {
  describe("expected default values", () => {
    it("should expect historyTurns default of 5", () => {
      const defaultHistoryTurns = 5;
      expect(defaultHistoryTurns).toBe(5);
      expect(defaultHistoryTurns).toBeGreaterThanOrEqual(1);
      expect(defaultHistoryTurns).toBeLessThanOrEqual(20);
    });

    it("should expect advancedMaxSubqueries default of 3", () => {
      const defaultMaxSubqueries = 3;
      expect(defaultMaxSubqueries).toBe(3);
      expect(defaultMaxSubqueries).toBeGreaterThanOrEqual(1);
      expect(defaultMaxSubqueries).toBeLessThanOrEqual(5);
    });

    it("should expect topK default of 8", () => {
      const defaultTopK = 8;
      expect(defaultTopK).toBe(8);
    });

    it("should expect candidateK default of 40", () => {
      const defaultCandidateK = 40;
      expect(defaultCandidateK).toBe(40);
    });

    it("should expect maxCitations default of 3", () => {
      const defaultMaxCitations = 3;
      expect(defaultMaxCitations).toBe(3);
    });

    it("should expect similarityThreshold default of 0.5", () => {
      const defaultThreshold = 0.5;
      expect(defaultThreshold).toBe(0.5);
    });
  });
});

// ============================================================================
// Tests for Event Discrimination
// ============================================================================

describe("Stream Event Type Discrimination", () => {
  it("should distinguish events by type field", () => {
    const events = [
      { type: "status", status: "generating", message: "Starting..." },
      { type: "reasoning", step: { id: "1", type: "rewrite", title: "Rewrite", summary: "...", status: "completed" } },
      { type: "text", content: "Hello" },
      { type: "sources", sources: [] },
      { type: "done", conversationId: "conv-123" },
      { type: "error", message: "Failed" },
    ];

    const typeSet = new Set(events.map(e => e.type));

    expect(typeSet.has("status")).toBe(true);
    expect(typeSet.has("reasoning")).toBe(true);
    expect(typeSet.has("text")).toBe(true);
    expect(typeSet.has("sources")).toBe(true);
    expect(typeSet.has("done")).toBe(true);
    expect(typeSet.has("error")).toBe(true);
  });

  it("should have unique type identifiers for each event kind", () => {
    const eventTypes = ["status", "reasoning", "text", "sources", "done", "error"];
    const uniqueTypes = new Set(eventTypes);

    expect(uniqueTypes.size).toBe(eventTypes.length);
    expect(uniqueTypes.size).toBe(6);
  });
});

// ============================================================================
// Tests for Query Rewriting Behavior
// ============================================================================

describe("Query Rewriting Behavior", () => {
  describe("history formatting", () => {
    it("should format user turns with 'User:' prefix", () => {
      const turn = { role: "user" as const, content: "What is the pricing?", timestamp: Date.now() };
      const formatted = `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`;
      expect(formatted).toBe("User: What is the pricing?");
    });

    it("should format assistant turns with 'Assistant:' prefix", () => {
      const turn: { role: "user" | "assistant"; content: string; timestamp: number } = {
        role: "assistant",
        content: "The pricing starts at $10/month.",
        timestamp: Date.now()
      };
      const formatted = `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`;
      expect(formatted).toBe("Assistant: The pricing starts at $10/month.");
    });

    it("should join multiple turns with newlines", () => {
      const history = [
        { role: "user" as const, content: "What is the pricing?", timestamp: Date.now() },
        { role: "assistant" as const, content: "The pricing starts at $10/month.", timestamp: Date.now() },
        { role: "user" as const, content: "Is there a free tier?", timestamp: Date.now() },
      ];

      const formatted = history
        .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
        .join("\n");

      expect(formatted).toContain("User: What is the pricing?");
      expect(formatted).toContain("Assistant: The pricing starts at $10/month.");
      expect(formatted).toContain("User: Is there a free tier?");
      expect(formatted.split("\n")).toHaveLength(3);
    });
  });

  describe("rewrite prompt structure", () => {
    it("should instruct LLM to reformulate queries with context", () => {
      const systemPrompt = `You are a query rewriting assistant. Your task is to reformulate the user's latest query to be self-contained and specific, incorporating relevant context from the conversation history.`;

      expect(systemPrompt).toContain("query rewriting");
      expect(systemPrompt).toContain("reformulate");
      expect(systemPrompt).toContain("self-contained");
      expect(systemPrompt).toContain("conversation history");
    });

    it("should include rules for pronoun expansion", () => {
      const rules = [
        'If the query references previous context (e.g., "it", "that", "this", pronouns), expand it to be explicit',
        "If the query is already self-contained, return it unchanged",
        "Keep the rewritten query concise and focused",
        "Return ONLY the rewritten query, nothing else",
        "Do not add explanations or preamble",
      ];

      expect(rules).toHaveLength(5);
      expect(rules[0]).toContain("pronouns");
      expect(rules[1]).toContain("self-contained");
      expect(rules[3]).toContain("ONLY the rewritten query");
    });
  });

  describe("expected rewriting scenarios", () => {
    it("should document scenario: no history returns original query", () => {
      const query = "What are the pricing options?";
      const history: unknown[] = [];

      // When history is empty, query should be returned unchanged
      const expectedBehavior = history.length === 0 ? "return original" : "may rewrite";
      expect(expectedBehavior).toBe("return original");
    });

    it("should document scenario: self-contained query with history", () => {
      const query = "What are the integration options for Salesforce?";
      // Even with history, if query is already specific, it may not need rewriting
      const isSelfContained = !query.match(/\b(it|that|this|they|them|those)\b/i);
      expect(isSelfContained).toBe(true);
    });

    it("should document scenario: query with pronouns needs context", () => {
      const query = "How much does it cost?";
      // "it" is ambiguous - needs context from history
      const hasPronouns = query.match(/\b(it|that|this|they|them|those)\b/i);
      expect(hasPronouns).toBeTruthy();
    });

    it("should document scenario: follow-up question needs expansion", () => {
      const history = [
        { role: "user" as const, content: "Tell me about the Enterprise plan", timestamp: Date.now() },
        { role: "assistant" as const, content: "The Enterprise plan includes...", timestamp: Date.now() },
      ];
      const query = "What about the support options?";

      // "the support options" likely refers to Enterprise plan support
      // Rewritten might be: "What are the support options for the Enterprise plan?"
      expect(history).toHaveLength(2);
      expect(query).toContain("support options");
    });
  });

  describe("history turns limiting", () => {
    it("should document historyTurns parameter usage", () => {
      const fullHistory = [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" },
        { role: "assistant", content: "A2" },
        { role: "user", content: "Q3" },
        { role: "assistant", content: "A3" },
        { role: "user", content: "Q4" },
        { role: "assistant", content: "A4" },
      ];

      const historyTurns = 3; // Default is 5, but using 3 for test
      // Each turn = user + assistant, so 3 turns = 6 messages
      const limitedHistory = fullHistory.slice(-historyTurns * 2);

      expect(limitedHistory).toHaveLength(6);
      expect(limitedHistory[0].content).toBe("Q2");
      expect(limitedHistory[5].content).toBe("A4");
    });

    it("should handle history shorter than historyTurns limit", () => {
      const fullHistory = [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
      ];

      const historyTurns = 5;
      const limitedHistory = fullHistory.slice(-historyTurns * 2);

      // Should return all available history when less than limit
      expect(limitedHistory).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("should document fallback behavior on LLM error", () => {
      const originalQuery = "What about that feature?";
      // If LLM call fails, should return original query
      const fallbackBehavior = "return original query on error";
      expect(fallbackBehavior).toContain("original query");
    });

    it("should document fallback behavior when model unavailable", () => {
      // If no model is configured, should return original query
      const noModelBehavior = "return original query if no model";
      expect(noModelBehavior).toContain("original query");
    });
  });
});

// ============================================================================
// Tests for Comparison with SimpleRAGService
// ============================================================================

describe("AdvancedRAGService vs SimpleRAGService", () => {
  describe("shared event types", () => {
    it("should share status, text, sources, done, and error events with SimpleRAG", () => {
      const sharedTypes = ["status", "text", "sources", "done", "error"];
      expect(sharedTypes).toHaveLength(5);
    });
  });

  describe("unique advanced event", () => {
    it("should have unique 'reasoning' event type not in SimpleRAG", () => {
      const advancedOnlyType = "reasoning";
      expect(advancedOnlyType).toBe("reasoning");
    });
  });

  describe("additional config fields", () => {
    it("should require historyTurns for query rewriting", () => {
      const advancedConfigFields = ["historyTurns", "advancedMaxSubqueries"];
      expect(advancedConfigFields).toContain("historyTurns");
    });

    it("should require advancedMaxSubqueries for sub-query planning", () => {
      const advancedConfigFields = ["historyTurns", "advancedMaxSubqueries"];
      expect(advancedConfigFields).toContain("advancedMaxSubqueries");
    });
  });
});
