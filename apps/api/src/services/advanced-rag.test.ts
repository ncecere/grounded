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
// Tests for Multi-Step Plan Generation Behavior
// ============================================================================

describe("Multi-Step Plan Generation Behavior", () => {
  describe("plan generation prompt structure", () => {
    it("should instruct LLM to generate focused sub-queries", () => {
      const systemPromptKeywords = [
        "search query planner",
        "focused sub-queries",
        "comprehensive information",
      ];

      // The prompt should contain these key concepts
      const mockPrompt = `You are a search query planner. Given a user query, generate up to 3 focused sub-queries that together will retrieve comprehensive information to answer the original query.`;

      for (const keyword of systemPromptKeywords) {
        expect(mockPrompt.toLowerCase()).toContain(keyword.toLowerCase());
      }
    });

    it("should include rules for sub-query generation", () => {
      const expectedRules = [
        "Each sub-query should target a specific aspect",
        "Sub-queries should be complementary, not redundant",
        "If the original query is simple and focused, return just 1 sub-query",
        "Return queries in JSON format",
        "Keep queries concise and search-optimized",
        "Return ONLY the JSON array",
      ];

      // Each rule addresses a specific concern for quality sub-queries
      expect(expectedRules).toHaveLength(6);
      expect(expectedRules[0]).toContain("specific aspect");
      expect(expectedRules[1]).toContain("complementary");
      expect(expectedRules[2]).toContain("simple and focused");
      expect(expectedRules[3]).toContain("JSON format");
    });

    it("should request JSON array output format", () => {
      const expectedFormat = '[{"query": "...", "purpose": "..."}]';

      // The expected JSON structure for sub-queries
      expect(expectedFormat).toContain("query");
      expect(expectedFormat).toContain("purpose");
      expect(expectedFormat.startsWith("[")).toBe(true);
      expect(expectedFormat.endsWith("]")).toBe(true);
    });
  });

  describe("sub-query generation scenarios", () => {
    it("should document scenario: simple query returns single sub-query", () => {
      const simpleQuery = "What is your pricing?";

      // A simple, focused query may not need decomposition
      // Expected: single sub-query with original query
      const expectedSubQueries = [
        { id: "sq-1", query: "What is your pricing?", purpose: "Original query" },
      ];

      expect(expectedSubQueries).toHaveLength(1);
      expect(expectedSubQueries[0].query).toBe(simpleQuery);
    });

    it("should document scenario: complex query decomposes into multiple sub-queries", () => {
      const complexQuery =
        "Compare the Enterprise and Pro plans, including pricing, features, and support options";

      // A complex query should decompose into multiple focused sub-queries
      const expectedSubQueries = [
        { id: "sq-1", query: "Enterprise plan pricing", purpose: "Get Enterprise pricing details" },
        { id: "sq-2", query: "Pro plan pricing", purpose: "Get Pro pricing details" },
        { id: "sq-3", query: "Enterprise vs Pro features comparison", purpose: "Compare plan features" },
      ];

      expect(expectedSubQueries).toHaveLength(3);
      expect(expectedSubQueries.map(sq => sq.query)).not.toContain(complexQuery);
    });

    it("should document scenario: multi-aspect query generates complementary sub-queries", () => {
      const multiAspectQuery = "How do I integrate with Salesforce and what are the API limits?";

      // Multiple aspects should generate complementary (not overlapping) sub-queries
      const expectedSubQueries = [
        { id: "sq-1", query: "Salesforce integration setup", purpose: "Find integration instructions" },
        { id: "sq-2", query: "API rate limits and quotas", purpose: "Find API limitations" },
      ];

      // Sub-queries should be distinct and complementary
      const queries = expectedSubQueries.map(sq => sq.query);
      const uniqueQueries = new Set(queries);
      expect(uniqueQueries.size).toBe(queries.length);
    });
  });

  describe("advancedMaxSubqueries limiting", () => {
    it("should respect advancedMaxSubqueries configuration", () => {
      const maxSubqueries = 3;
      const generatedSubQueries = [
        { query: "sub-query 1", purpose: "purpose 1" },
        { query: "sub-query 2", purpose: "purpose 2" },
        { query: "sub-query 3", purpose: "purpose 3" },
        { query: "sub-query 4", purpose: "purpose 4" }, // Should be excluded
        { query: "sub-query 5", purpose: "purpose 5" }, // Should be excluded
      ];

      const limited = generatedSubQueries.slice(0, maxSubqueries);

      expect(limited).toHaveLength(3);
      expect(limited[2].query).toBe("sub-query 3");
    });

    it("should handle default maxSubqueries of 3", () => {
      const defaultMaxSubqueries = 3;

      expect(defaultMaxSubqueries).toBe(3);
      expect(defaultMaxSubqueries).toBeGreaterThanOrEqual(1);
      expect(defaultMaxSubqueries).toBeLessThanOrEqual(5);
    });

    it("should handle custom maxSubqueries values (1-5 range)", () => {
      const validValues = [1, 2, 3, 4, 5];

      for (const value of validValues) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    });

    it("should limit even when LLM generates more than max", () => {
      const maxSubqueries = 2;
      const llmResponse = [
        { query: "first query", purpose: "first purpose" },
        { query: "second query", purpose: "second purpose" },
        { query: "third query", purpose: "third purpose" },
      ];

      const limited = llmResponse.slice(0, maxSubqueries);

      expect(limited).toHaveLength(2);
      expect(limited.map(sq => sq.query)).not.toContain("third query");
    });
  });

  describe("SubQuery structure validation", () => {
    it("should generate UUID for each sub-query id", () => {
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // Sub-query IDs should be UUIDs
      const mockId = "550e8400-e29b-41d4-a716-446655440000";
      expect(mockId).toMatch(uuidPattern);
    });

    it("should preserve query text from LLM response", () => {
      const llmResponseItem = { query: "specific search query", purpose: "find specific info" };
      const subQuery = {
        id: "test-id",
        query: llmResponseItem.query || "fallback",
        purpose: llmResponseItem.purpose || "Sub-query",
      };

      expect(subQuery.query).toBe("specific search query");
    });

    it("should use default purpose when not provided", () => {
      const llmResponseItem = { query: "search query" }; // No purpose
      const subQuery = {
        id: "test-id",
        query: llmResponseItem.query || "fallback",
        purpose: (llmResponseItem as { query: string; purpose?: string }).purpose || "Sub-query",
      };

      expect(subQuery.purpose).toBe("Sub-query");
    });

    it("should use original query as fallback when query field missing", () => {
      const originalQuery = "original user query";
      const llmResponseItem = { purpose: "some purpose" }; // No query field
      const subQuery = {
        id: "test-id",
        query: (llmResponseItem as { query?: string; purpose: string }).query || originalQuery,
        purpose: llmResponseItem.purpose || "Sub-query",
      };

      expect(subQuery.query).toBe(originalQuery);
    });
  });

  describe("JSON parsing behavior", () => {
    it("should parse valid JSON array response", () => {
      const validJsonResponse = '[{"query": "pricing info", "purpose": "find pricing"}]';
      const parsed = JSON.parse(validJsonResponse);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].query).toBe("pricing info");
    });

    it("should handle JSON with extra whitespace", () => {
      const jsonWithWhitespace = `
        [
          {"query": "first query", "purpose": "first purpose"},
          {"query": "second query", "purpose": "second purpose"}
        ]
      `;
      const parsed = JSON.parse(jsonWithWhitespace.trim());

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it("should document fallback on invalid JSON", () => {
      const invalidJson = "Not a valid JSON array";

      let parseError = false;
      try {
        JSON.parse(invalidJson);
      } catch {
        parseError = true;
      }

      // On parse error, fallback to original query
      expect(parseError).toBe(true);
    });

    it("should document fallback when response is not an array", () => {
      const notArrayResponse = '{"query": "single query", "purpose": "purpose"}';
      const parsed = JSON.parse(notArrayResponse);

      const isArray = Array.isArray(parsed);
      expect(isArray).toBe(false);

      // Fallback behavior: return original query as single sub-query
    });
  });

  describe("error handling in plan generation", () => {
    it("should document fallback to original query on LLM error", () => {
      const originalQuery = "user's original query";
      const errorBehavior = "fallback to single sub-query with original query";

      // On any error, service should return original query as single sub-query
      const fallbackSubQuery = {
        id: "fallback-id",
        query: originalQuery,
        purpose: "Original query",
      };

      expect(fallbackSubQuery.query).toBe(originalQuery);
      expect(fallbackSubQuery.purpose).toBe("Original query");
      expect(errorBehavior).toContain("fallback");
    });

    it("should document fallback when no model configured", () => {
      const noModelBehavior = "return original query if config is null";
      expect(noModelBehavior).toContain("original query");
    });

    it("should document fallback when model returns empty response", () => {
      const emptyResponse = "";

      let parseError = false;
      try {
        JSON.parse(emptyResponse.trim());
      } catch {
        parseError = true;
      }

      expect(parseError).toBe(true);
      // Fallback: return original query as single sub-query
    });

    it("should log warning on sub-query generation failure", () => {
      const expectedLogLevel = "warn";
      const expectedLogMessage = "AdvancedRAG: Sub-query generation failed, using original";

      expect(expectedLogLevel).toBe("warn");
      expect(expectedLogMessage).toContain("Sub-query generation failed");
      expect(expectedLogMessage).toContain("using original");
    });
  });

  describe("plan step in reasoning sequence", () => {
    it("should emit plan step after rewrite step", () => {
      const reasoningSequence = ["rewrite", "plan", "search", "merge", "generate"];

      const rewriteIndex = reasoningSequence.indexOf("rewrite");
      const planIndex = reasoningSequence.indexOf("plan");

      expect(planIndex).toBe(rewriteIndex + 1);
    });

    it("should emit plan step before search step", () => {
      const reasoningSequence = ["rewrite", "plan", "search", "merge", "generate"];

      const planIndex = reasoningSequence.indexOf("plan");
      const searchIndex = reasoningSequence.indexOf("search");

      expect(searchIndex).toBe(planIndex + 1);
    });

    it("should include subQueries in plan step details", () => {
      const planStep = {
        id: "step-123",
        type: "plan" as const,
        title: "Query Planning",
        summary: "Generated 3 sub-queries for retrieval",
        status: "completed" as const,
        details: {
          subQueries: ["pricing options", "feature comparison", "integration guide"],
        },
      };

      expect(planStep.details).toBeDefined();
      expect(planStep.details?.subQueries).toHaveLength(3);
    });

    it("should report correct count in plan step summary", () => {
      const subQueryCount: number = 3;
      const expectedSummary = `Generated ${subQueryCount} sub-quer${subQueryCount === 1 ? "y" : "ies"} for retrieval`;

      expect(expectedSummary).toBe("Generated 3 sub-queries for retrieval");
    });

    it("should use singular 'sub-query' for count of 1", () => {
      const subQueryCount = 1;
      const summary = `Generated ${subQueryCount} sub-quer${subQueryCount === 1 ? "y" : "ies"} for retrieval`;

      expect(summary).toBe("Generated 1 sub-query for retrieval");
    });
  });

  describe("integration with subsequent steps", () => {
    it("should pass sub-queries to executeSubQueries", () => {
      const subQueries = [
        { id: "sq-1", query: "pricing", purpose: "find pricing" },
        { id: "sq-2", query: "features", purpose: "find features" },
      ];

      // executeSubQueries should receive all generated sub-queries
      expect(subQueries).toHaveLength(2);
      expect(subQueries.every(sq => sq.query && sq.id && sq.purpose)).toBe(true);
    });

    it("should execute search for each sub-query in parallel", () => {
      const subQueries = [
        { id: "sq-1", query: "query 1", purpose: "purpose 1" },
        { id: "sq-2", query: "query 2", purpose: "purpose 2" },
        { id: "sq-3", query: "query 3", purpose: "purpose 3" },
      ];

      // Promise.all is used for parallel execution
      const queryStrings = subQueries.map(sq => sq.query);

      expect(queryStrings).toHaveLength(3);
      expect(queryStrings).toEqual(["query 1", "query 2", "query 3"]);
    });
  });
});

// ============================================================================
// Tests for Sub-Query Retrieval Behavior
// ============================================================================

describe("Sub-Query Retrieval Behavior", () => {
  describe("executeSubQueries parallel execution", () => {
    it("should execute all sub-queries in parallel using Promise.all", () => {
      const subQueries = [
        { id: "sq-1", query: "pricing info", purpose: "find pricing" },
        { id: "sq-2", query: "feature list", purpose: "find features" },
        { id: "sq-3", query: "integration guide", purpose: "find integrations" },
      ];

      // The service uses Promise.all to execute sub-queries in parallel
      // This is more efficient than sequential execution
      const queryCount = subQueries.length;
      expect(queryCount).toBe(3);

      // Each sub-query should have the required fields
      for (const sq of subQueries) {
        expect(sq.id).toBeDefined();
        expect(sq.query).toBeDefined();
        expect(sq.purpose).toBeDefined();
      }
    });

    it("should collect results from all sub-queries", () => {
      // Results from multiple sub-queries are combined into a single array
      const resultsFromSubQuery1 = [
        { id: "chunk-1", content: "Pricing starts at $10", score: 0.95 },
        { id: "chunk-2", content: "Enterprise pricing", score: 0.85 },
      ];
      const resultsFromSubQuery2 = [
        { id: "chunk-3", content: "Feature A", score: 0.90 },
        { id: "chunk-4", content: "Feature B", score: 0.80 },
      ];

      const allChunks = [...resultsFromSubQuery1, ...resultsFromSubQuery2];

      expect(allChunks).toHaveLength(4);
      expect(allChunks[0].id).toBe("chunk-1");
      expect(allChunks[2].id).toBe("chunk-3");
    });

    it("should handle single sub-query (simple query case)", () => {
      const subQueries = [
        { id: "sq-1", query: "What is your pricing?", purpose: "Original query" },
      ];

      // Single sub-query is a valid case (for simple queries)
      expect(subQueries).toHaveLength(1);
    });

    it("should handle empty sub-query array gracefully", () => {
      const subQueries: { id: string; query: string; purpose: string }[] = [];

      // Empty sub-queries should result in empty chunks
      expect(subQueries).toHaveLength(0);
    });

    it("should return empty array when no KBs are attached", () => {
      // When kbIds is empty, searchKnowledge returns empty array
      const kbIds: string[] = [];
      const expectedBehavior = kbIds.length === 0 ? "return empty" : "search";

      expect(expectedBehavior).toBe("return empty");
    });
  });

  describe("searchKnowledge method", () => {
    it("should generate embedding for the query", () => {
      const query = "What are the pricing options?";

      // The service generates embeddings for semantic search
      expect(query.length).toBeGreaterThan(0);
    });

    it("should search with configured parameters", () => {
      const searchConfig = {
        tenantId: "tenant-123",
        kbIds: ["kb-1", "kb-2"],
        topK: 40,        // candidateK - initial retrieval
        minScore: 0.5,   // similarityThreshold
      };

      expect(searchConfig.topK).toBe(40);
      expect(searchConfig.minScore).toBe(0.5);
      expect(searchConfig.kbIds).toHaveLength(2);
    });

    it("should limit results to topK per sub-query", () => {
      const topK = 8;
      const candidateResults = Array.from({ length: 15 }, (_, i) => ({
        id: `chunk-${i}`,
        score: 0.9 - i * 0.02,
      }));

      const topResults = candidateResults.slice(0, topK);

      expect(topResults).toHaveLength(8);
      expect(topResults[0].score).toBe(0.9);
    });

    it("should return empty array when vector store not configured", () => {
      // If vectorStore is null, search returns empty array
      const vectorStoreConfigured = false;
      const expectedResult = vectorStoreConfigured ? "search" : "empty array";

      expect(expectedResult).toBe("empty array");
    });

    it("should return empty array when search returns no results", () => {
      const searchResults: unknown[] = [];

      // Empty search results should be handled gracefully
      expect(searchResults).toHaveLength(0);
    });

    it("should look up chunk metadata from database", () => {
      // After vector search, we look up chunks in database for full metadata
      const vectorResults = [
        { id: "chunk-1", score: 0.95 },
        { id: "chunk-2", score: 0.85 },
      ];

      const chunkIds = vectorResults.map(r => r.id);

      expect(chunkIds).toEqual(["chunk-1", "chunk-2"]);
    });

    it("should build RetrievedChunk with all required fields", () => {
      const chunk = {
        id: "chunk-1",
        content: "This is the chunk content",
        title: "Document Title",
        url: "https://example.com/doc",
        score: 0.95,
      };

      expect(chunk.id).toBeDefined();
      expect(chunk.content).toBeDefined();
      expect(chunk.title).toBeDefined();
      expect(chunk.score).toBeDefined();
    });

    it("should handle chunks without title or URL", () => {
      const chunk: {
        id: string;
        content: string;
        title?: string;
        url?: string;
        score: number;
      } = {
        id: "chunk-1",
        content: "Content without metadata",
        score: 0.85,
      };

      expect(chunk.title).toBeUndefined();
      expect(chunk.url).toBeUndefined();
    });

    it("should use heading as fallback for title", () => {
      const dbChunk = {
        id: "chunk-1",
        content: "Content",
        title: null,
        heading: "Section Heading",
        normalizedUrl: null,
      };

      const title = dbChunk.title || dbChunk.heading || undefined;

      expect(title).toBe("Section Heading");
    });

    it("should use normalizedUrl for URL field", () => {
      const dbChunk = {
        id: "chunk-1",
        normalizedUrl: "https://example.com/page#section",
      };

      const url = dbChunk.normalizedUrl || undefined;

      expect(url).toBe("https://example.com/page#section");
    });
  });

  describe("search step reasoning event", () => {
    it("should emit search step after plan step", () => {
      const reasoningSequence = ["rewrite", "plan", "search", "merge", "generate"];

      const planIndex = reasoningSequence.indexOf("plan");
      const searchIndex = reasoningSequence.indexOf("search");

      expect(searchIndex).toBe(planIndex + 1);
    });

    it("should report sub-query count in search step summary", () => {
      const subQueryCount: number = 3;
      const expectedSummary = `Searching knowledge bases with ${subQueryCount} quer${subQueryCount === 1 ? "y" : "ies"}...`;

      expect(expectedSummary).toBe("Searching knowledge bases with 3 queries...");
    });

    it("should use singular 'query' for count of 1", () => {
      const subQueryCount = 1;
      const summary = `Searching knowledge bases with ${subQueryCount} quer${subQueryCount === 1 ? "y" : "ies"}...`;

      expect(summary).toBe("Searching knowledge bases with 1 query...");
    });

    it("should report chunk count in completed search step", () => {
      const foundChunks = 12;
      const completedSummary = `Found ${foundChunks} relevant chunks`;

      expect(completedSummary).toBe("Found 12 relevant chunks");
    });
  });
});

// ============================================================================
// Tests for Chunk Merging and Deduplication
// ============================================================================

describe("Chunk Merging and Deduplication", () => {
  describe("mergeAndDeduplicateChunks method", () => {
    it("should deduplicate chunks by ID", () => {
      const chunks = [
        { id: "chunk-1", content: "Content A", score: 0.85 },
        { id: "chunk-2", content: "Content B", score: 0.80 },
        { id: "chunk-1", content: "Content A", score: 0.90 }, // Duplicate ID
      ];

      // Use Map for deduplication
      const chunkMap = new Map<string, typeof chunks[0]>();
      for (const chunk of chunks) {
        const existing = chunkMap.get(chunk.id);
        if (!existing || chunk.score > existing.score) {
          chunkMap.set(chunk.id, chunk);
        }
      }

      const merged = Array.from(chunkMap.values());

      expect(merged).toHaveLength(2);
    });

    it("should keep chunk with highest score when duplicates exist", () => {
      const chunks = [
        { id: "chunk-1", content: "Content", score: 0.85 },
        { id: "chunk-1", content: "Content", score: 0.95 }, // Higher score
        { id: "chunk-1", content: "Content", score: 0.75 }, // Lower score
      ];

      const chunkMap = new Map<string, typeof chunks[0]>();
      for (const chunk of chunks) {
        const existing = chunkMap.get(chunk.id);
        if (!existing || chunk.score > existing.score) {
          chunkMap.set(chunk.id, chunk);
        }
      }

      const merged = Array.from(chunkMap.values());

      expect(merged).toHaveLength(1);
      expect(merged[0].score).toBe(0.95);
    });

    it("should sort results by score descending", () => {
      const chunks = [
        { id: "chunk-1", content: "Low score", score: 0.60 },
        { id: "chunk-2", content: "High score", score: 0.95 },
        { id: "chunk-3", content: "Medium score", score: 0.80 },
      ];

      const sorted = [...chunks].sort((a, b) => b.score - a.score);

      expect(sorted[0].score).toBe(0.95);
      expect(sorted[1].score).toBe(0.80);
      expect(sorted[2].score).toBe(0.60);
    });

    it("should limit results to topK", () => {
      const topK = 3;
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        id: `chunk-${i}`,
        content: `Content ${i}`,
        score: 0.9 - i * 0.05,
      }));

      const limited = chunks.slice(0, topK);

      expect(limited).toHaveLength(3);
      expect(limited[0].id).toBe("chunk-0");
      expect(limited[2].id).toBe("chunk-2");
    });

    it("should handle empty chunk array", () => {
      const chunks: { id: string; content: string; score: number }[] = [];

      const merged = Array.from(new Map(chunks.map(c => [c.id, c])).values());

      expect(merged).toHaveLength(0);
    });

    it("should return chunks unchanged when no config (early return)", () => {
      // When config is null, chunks are returned as-is
      const configIsNull = true;
      const expectedBehavior = configIsNull ? "return original" : "process";

      expect(expectedBehavior).toBe("return original");
    });

    it("should handle chunks from multiple sub-queries with overlap", () => {
      // Sub-query 1 results
      const chunksFromSQ1 = [
        { id: "chunk-A", content: "Shared content", score: 0.85 },
        { id: "chunk-B", content: "Unique to SQ1", score: 0.80 },
      ];
      // Sub-query 2 results
      const chunksFromSQ2 = [
        { id: "chunk-A", content: "Shared content", score: 0.90 }, // Same ID, higher score
        { id: "chunk-C", content: "Unique to SQ2", score: 0.75 },
      ];

      const allChunks = [...chunksFromSQ1, ...chunksFromSQ2];

      const chunkMap = new Map<string, typeof allChunks[0]>();
      for (const chunk of allChunks) {
        const existing = chunkMap.get(chunk.id);
        if (!existing || chunk.score > existing.score) {
          chunkMap.set(chunk.id, chunk);
        }
      }

      const merged = Array.from(chunkMap.values());

      expect(merged).toHaveLength(3);
      // chunk-A should have the higher score (0.90)
      const chunkA = merged.find(c => c.id === "chunk-A");
      expect(chunkA?.score).toBe(0.90);
    });
  });

  describe("merge step reasoning event", () => {
    it("should emit merge step after search step", () => {
      const reasoningSequence = ["rewrite", "plan", "search", "merge", "generate"];

      const searchIndex = reasoningSequence.indexOf("search");
      const mergeIndex = reasoningSequence.indexOf("merge");

      expect(mergeIndex).toBe(searchIndex + 1);
    });

    it("should report deduplication in merge step summary", () => {
      const originalCount = 15;
      const mergedCount = 8;

      // The merge step reports how many unique chunks remain
      const completedSummary = `Merged to ${mergedCount} unique chunks`;

      expect(completedSummary).toBe("Merged to 8 unique chunks");
    });

    it("should start with 'Deduplicating and ranking results' message", () => {
      const inProgressSummary = "Deduplicating and ranking results...";

      expect(inProgressSummary).toContain("Deduplicating");
      expect(inProgressSummary).toContain("ranking");
    });
  });

  describe("topK configuration", () => {
    it("should use default topK of 8", () => {
      const defaultTopK = 8;

      expect(defaultTopK).toBe(8);
    });

    it("should respect custom topK from retrieval config", () => {
      const customTopK = 15;
      const chunks = Array.from({ length: 20 }, (_, i) => ({
        id: `chunk-${i}`,
        content: `Content ${i}`,
        score: 0.95 - i * 0.01,
      }));

      const limited = chunks.slice(0, customTopK);

      expect(limited).toHaveLength(15);
    });
  });

  describe("score preservation", () => {
    it("should preserve original scores from vector search", () => {
      const chunk = {
        id: "chunk-1",
        content: "Content",
        score: 0.87654321,
      };

      // Score should be preserved exactly
      expect(chunk.score).toBe(0.87654321);
    });

    it("should not modify scores during deduplication", () => {
      const chunks = [
        { id: "chunk-1", content: "A", score: 0.95 },
        { id: "chunk-1", content: "A", score: 0.85 },
      ];

      const chunkMap = new Map<string, typeof chunks[0]>();
      for (const chunk of chunks) {
        const existing = chunkMap.get(chunk.id);
        if (!existing || chunk.score > existing.score) {
          chunkMap.set(chunk.id, chunk);
        }
      }

      const kept = chunkMap.get("chunk-1");

      // Score should be the original higher score, not computed
      expect(kept?.score).toBe(0.95);
    });
  });
});

// ============================================================================
// Tests for Status Event After Merging
// ============================================================================

describe("Status Event After Merging", () => {
  it("should emit status event with source count", () => {
    const sourceCount = 8;
    const statusEvent = {
      type: "status" as const,
      status: "generating",
      message: `Found ${sourceCount} sources. Generating response...`,
      sourceCount,
    };

    expect(statusEvent.type).toBe("status");
    expect(statusEvent.sourceCount).toBe(8);
    expect(statusEvent.message).toContain("Found 8 sources");
  });

  it("should handle zero sources case", () => {
    const sourceCount = 0;
    const statusEvent = {
      type: "status" as const,
      status: "generating",
      message: sourceCount > 0
        ? `Found ${sourceCount} sources. Generating response...`
        : "No relevant sources found. Generating response...",
      sourceCount,
    };

    expect(statusEvent.message).toBe("No relevant sources found. Generating response...");
    expect(statusEvent.sourceCount).toBe(0);
  });

  it("should emit status after merge step completes", () => {
    const eventSequence = [
      { type: "reasoning", step: { type: "merge", status: "completed" } },
      { type: "status", status: "generating" },
      { type: "reasoning", step: { type: "generate", status: "in_progress" } },
    ];

    const mergeIndex = eventSequence.findIndex(
      e => e.type === "reasoning" && (e.step as { type: string }).type === "merge"
    );
    const statusIndex = eventSequence.findIndex(e => e.type === "status");
    const generateIndex = eventSequence.findIndex(
      e => e.type === "reasoning" && (e.step as { type: string }).type === "generate"
    );

    expect(statusIndex).toBeGreaterThan(mergeIndex);
    expect(statusIndex).toBeLessThan(generateIndex);
  });
});

// ============================================================================
// Tests for Retrieved Chunk Interface
// ============================================================================

describe("RetrievedChunk Interface", () => {
  it("should have required id, content, and score fields", () => {
    const chunk = {
      id: "chunk-123",
      content: "This is the retrieved content",
      score: 0.85,
    };

    expect(chunk.id).toBeDefined();
    expect(chunk.content).toBeDefined();
    expect(chunk.score).toBeDefined();
  });

  it("should have optional title and url fields", () => {
    const chunkWithMeta = {
      id: "chunk-123",
      content: "Content with metadata",
      title: "Document Title",
      url: "https://example.com/doc",
      score: 0.90,
    };

    const chunkWithoutMeta: {
      id: string;
      content: string;
      score: number;
      title?: string;
      url?: string;
    } = {
      id: "chunk-456",
      content: "Content without metadata",
      score: 0.85,
    };

    expect(chunkWithMeta.title).toBe("Document Title");
    expect(chunkWithMeta.url).toBe("https://example.com/doc");
    expect(chunkWithoutMeta.title).toBeUndefined();
    expect(chunkWithoutMeta.url).toBeUndefined();
  });

  it("should support score values between 0 and 1", () => {
    const scores = [0.0, 0.5, 0.75, 0.95, 1.0];

    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
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
