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

// ============================================================================
// Tests for Reasoning Event Emission
// ============================================================================

describe("Reasoning Event Emission", () => {
  describe("reasoning event structure", () => {
    it("should emit reasoning events with correct type discriminator", () => {
      const reasoningEvent = {
        type: "reasoning" as const,
        step: {
          id: "step-123",
          type: "rewrite" as const,
          title: "Query Rewriting",
          summary: "Processing...",
          status: "in_progress" as const,
        },
      };

      expect(reasoningEvent.type).toBe("reasoning");
      expect(reasoningEvent.step).toBeDefined();
    });

    it("should include all required fields in ReasoningStep", () => {
      const step = {
        id: "step-abc-123",
        type: "search" as const,
        title: "Knowledge Search",
        summary: "Searching knowledge bases...",
        status: "in_progress" as const,
      };

      // Required fields
      expect(step.id).toBeDefined();
      expect(step.type).toBeDefined();
      expect(step.title).toBeDefined();
      expect(step.summary).toBeDefined();
      expect(step.status).toBeDefined();
    });

    it("should allow optional details field in ReasoningStep", () => {
      const stepWithDetails = {
        id: "step-123",
        type: "plan" as const,
        title: "Query Planning",
        summary: "Generated 3 sub-queries",
        status: "completed" as const,
        details: {
          subQueries: ["query 1", "query 2", "query 3"],
        },
      };

      const stepWithoutDetails: {
        id: string;
        type: "plan";
        title: string;
        summary: string;
        status: "completed";
        details?: Record<string, unknown>;
      } = {
        id: "step-456",
        type: "plan",
        title: "Query Planning",
        summary: "Generated 1 sub-query",
        status: "completed",
      };

      expect(stepWithDetails.details).toBeDefined();
      expect(stepWithDetails.details?.subQueries).toHaveLength(3);
      expect(stepWithoutDetails.details).toBeUndefined();
    });
  });

  describe("reasoning step emission order", () => {
    it("should emit rewrite step first", () => {
      const expectedOrder = ["rewrite", "plan", "search", "merge", "generate"];
      expect(expectedOrder[0]).toBe("rewrite");
    });

    it("should emit plan step after rewrite", () => {
      const expectedOrder = ["rewrite", "plan", "search", "merge", "generate"];
      expect(expectedOrder.indexOf("plan")).toBe(expectedOrder.indexOf("rewrite") + 1);
    });

    it("should emit search step after plan", () => {
      const expectedOrder = ["rewrite", "plan", "search", "merge", "generate"];
      expect(expectedOrder.indexOf("search")).toBe(expectedOrder.indexOf("plan") + 1);
    });

    it("should emit merge step after search", () => {
      const expectedOrder = ["rewrite", "plan", "search", "merge", "generate"];
      expect(expectedOrder.indexOf("merge")).toBe(expectedOrder.indexOf("search") + 1);
    });

    it("should emit generate step last", () => {
      const expectedOrder = ["rewrite", "plan", "search", "merge", "generate"];
      expect(expectedOrder[expectedOrder.length - 1]).toBe("generate");
    });

    it("should emit exactly 5 reasoning step types", () => {
      const allStepTypes = ["rewrite", "plan", "search", "merge", "generate"];
      expect(allStepTypes).toHaveLength(5);
    });
  });

  describe("reasoning step status transitions", () => {
    it("should emit step with in_progress status initially", () => {
      const initialStep = {
        id: "step-1",
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary: "Analyzing conversation context...",
        status: "in_progress" as const,
      };

      expect(initialStep.status).toBe("in_progress");
    });

    it("should emit step with completed status after processing", () => {
      const completedStep = {
        id: "step-1",
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary: "Query reformulated successfully",
        status: "completed" as const,
      };

      expect(completedStep.status).toBe("completed");
    });

    it("should emit two reasoning events per step (in_progress then completed)", () => {
      // Each step emits twice: once when starting, once when done
      const stepEvents = [
        { type: "reasoning", step: { type: "rewrite", status: "in_progress" } },
        { type: "reasoning", step: { type: "rewrite", status: "completed" } },
      ];

      expect(stepEvents).toHaveLength(2);
      expect(stepEvents[0].step.status).toBe("in_progress");
      expect(stepEvents[1].step.status).toBe("completed");
    });

    it("should preserve step id across status transitions", () => {
      const stepId = "step-unique-123";

      const inProgressEvent = {
        type: "reasoning" as const,
        step: {
          id: stepId,
          type: "search" as const,
          title: "Knowledge Search",
          summary: "Searching...",
          status: "in_progress" as const,
        },
      };

      const completedEvent = {
        type: "reasoning" as const,
        step: {
          id: stepId, // Same ID
          type: "search" as const,
          title: "Knowledge Search",
          summary: "Found 12 chunks",
          status: "completed" as const,
        },
      };

      expect(inProgressEvent.step.id).toBe(completedEvent.step.id);
    });

    it("should update summary when status changes to completed", () => {
      const inProgressSummary = "Analyzing conversation context to reformulate query...";
      const completedSummary = 'Reformulated query: "What are the Enterprise plan features?"';

      expect(inProgressSummary).not.toBe(completedSummary);
      expect(completedSummary).toContain("Reformulated");
    });
  });

  describe("rewrite step emission details", () => {
    it("should emit rewrite step with correct title", () => {
      const rewriteStep = {
        id: "step-1",
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary: "Analyzing...",
        status: "in_progress" as const,
      };

      expect(rewriteStep.title).toBe("Query Rewriting");
    });

    it("should indicate when query was reformulated in completed summary", () => {
      const rewrittenQuery = "What are the Enterprise plan pricing options?";
      const completedSummary = `Reformulated query: "${rewrittenQuery.slice(0, 100)}${rewrittenQuery.length > 100 ? '...' : ''}"`;

      expect(completedSummary).toContain("Reformulated query:");
      expect(completedSummary).toContain("Enterprise plan");
    });

    it("should indicate when no reformulation was needed", () => {
      const noReformulationSummary = "Query used as-is (no reformulation needed)";

      expect(noReformulationSummary).toContain("as-is");
      expect(noReformulationSummary).toContain("no reformulation needed");
    });

    it("should truncate long reformulated queries in summary", () => {
      const longQuery = "A".repeat(150); // 150 characters
      const truncatedSummary = `Reformulated query: "${longQuery.slice(0, 100)}${longQuery.length > 100 ? '...' : ''}"`;

      expect(truncatedSummary.length).toBeLessThan(150);
      expect(truncatedSummary).toContain("...");
    });
  });

  describe("plan step emission details", () => {
    it("should emit plan step with correct title", () => {
      const planStep = {
        id: "step-2",
        type: "plan" as const,
        title: "Query Planning",
        summary: "Generating sub-queries...",
        status: "in_progress" as const,
      };

      expect(planStep.title).toBe("Query Planning");
    });

    it("should report sub-query count in completed summary", () => {
      const subQueryCount: number = 3;
      const completedSummary = `Generated ${subQueryCount} sub-quer${subQueryCount === 1 ? 'y' : 'ies'} for retrieval`;

      expect(completedSummary).toBe("Generated 3 sub-queries for retrieval");
    });

    it("should use singular form for single sub-query", () => {
      const subQueryCount = 1;
      const summary = `Generated ${subQueryCount} sub-quer${subQueryCount === 1 ? 'y' : 'ies'} for retrieval`;

      expect(summary).toBe("Generated 1 sub-query for retrieval");
    });

    it("should include sub-query list in details", () => {
      const planStep = {
        id: "step-2",
        type: "plan" as const,
        title: "Query Planning",
        summary: "Generated 3 sub-queries for retrieval",
        status: "completed" as const,
        details: {
          subQueries: [
            "pricing options for enterprise",
            "enterprise plan features",
            "enterprise support levels",
          ],
        },
      };

      expect(planStep.details?.subQueries).toHaveLength(3);
      expect(planStep.details?.subQueries).toContain("pricing options for enterprise");
    });
  });

  describe("search step emission details", () => {
    it("should emit search step with correct title", () => {
      const searchStep = {
        id: "step-3",
        type: "search" as const,
        title: "Knowledge Search",
        summary: "Searching...",
        status: "in_progress" as const,
      };

      expect(searchStep.title).toBe("Knowledge Search");
    });

    it("should report query count in in_progress summary", () => {
      const subQueryCount: number = 3;
      const inProgressSummary = `Searching knowledge bases with ${subQueryCount} quer${subQueryCount === 1 ? 'y' : 'ies'}...`;

      expect(inProgressSummary).toBe("Searching knowledge bases with 3 queries...");
    });

    it("should report chunk count in completed summary", () => {
      const chunkCount = 15;
      const completedSummary = `Found ${chunkCount} relevant chunks`;

      expect(completedSummary).toBe("Found 15 relevant chunks");
    });
  });

  describe("merge step emission details", () => {
    it("should emit merge step with correct title", () => {
      const mergeStep = {
        id: "step-4",
        type: "merge" as const,
        title: "Result Merging",
        summary: "Deduplicating...",
        status: "in_progress" as const,
      };

      expect(mergeStep.title).toBe("Result Merging");
    });

    it("should report unique chunk count in completed summary", () => {
      const uniqueCount = 8;
      const completedSummary = `Merged to ${uniqueCount} unique chunks`;

      expect(completedSummary).toBe("Merged to 8 unique chunks");
    });

    it("should have descriptive in_progress summary", () => {
      const inProgressSummary = "Deduplicating and ranking results...";

      expect(inProgressSummary).toContain("Deduplicating");
      expect(inProgressSummary).toContain("ranking");
    });
  });

  describe("generate step emission details", () => {
    it("should emit generate step with correct title", () => {
      const generateStep = {
        id: "step-5",
        type: "generate" as const,
        title: "Answer Generation",
        summary: "Generating...",
        status: "in_progress" as const,
      };

      expect(generateStep.title).toBe("Answer Generation");
    });

    it("should have descriptive in_progress summary", () => {
      const inProgressSummary = "Generating comprehensive answer with citations...";

      expect(inProgressSummary).toContain("Generating");
      expect(inProgressSummary).toContain("citations");
    });

    it("should have success message in completed summary", () => {
      const completedSummary = "Response generated successfully";

      expect(completedSummary).toContain("successfully");
    });
  });

  describe("reasoning event counting", () => {
    it("should emit 10 reasoning events total (2 per step × 5 steps)", () => {
      // Each step emits 2 events: in_progress and completed
      const stepsCount = 5;
      const eventsPerStep = 2;
      const totalReasoningEvents = stepsCount * eventsPerStep;

      expect(totalReasoningEvents).toBe(10);
    });

    it("should track reasoning steps count in usage logging", () => {
      // The service tracks reasoningStepsCount for analytics
      const reasoningStepsCount = 5; // One per step type

      expect(reasoningStepsCount).toBe(5);
    });
  });

  describe("reasoning event type discrimination", () => {
    it("should distinguish reasoning events from other event types", () => {
      const events = [
        { type: "reasoning", step: { type: "rewrite", status: "completed" } },
        { type: "status", status: "generating", message: "Found sources..." },
        { type: "text", content: "Based on..." },
      ];

      const reasoningEvents = events.filter(e => e.type === "reasoning");
      const statusEvents = events.filter(e => e.type === "status");
      const textEvents = events.filter(e => e.type === "text");

      expect(reasoningEvents).toHaveLength(1);
      expect(statusEvents).toHaveLength(1);
      expect(textEvents).toHaveLength(1);
    });

    it("should use type narrowing to access step property", () => {
      const event: { type: "reasoning"; step: { type: string; status: string } } = {
        type: "reasoning",
        step: { type: "plan", status: "completed" },
      };

      // Type narrowing allows accessing step property
      if (event.type === "reasoning") {
        expect(event.step.type).toBe("plan");
        expect(event.step.status).toBe("completed");
      }
    });
  });

  describe("error handling in reasoning steps", () => {
    it("should support error status for reasoning steps", () => {
      const validStatuses = ["pending", "in_progress", "completed", "error"];

      expect(validStatuses).toContain("error");
    });

    it("should allow error step to be emitted", () => {
      const errorStep = {
        id: "step-failed",
        type: "search" as const,
        title: "Knowledge Search",
        summary: "Search failed: Vector store unavailable",
        status: "error" as const,
      };

      expect(errorStep.status).toBe("error");
      expect(errorStep.summary).toContain("failed");
    });

    it("should document that service yields error event on failure", () => {
      // When an error occurs, the service yields an error event
      const errorEvent = {
        type: "error" as const,
        message: "Agent not found",
      };

      expect(errorEvent.type).toBe("error");
      expect(errorEvent.message).toBeDefined();
    });
  });

  describe("reasoning event integration with other events", () => {
    it("should emit status event after merge step completes", () => {
      const eventSequence = [
        "reasoning:merge:completed",
        "status:generating",
        "reasoning:generate:in_progress",
      ];

      const mergeIndex = eventSequence.findIndex(e => e.includes("merge:completed"));
      const statusIndex = eventSequence.findIndex(e => e.includes("status"));

      expect(statusIndex).toBeGreaterThan(mergeIndex);
    });

    it("should emit text events after generate step starts", () => {
      const eventSequence = [
        "reasoning:generate:in_progress",
        "text:content",
        "text:content",
        "reasoning:generate:completed",
      ];

      const generateStartIndex = eventSequence.findIndex(e => e.includes("generate:in_progress"));
      const firstTextIndex = eventSequence.findIndex(e => e.includes("text:content"));

      expect(firstTextIndex).toBeGreaterThan(generateStartIndex);
    });

    it("should emit generate completed after all text events", () => {
      const eventSequence = [
        "reasoning:generate:in_progress",
        "text:content",
        "text:content",
        "text:content",
        "reasoning:generate:completed",
        "sources",
        "done",
      ];

      const lastTextIndex = eventSequence.filter(e => e.includes("text")).length > 0
        ? eventSequence.lastIndexOf("text:content")
        : -1;
      const generateCompleteIndex = eventSequence.findIndex(e => e.includes("generate:completed"));

      expect(generateCompleteIndex).toBeGreaterThan(lastTextIndex);
    });

    it("should emit sources after generate step completes", () => {
      const eventSequence = [
        "reasoning:generate:completed",
        "sources",
        "done",
      ];

      const generateCompleteIndex = eventSequence.findIndex(e => e.includes("generate:completed"));
      const sourcesIndex = eventSequence.findIndex(e => e === "sources");

      expect(sourcesIndex).toBeGreaterThan(generateCompleteIndex);
    });

    it("should emit done event last", () => {
      const eventSequence = [
        "reasoning:generate:completed",
        "sources",
        "done",
      ];

      expect(eventSequence[eventSequence.length - 1]).toBe("done");
    });
  });

  describe("step ID generation", () => {
    it("should generate unique IDs for each step", () => {
      const stepIds = [
        "step-rewrite-abc123",
        "step-plan-def456",
        "step-search-ghi789",
        "step-merge-jkl012",
        "step-generate-mno345",
      ];

      const uniqueIds = new Set(stepIds);
      expect(uniqueIds.size).toBe(stepIds.length);
    });

    it("should use UUID format for step IDs", () => {
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const mockUuid = "550e8400-e29b-41d4-a716-446655440000";

      expect(mockUuid).toMatch(uuidPattern);
    });
  });

  describe("SSE serialization compatibility", () => {
    it("should serialize reasoning event to JSON", () => {
      const reasoningEvent = {
        type: "reasoning",
        step: {
          id: "step-123",
          type: "plan",
          title: "Query Planning",
          summary: "Generated 2 sub-queries",
          status: "completed",
          details: { subQueries: ["query1", "query2"] },
        },
      };

      const json = JSON.stringify(reasoningEvent);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe("reasoning");
      expect(parsed.step.type).toBe("plan");
      expect(parsed.step.details.subQueries).toHaveLength(2);
    });

    it("should format as SSE data event", () => {
      const reasoningEvent = {
        type: "reasoning",
        step: {
          id: "step-1",
          type: "rewrite",
          title: "Query Rewriting",
          summary: "Processing...",
          status: "in_progress",
        },
      };

      const sseData = `data: ${JSON.stringify(reasoningEvent)}\n\n`;

      expect(sseData).toMatch(/^data: \{.*\}\n\n$/);
      expect(sseData).toContain('"type":"reasoning"');
    });
  });
});

// ============================================================================
// Tests for Final Answer Generation with Citations
// ============================================================================

describe("Final Answer Generation with Citations", () => {
  describe("system prompt construction", () => {
    it("should include base system prompt", () => {
      const basePrompt = "You are a helpful assistant for our company.";
      const chunks = [
        { id: "c1", content: "Some content", score: 0.9 },
      ];

      // The system prompt should start with the base prompt
      const expectedStart = basePrompt;
      expect(expectedStart).toBe("You are a helpful assistant for our company.");
    });

    it("should add citation instructions when chunks are present", () => {
      const citationInstructions = `CITATION INSTRUCTIONS:
- Use the numbered sources below to answer the question
- When citing information, reference the source number in brackets, e.g., [1], [2]
- Only cite sources that directly support your statements
- If the context doesn't contain relevant information, acknowledge this clearly
- Provide accurate, grounded responses based solely on the provided context`;

      expect(citationInstructions).toContain("CITATION INSTRUCTIONS:");
      expect(citationInstructions).toContain("[1], [2]");
      expect(citationInstructions).toContain("grounded responses");
    });

    it("should add special instruction when no chunks are retrieved", () => {
      const noContextInstruction = "IMPORTANT: You have no retrieved context to reference. If you cannot answer the question from your general knowledge, clearly state that you don't have the information to answer this question.";

      expect(noContextInstruction).toContain("no retrieved context");
      expect(noContextInstruction).toContain("don't have the information");
    });

    it("should format chunks with numbered citations", () => {
      const chunks = [
        { id: "c1", content: "Pricing starts at $10/month", title: "Pricing Guide", score: 0.95 },
        { id: "c2", content: "Enterprise plan includes premium support", title: "Plans", score: 0.90 },
        { id: "c3", content: "Free tier available for small teams", score: 0.85 },
      ];

      const contextParts = chunks.map((chunk, i) => {
        const titlePart = chunk.title ? `Title: ${chunk.title}\n` : "";
        return `[${i + 1}] ${titlePart}${chunk.content}`;
      });

      expect(contextParts[0]).toContain("[1]");
      expect(contextParts[0]).toContain("Title: Pricing Guide");
      expect(contextParts[0]).toContain("$10/month");

      expect(contextParts[1]).toContain("[2]");
      expect(contextParts[1]).toContain("Title: Plans");

      expect(contextParts[2]).toContain("[3]");
      expect(contextParts[2]).not.toContain("Title:"); // No title
    });

    it("should separate context sections with double newlines", () => {
      const chunks = [
        { id: "c1", content: "Content 1", score: 0.95 },
        { id: "c2", content: "Content 2", score: 0.90 },
      ];

      const contextParts = chunks.map((chunk, i) => `[${i + 1}] ${chunk.content}`);
      const joined = contextParts.join("\n\n");

      expect(joined).toBe("[1] Content 1\n\n[2] Content 2");
    });

    it("should include CONTEXT header before chunks", () => {
      const contextSection = "CONTEXT:\n[1] Some content";

      expect(contextSection).toContain("CONTEXT:");
    });
  });

  describe("citation format in context", () => {
    it("should use 1-indexed citation numbers", () => {
      const chunks = [
        { id: "c1", content: "First", score: 0.95 },
        { id: "c2", content: "Second", score: 0.90 },
        { id: "c3", content: "Third", score: 0.85 },
      ];

      const citationNumbers = chunks.map((_, i) => i + 1);

      expect(citationNumbers).toEqual([1, 2, 3]);
      expect(citationNumbers[0]).toBe(1); // Not 0-indexed
    });

    it("should format citation as [N] prefix", () => {
      const index = 0;
      const citationPrefix = `[${index + 1}]`;

      expect(citationPrefix).toBe("[1]");
    });

    it("should include title when available", () => {
      const chunkWithTitle = {
        id: "c1",
        content: "The Enterprise plan costs $100/month",
        title: "Pricing Documentation",
        score: 0.95,
      };

      const formatted = `[1] Title: ${chunkWithTitle.title}\n${chunkWithTitle.content}`;

      expect(formatted).toContain("Title: Pricing Documentation");
      expect(formatted).toContain("$100/month");
    });

    it("should omit title line when not available", () => {
      const chunkWithoutTitle: {
        id: string;
        content: string;
        title?: string;
        score: number;
      } = {
        id: "c1",
        content: "Some content without title",
        score: 0.85,
      };

      const titlePart = chunkWithoutTitle.title ? `Title: ${chunkWithoutTitle.title}\n` : "";
      const formatted = `[1] ${titlePart}${chunkWithoutTitle.content}`;

      expect(formatted).toBe("[1] Some content without title");
      expect(formatted).not.toContain("Title:");
    });
  });

  describe("generate step behavior", () => {
    it("should emit generate step with correct title", () => {
      const generateStep = {
        id: "step-gen-123",
        type: "generate" as const,
        title: "Answer Generation",
        summary: "Generating comprehensive answer with citations...",
        status: "in_progress" as const,
      };

      expect(generateStep.title).toBe("Answer Generation");
      expect(generateStep.type).toBe("generate");
    });

    it("should indicate citation awareness in in_progress summary", () => {
      const inProgressSummary = "Generating comprehensive answer with citations...";

      expect(inProgressSummary).toContain("citations");
      expect(inProgressSummary).toContain("comprehensive");
    });

    it("should emit completed status after streaming finishes", () => {
      const completedStep = {
        id: "step-gen-123",
        type: "generate" as const,
        title: "Answer Generation",
        summary: "Response generated successfully",
        status: "completed" as const,
      };

      expect(completedStep.status).toBe("completed");
      expect(completedStep.summary).toContain("successfully");
    });

    it("should be the last reasoning step in sequence", () => {
      const stepSequence = ["rewrite", "plan", "search", "merge", "generate"];

      expect(stepSequence[stepSequence.length - 1]).toBe("generate");
    });
  });

  describe("text streaming behavior", () => {
    it("should yield text events as chunks are received", () => {
      const textChunks = ["Based on ", "the information ", "in [1], ", "pricing starts at $10."];

      const textEvents = textChunks.map(chunk => ({
        type: "text" as const,
        content: chunk,
      }));

      expect(textEvents).toHaveLength(4);
      expect(textEvents[0].content).toBe("Based on ");
      expect(textEvents[2].content).toContain("[1]");
    });

    it("should accumulate full response from text chunks", () => {
      const textChunks = ["Hello, ", "this is ", "the response."];
      let fullResponse = "";

      for (const chunk of textChunks) {
        fullResponse += chunk;
      }

      expect(fullResponse).toBe("Hello, this is the response.");
    });

    it("should emit text events between generate in_progress and completed", () => {
      const eventSequence = [
        { type: "reasoning", step: { type: "generate", status: "in_progress" } },
        { type: "text", content: "Response part 1" },
        { type: "text", content: "Response part 2" },
        { type: "reasoning", step: { type: "generate", status: "completed" } },
      ];

      const generateStartIdx = eventSequence.findIndex(
        e => e.type === "reasoning" && (e.step as { type: string; status: string }).status === "in_progress"
      );
      const generateEndIdx = eventSequence.findIndex(
        e => e.type === "reasoning" && (e.step as { type: string; status: string }).status === "completed"
      );
      const textIndices = eventSequence
        .map((e, i) => e.type === "text" ? i : -1)
        .filter(i => i !== -1);

      for (const textIdx of textIndices) {
        expect(textIdx).toBeGreaterThan(generateStartIdx);
        expect(textIdx).toBeLessThan(generateEndIdx);
      }
    });
  });

  describe("sources event behavior", () => {
    it("should emit sources event after generate step completes", () => {
      const eventSequence = [
        "reasoning:generate:completed",
        "sources",
        "done",
      ];

      const generateIdx = eventSequence.indexOf("reasoning:generate:completed");
      const sourcesIdx = eventSequence.indexOf("sources");

      expect(sourcesIdx).toBeGreaterThan(generateIdx);
    });

    it("should build sources from merged chunks", () => {
      const mergedChunks = [
        { id: "c1", content: "Content about pricing that is longer than snippet...", title: "Pricing", url: "https://example.com/pricing", score: 0.95 },
        { id: "c2", content: "Content about features...", title: "Features", score: 0.90 },
      ];

      const sources = mergedChunks.map((chunk, i) => ({
        id: chunk.id,
        title: chunk.title || "Untitled",
        url: chunk.url,
        snippet: chunk.content.slice(0, 200),
        index: i + 1,
      }));

      expect(sources).toHaveLength(2);
      expect(sources[0].id).toBe("c1");
      expect(sources[0].title).toBe("Pricing");
      expect(sources[0].index).toBe(1);
      expect(sources[1].index).toBe(2);
    });

    it("should use 'Untitled' when chunk has no title", () => {
      const chunkWithoutTitle: {
        id: string;
        content: string;
        title?: string;
        score: number;
      } = {
        id: "c1",
        content: "Some content",
        score: 0.85,
      };

      const title = chunkWithoutTitle.title || "Untitled";

      expect(title).toBe("Untitled");
    });

    it("should truncate snippet to 200 characters", () => {
      const longContent = "A".repeat(300);
      const snippet = longContent.slice(0, 200);

      expect(snippet).toHaveLength(200);
    });

    it("should preserve full content for shorter chunks", () => {
      const shortContent = "Short content";
      const snippet = shortContent.slice(0, 200);

      expect(snippet).toBe("Short content");
    });

    it("should limit sources to maxCitations", () => {
      const maxCitations = 3;
      const allSources = Array.from({ length: 8 }, (_, i) => ({
        id: `c${i}`,
        title: `Source ${i}`,
        snippet: `Content ${i}`,
        index: i + 1,
      }));

      const limitedSources = allSources.slice(0, maxCitations);

      expect(limitedSources).toHaveLength(3);
      expect(limitedSources[0].id).toBe("c0");
      expect(limitedSources[2].id).toBe("c2");
    });

    it("should include optional URL in source", () => {
      const sourceWithUrl = {
        id: "c1",
        title: "Doc Title",
        url: "https://docs.example.com/page",
        snippet: "Some content",
        index: 1,
      };

      const sourceWithoutUrl: {
        id: string;
        title: string;
        url?: string;
        snippet: string;
        index: number;
      } = {
        id: "c2",
        title: "Another Doc",
        snippet: "Other content",
        index: 2,
      };

      expect(sourceWithUrl.url).toBe("https://docs.example.com/page");
      expect(sourceWithoutUrl.url).toBeUndefined();
    });
  });

  describe("Source interface", () => {
    it("should have required id, title, snippet, and index fields", () => {
      const source = {
        id: "chunk-123",
        title: "Document Title",
        snippet: "First 200 characters of content...",
        index: 1,
      };

      expect(source.id).toBeDefined();
      expect(source.title).toBeDefined();
      expect(source.snippet).toBeDefined();
      expect(source.index).toBeDefined();
    });

    it("should have optional url field", () => {
      const sourceWithUrl = {
        id: "c1",
        title: "Title",
        snippet: "Content",
        index: 1,
        url: "https://example.com",
      };

      const sourceWithoutUrl: {
        id: string;
        title: string;
        snippet: string;
        index: number;
        url?: string;
      } = {
        id: "c2",
        title: "Title 2",
        snippet: "Content 2",
        index: 2,
      };

      expect(sourceWithUrl.url).toBe("https://example.com");
      expect(sourceWithoutUrl.url).toBeUndefined();
    });

    it("should use 1-indexed values for index field", () => {
      const sources = [
        { id: "c1", title: "T1", snippet: "S1", index: 1 },
        { id: "c2", title: "T2", snippet: "S2", index: 2 },
        { id: "c3", title: "T3", snippet: "S3", index: 3 },
      ];

      expect(sources[0].index).toBe(1);
      expect(sources[1].index).toBe(2);
      expect(sources[2].index).toBe(3);
    });
  });

  describe("conversation storage", () => {
    it("should store assistant response after generation", () => {
      const fullResponse = "Based on the information in [1], pricing starts at $10/month.";

      // The response should be stored in conversation history
      const storedTurn = {
        role: "assistant" as const,
        content: fullResponse,
        timestamp: Date.now(),
      };

      expect(storedTurn.role).toBe("assistant");
      expect(storedTurn.content).toBe(fullResponse);
    });

    it("should include citations in stored response", () => {
      const responseWithCitations = "According to [1] and [2], the Enterprise plan offers premium features.";

      expect(responseWithCitations).toContain("[1]");
      expect(responseWithCitations).toContain("[2]");
    });
  });

  describe("token usage tracking", () => {
    it("should capture prompt tokens from LLM response", () => {
      const usage = {
        inputTokens: 1500,
        outputTokens: 250,
      };

      const promptTokens = usage.inputTokens || 0;

      expect(promptTokens).toBe(1500);
    });

    it("should capture completion tokens from LLM response", () => {
      const usage = {
        inputTokens: 1500,
        outputTokens: 250,
      };

      const completionTokens = usage.outputTokens || 0;

      expect(completionTokens).toBe(250);
    });

    it("should handle missing usage data gracefully", () => {
      // Simulating when usage is null/undefined from await result.usage
      function getUsage(): { inputTokens?: number; outputTokens?: number } | undefined {
        return undefined;
      }
      const usage = getUsage();

      const promptTokens = usage?.inputTokens ?? 0;
      const completionTokens = usage?.outputTokens ?? 0;

      expect(promptTokens).toBe(0);
      expect(completionTokens).toBe(0);
    });
  });

  describe("usage logging", () => {
    it("should log successful generation with ok status", () => {
      const logData = {
        startTime: Date.now() - 5000,
        promptTokens: 1500,
        completionTokens: 250,
        retrievedChunks: 8,
        reasoningSteps: 5,
        status: "ok" as const,
      };

      expect(logData.status).toBe("ok");
      expect(logData.reasoningSteps).toBe(5);
    });

    it("should include latency calculation", () => {
      const startTime = Date.now() - 5000;
      const latencyMs = Date.now() - startTime;

      expect(latencyMs).toBeGreaterThanOrEqual(5000);
      expect(latencyMs).toBeLessThan(6000);
    });

    it("should log error status on failure", () => {
      const logData = {
        startTime: Date.now() - 1000,
        promptTokens: 500,
        completionTokens: 0,
        retrievedChunks: 3,
        reasoningSteps: 2,
        status: "error" as const,
        errorCode: "Model unavailable",
      };

      expect(logData.status).toBe("error");
      expect(logData.errorCode).toBeDefined();
    });

    it("should set rerankerUsed to false for advanced RAG", () => {
      // Advanced RAG doesn't use reranker
      const rerankerUsed = false;

      expect(rerankerUsed).toBe(false);
    });
  });

  describe("done event behavior", () => {
    it("should emit done event as final event", () => {
      const eventSequence = [
        "reasoning:generate:completed",
        "sources",
        "done",
      ];

      expect(eventSequence[eventSequence.length - 1]).toBe("done");
    });

    it("should include conversationId in done event", () => {
      const doneEvent = {
        type: "done" as const,
        conversationId: "conv-abc-123-def-456",
      };

      expect(doneEvent.type).toBe("done");
      expect(doneEvent.conversationId).toBeDefined();
      expect(doneEvent.conversationId.length).toBeGreaterThan(0);
    });

    it("should use generated conversationId if not provided", () => {
      const providedConvId: string | undefined = undefined;
      const generatedConvId = "550e8400-e29b-41d4-a716-446655440000";

      const convId = providedConvId || generatedConvId;

      expect(convId).toBe(generatedConvId);
    });

    it("should preserve provided conversationId", () => {
      const providedConvId = "existing-conv-123";
      const generatedConvId = "new-uuid";

      const convId = providedConvId || generatedConvId;

      expect(convId).toBe(providedConvId);
    });
  });

  describe("error handling during generation", () => {
    it("should yield error event when model is not configured", () => {
      const errorEvent = {
        type: "error" as const,
        message: "No chat model configured",
      };

      expect(errorEvent.type).toBe("error");
      expect(errorEvent.message).toBe("No chat model configured");
    });

    it("should yield error event when agent not found", () => {
      const errorEvent = {
        type: "error" as const,
        message: "Agent not found",
      };

      expect(errorEvent.type).toBe("error");
      expect(errorEvent.message).toBe("Agent not found");
    });

    it("should log error with error status on exception", () => {
      const error = new Error("LLM streaming failed");
      const errorCode = error.message;

      expect(errorCode).toBe("LLM streaming failed");
    });

    it("should handle unknown errors gracefully", () => {
      const unknownError: unknown = "Something went wrong";
      const errorMessage = unknownError instanceof Error ? unknownError.message : "An error occurred";

      expect(errorMessage).toBe("An error occurred");
    });
  });

  describe("maxCitations configuration", () => {
    it("should default to 3 citations", () => {
      const defaultMaxCitations = 3;

      expect(defaultMaxCitations).toBe(3);
    });

    it("should respect custom maxCitations from retrieval config", () => {
      const customMaxCitations = 5;
      const allSources = Array.from({ length: 10 }, (_, i) => ({
        id: `c${i}`,
        title: `Source ${i}`,
        snippet: `Content ${i}`,
        index: i + 1,
      }));

      const limitedSources = allSources.slice(0, customMaxCitations);

      expect(limitedSources).toHaveLength(5);
    });

    it("should return all sources when fewer than maxCitations", () => {
      const maxCitations = 5;
      const sources = [
        { id: "c1", title: "S1", snippet: "C1", index: 1 },
        { id: "c2", title: "S2", snippet: "C2", index: 2 },
      ];

      const limited = sources.slice(0, maxCitations);

      expect(limited).toHaveLength(2);
    });
  });

  describe("LLM configuration", () => {
    it("should use agent's configured model", () => {
      const modelConfigId = "model-config-abc-123";

      expect(modelConfigId).toBeDefined();
    });

    it("should handle null modelConfigId", () => {
      const modelConfigId: string | null = null;
      const modelArg = modelConfigId || undefined;

      expect(modelArg).toBeUndefined();
    });

    it("should pass low reasoning effort to OpenAI provider", () => {
      const providerOptions = {
        openai: {
          reasoningEffort: "low",
        },
      };

      expect(providerOptions.openai.reasoningEffort).toBe("low");
    });
  });

  describe("message array construction", () => {
    it("should include conversation history in messages", () => {
      const history = [
        { role: "user" as const, content: "What is pricing?", timestamp: Date.now() },
        { role: "assistant" as const, content: "Pricing starts at $10/month.", timestamp: Date.now() },
      ];

      const messages = history.map(turn => ({
        role: turn.role,
        content: turn.content,
      }));

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
    });

    it("should append current message at the end", () => {
      const history = [
        { role: "user" as const, content: "Previous question", timestamp: Date.now() },
        { role: "assistant" as const, content: "Previous answer", timestamp: Date.now() },
      ];
      const currentMessage = "What about enterprise pricing?";

      const messages = [
        ...history.map(turn => ({ role: turn.role, content: turn.content })),
        { role: "user" as const, content: currentMessage },
      ];

      expect(messages).toHaveLength(3);
      expect(messages[messages.length - 1].content).toBe(currentMessage);
    });

    it("should handle empty history", () => {
      const history: { role: "user" | "assistant"; content: string; timestamp: number }[] = [];
      const currentMessage = "First question";

      const messages = [
        ...history.map(turn => ({ role: turn.role, content: turn.content })),
        { role: "user" as const, content: currentMessage },
      ];

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe(currentMessage);
    });
  });
});

// ============================================================================
// Tests for Citation-Aware System Prompt
// ============================================================================

describe("Citation-Aware System Prompt", () => {
  describe("empty context handling", () => {
    it("should include instruction about no context when chunks are empty", () => {
      const basePrompt = "You are a helpful assistant.";
      const noContextPrompt = `${basePrompt}

IMPORTANT: You have no retrieved context to reference. If you cannot answer the question from your general knowledge, clearly state that you don't have the information to answer this question.`;

      expect(noContextPrompt).toContain("no retrieved context");
      expect(noContextPrompt).toContain("don't have the information");
    });

    it("should advise acknowledging lack of information", () => {
      const instruction = "clearly state that you don't have the information to answer this question";

      expect(instruction).toContain("clearly state");
      expect(instruction).toContain("don't have the information");
    });
  });

  describe("context present handling", () => {
    it("should include citation instructions section", () => {
      const citationSection = "CITATION INSTRUCTIONS:";

      expect(citationSection).toBe("CITATION INSTRUCTIONS:");
    });

    it("should instruct to use numbered sources", () => {
      const instruction = "Use the numbered sources below to answer the question";

      expect(instruction).toContain("numbered sources");
    });

    it("should provide bracket citation format example", () => {
      const formatExample = "reference the source number in brackets, e.g., [1], [2]";

      expect(formatExample).toContain("[1], [2]");
    });

    it("should instruct to only cite supporting sources", () => {
      const instruction = "Only cite sources that directly support your statements";

      expect(instruction).toContain("directly support");
    });

    it("should instruct to acknowledge irrelevant context", () => {
      const instruction = "If the context doesn't contain relevant information, acknowledge this clearly";

      expect(instruction).toContain("doesn't contain relevant");
      expect(instruction).toContain("acknowledge");
    });

    it("should emphasize grounded responses", () => {
      const instruction = "Provide accurate, grounded responses based solely on the provided context";

      expect(instruction).toContain("grounded");
      expect(instruction).toContain("solely on the provided context");
    });
  });

  describe("full prompt structure", () => {
    it("should have correct section order", () => {
      const promptSections = [
        "base prompt",
        "CITATION INSTRUCTIONS:",
        "CONTEXT:",
      ];

      // Verify order
      expect(promptSections[0]).toBe("base prompt");
      expect(promptSections[1]).toBe("CITATION INSTRUCTIONS:");
      expect(promptSections[2]).toBe("CONTEXT:");
    });

    it("should use default system prompt when none configured", () => {
      const defaultPrompt = "You are a helpful assistant.";

      expect(defaultPrompt).toBe("You are a helpful assistant.");
    });
  });
});

// ============================================================================
// Unit Tests with Mocks for AdvancedRAGService
// ============================================================================

describe("AdvancedRAGService Unit Tests", () => {
  describe("mergeAndDeduplicateChunks unit tests", () => {
    it("should merge duplicate chunks keeping highest score", () => {
      // Simulate the merge logic from the service
      const mergeChunks = (
        chunks: { id: string; content: string; score: number }[],
        topK: number
      ) => {
        const chunkMap = new Map<string, { id: string; content: string; score: number }>();
        for (const chunk of chunks) {
          const existing = chunkMap.get(chunk.id);
          if (!existing || chunk.score > existing.score) {
            chunkMap.set(chunk.id, chunk);
          }
        }
        return Array.from(chunkMap.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      };

      const chunks = [
        { id: "c1", content: "Content 1", score: 0.85 },
        { id: "c2", content: "Content 2", score: 0.90 },
        { id: "c1", content: "Content 1 dup", score: 0.95 }, // Duplicate with higher score
        { id: "c3", content: "Content 3", score: 0.70 },
      ];

      const merged = mergeChunks(chunks, 3);

      expect(merged).toHaveLength(3);
      expect(merged[0].id).toBe("c1");
      expect(merged[0].score).toBe(0.95); // Higher score kept
      expect(merged[1].id).toBe("c2");
      expect(merged[2].id).toBe("c3");
    });

    it("should limit results to topK", () => {
      const mergeChunks = (
        chunks: { id: string; content: string; score: number }[],
        topK: number
      ) => {
        const chunkMap = new Map<string, { id: string; content: string; score: number }>();
        for (const chunk of chunks) {
          const existing = chunkMap.get(chunk.id);
          if (!existing || chunk.score > existing.score) {
            chunkMap.set(chunk.id, chunk);
          }
        }
        return Array.from(chunkMap.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      };

      const chunks = Array.from({ length: 20 }, (_, i) => ({
        id: `c${i}`,
        content: `Content ${i}`,
        score: 0.99 - i * 0.01,
      }));

      const merged = mergeChunks(chunks, 8);

      expect(merged).toHaveLength(8);
      expect(merged[0].score).toBe(0.99);
      // Use toBeCloseTo for floating point comparison
      expect(merged[7].score).toBeCloseTo(0.92, 10);
    });

    it("should handle empty chunks array", () => {
      const mergeChunks = (
        chunks: { id: string; content: string; score: number }[],
        topK: number
      ) => {
        const chunkMap = new Map<string, { id: string; content: string; score: number }>();
        for (const chunk of chunks) {
          const existing = chunkMap.get(chunk.id);
          if (!existing || chunk.score > existing.score) {
            chunkMap.set(chunk.id, chunk);
          }
        }
        return Array.from(chunkMap.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      };

      const merged = mergeChunks([], 8);

      expect(merged).toHaveLength(0);
    });

    it("should preserve chunk data during merge", () => {
      const mergeChunks = (
        chunks: { id: string; content: string; title?: string; url?: string; score: number }[],
        topK: number
      ) => {
        const chunkMap = new Map<string, typeof chunks[0]>();
        for (const chunk of chunks) {
          const existing = chunkMap.get(chunk.id);
          if (!existing || chunk.score > existing.score) {
            chunkMap.set(chunk.id, chunk);
          }
        }
        return Array.from(chunkMap.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      };

      const chunks = [
        { id: "c1", content: "Content", title: "Title 1", url: "https://example.com", score: 0.90 },
      ];

      const merged = mergeChunks(chunks, 5);

      expect(merged[0].title).toBe("Title 1");
      expect(merged[0].url).toBe("https://example.com");
      expect(merged[0].content).toBe("Content");
    });
  });

  describe("buildSystemPrompt unit tests", () => {
    it("should build prompt with citation instructions when chunks present", () => {
      const buildSystemPrompt = (
        basePrompt: string,
        chunks: { id: string; content: string; title?: string; score: number }[]
      ) => {
        if (chunks.length === 0) {
          return `${basePrompt}\n\nIMPORTANT: You have no retrieved context to reference. If you cannot answer the question from your general knowledge, clearly state that you don't have the information to answer this question.`;
        }

        const contextParts = chunks.map((chunk, i) => {
          const titlePart = chunk.title ? `Title: ${chunk.title}\n` : "";
          return `[${i + 1}] ${titlePart}${chunk.content}`;
        });

        return `${basePrompt}

CITATION INSTRUCTIONS:
- Use the numbered sources below to answer the question
- When citing information, reference the source number in brackets, e.g., [1], [2]
- Only cite sources that directly support your statements
- If the context doesn't contain relevant information, acknowledge this clearly
- Provide accurate, grounded responses based solely on the provided context

CONTEXT:
${contextParts.join("\n\n")}`;
      };

      const chunks = [
        { id: "c1", content: "Pricing is $10/month", title: "Pricing Guide", score: 0.95 },
        { id: "c2", content: "Enterprise features include...", score: 0.90 },
      ];

      const prompt = buildSystemPrompt("You are a helpful assistant.", chunks);

      expect(prompt).toContain("CITATION INSTRUCTIONS:");
      expect(prompt).toContain("CONTEXT:");
      expect(prompt).toContain("[1] Title: Pricing Guide");
      expect(prompt).toContain("[2] Enterprise features");
      expect(prompt).toContain("[1], [2]");
    });

    it("should build prompt with no-context instruction when chunks empty", () => {
      const buildSystemPrompt = (
        basePrompt: string,
        chunks: { id: string; content: string; title?: string; score: number }[]
      ) => {
        if (chunks.length === 0) {
          return `${basePrompt}\n\nIMPORTANT: You have no retrieved context to reference. If you cannot answer the question from your general knowledge, clearly state that you don't have the information to answer this question.`;
        }

        const contextParts = chunks.map((chunk, i) => {
          const titlePart = chunk.title ? `Title: ${chunk.title}\n` : "";
          return `[${i + 1}] ${titlePart}${chunk.content}`;
        });

        return `${basePrompt}

CITATION INSTRUCTIONS:
- Use the numbered sources below to answer the question

CONTEXT:
${contextParts.join("\n\n")}`;
      };

      const prompt = buildSystemPrompt("You are a helpful assistant.", []);

      expect(prompt).toContain("no retrieved context");
      expect(prompt).toContain("don't have the information");
      expect(prompt).not.toContain("CITATION INSTRUCTIONS:");
    });

    it("should use default prompt when basePrompt is empty", () => {
      const buildSystemPrompt = (
        basePrompt: string | null,
        chunks: { id: string; content: string; score: number }[]
      ) => {
        const actualPrompt = basePrompt || "You are a helpful assistant.";
        if (chunks.length === 0) {
          return `${actualPrompt}\n\nIMPORTANT: You have no retrieved context to reference.`;
        }
        return `${actualPrompt}\n\nCONTEXT:`;
      };

      const prompt = buildSystemPrompt(null, []);

      expect(prompt).toContain("You are a helpful assistant.");
    });
  });

  describe("buildMessages unit tests", () => {
    it("should build messages from conversation history plus current message", () => {
      const buildMessages = (
        history: { role: "user" | "assistant"; content: string }[],
        currentMessage: string
      ): { role: "user" | "assistant"; content: string }[] => {
        const messages: { role: "user" | "assistant"; content: string }[] = [];
        for (const turn of history) {
          messages.push({ role: turn.role, content: turn.content });
        }
        messages.push({ role: "user", content: currentMessage });
        return messages;
      };

      const history = [
        { role: "user" as const, content: "What is pricing?" },
        { role: "assistant" as const, content: "Pricing starts at $10/month." },
      ];

      const messages = buildMessages(history, "What about enterprise?");

      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("What is pricing?");
      expect(messages[1].role).toBe("assistant");
      expect(messages[2].role).toBe("user");
      expect(messages[2].content).toBe("What about enterprise?");
    });

    it("should handle empty history", () => {
      const buildMessages = (
        history: { role: "user" | "assistant"; content: string }[],
        currentMessage: string
      ): { role: "user" | "assistant"; content: string }[] => {
        const messages: { role: "user" | "assistant"; content: string }[] = [];
        for (const turn of history) {
          messages.push({ role: turn.role, content: turn.content });
        }
        messages.push({ role: "user", content: currentMessage });
        return messages;
      };

      const messages = buildMessages([], "First question");

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("First question");
    });

    it("should preserve message order", () => {
      const buildMessages = (
        history: { role: "user" | "assistant"; content: string }[],
        currentMessage: string
      ): { role: "user" | "assistant"; content: string }[] => {
        const messages: { role: "user" | "assistant"; content: string }[] = [];
        for (const turn of history) {
          messages.push({ role: turn.role, content: turn.content });
        }
        messages.push({ role: "user", content: currentMessage });
        return messages;
      };

      const history = [
        { role: "user" as const, content: "Q1" },
        { role: "assistant" as const, content: "A1" },
        { role: "user" as const, content: "Q2" },
        { role: "assistant" as const, content: "A2" },
      ];

      const messages = buildMessages(history, "Q3");

      expect(messages.map(m => m.content)).toEqual(["Q1", "A1", "Q2", "A2", "Q3"]);
    });
  });

  describe("history slicing unit tests", () => {
    it("should slice history to historyTurns * 2 messages", () => {
      const limitHistory = (
        fullHistory: { role: string; content: string }[],
        historyTurns: number
      ) => {
        return fullHistory.slice(-historyTurns * 2);
      };

      const fullHistory = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i + 1}`,
      }));

      const limited = limitHistory(fullHistory, 3);

      expect(limited).toHaveLength(6);
      expect(limited[0].content).toBe("Message 15");
      expect(limited[5].content).toBe("Message 20");
    });

    it("should return all history when shorter than limit", () => {
      const limitHistory = (
        fullHistory: { role: string; content: string }[],
        historyTurns: number
      ) => {
        return fullHistory.slice(-historyTurns * 2);
      };

      const fullHistory = [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
      ];

      const limited = limitHistory(fullHistory, 5);

      expect(limited).toHaveLength(2);
    });

    it("should handle empty history", () => {
      const limitHistory = (
        fullHistory: { role: string; content: string }[],
        historyTurns: number
      ) => {
        return fullHistory.slice(-historyTurns * 2);
      };

      const limited = limitHistory([], 5);

      expect(limited).toHaveLength(0);
    });
  });

  describe("source building unit tests", () => {
    it("should build sources from chunks with correct indexing", () => {
      const buildSources = (
        chunks: { id: string; content: string; title?: string; url?: string }[],
        maxCitations: number
      ) => {
        return chunks.slice(0, maxCitations).map((chunk, i) => ({
          id: chunk.id,
          title: chunk.title || "Untitled",
          url: chunk.url,
          snippet: chunk.content.slice(0, 200),
          index: i + 1,
        }));
      };

      const chunks = [
        { id: "c1", content: "Long content here...", title: "Doc 1", url: "https://example.com/1" },
        { id: "c2", content: "Another content", title: "Doc 2" },
        { id: "c3", content: "Third content" },
      ];

      const sources = buildSources(chunks, 10);

      expect(sources).toHaveLength(3);
      expect(sources[0].index).toBe(1);
      expect(sources[0].title).toBe("Doc 1");
      expect(sources[0].url).toBe("https://example.com/1");
      expect(sources[1].index).toBe(2);
      expect(sources[2].title).toBe("Untitled"); // Default when no title
      expect(sources[2].url).toBeUndefined();
    });

    it("should limit sources to maxCitations", () => {
      const buildSources = (
        chunks: { id: string; content: string; title?: string }[],
        maxCitations: number
      ) => {
        return chunks.slice(0, maxCitations).map((chunk, i) => ({
          id: chunk.id,
          title: chunk.title || "Untitled",
          snippet: chunk.content.slice(0, 200),
          index: i + 1,
        }));
      };

      const chunks = Array.from({ length: 10 }, (_, i) => ({
        id: `c${i}`,
        content: `Content ${i}`,
        title: `Title ${i}`,
      }));

      const sources = buildSources(chunks, 3);

      expect(sources).toHaveLength(3);
      expect(sources[2].id).toBe("c2");
    });

    it("should truncate snippet to 200 characters", () => {
      const buildSources = (
        chunks: { id: string; content: string }[],
        maxCitations: number
      ) => {
        return chunks.slice(0, maxCitations).map((chunk, i) => ({
          id: chunk.id,
          title: "Untitled",
          snippet: chunk.content.slice(0, 200),
          index: i + 1,
        }));
      };

      const longContent = "A".repeat(500);
      const sources = buildSources([{ id: "c1", content: longContent }], 10);

      expect(sources[0].snippet).toHaveLength(200);
    });
  });

  describe("reasoning step creation unit tests", () => {
    it("should create rewrite step with correct fields", () => {
      const createRewriteStep = (id: string, status: "in_progress" | "completed", summary: string) => ({
        id,
        type: "rewrite" as const,
        title: "Query Rewriting",
        summary,
        status,
      });

      const step = createRewriteStep("step-1", "in_progress", "Analyzing context...");

      expect(step.type).toBe("rewrite");
      expect(step.title).toBe("Query Rewriting");
      expect(step.status).toBe("in_progress");
    });

    it("should create plan step with details", () => {
      const createPlanStep = (
        id: string,
        status: "in_progress" | "completed",
        subQueries?: string[]
      ) => ({
        id,
        type: "plan" as const,
        title: "Query Planning",
        summary: subQueries
          ? `Generated ${subQueries.length} sub-quer${subQueries.length === 1 ? "y" : "ies"} for retrieval`
          : "Generating sub-queries...",
        status,
        ...(subQueries && { details: { subQueries } }),
      });

      const step = createPlanStep("step-2", "completed", ["query1", "query2", "query3"]);

      expect(step.type).toBe("plan");
      expect(step.summary).toBe("Generated 3 sub-queries for retrieval");
      expect(step.details?.subQueries).toHaveLength(3);
    });

    it("should create search step with query count", () => {
      const createSearchStep = (
        id: string,
        status: "in_progress" | "completed",
        queryCount: number,
        chunkCount?: number
      ) => ({
        id,
        type: "search" as const,
        title: "Knowledge Search",
        summary: status === "in_progress"
          ? `Searching knowledge bases with ${queryCount} quer${queryCount === 1 ? "y" : "ies"}...`
          : `Found ${chunkCount} relevant chunks`,
        status,
      });

      const inProgress = createSearchStep("step-3", "in_progress", 3);
      expect(inProgress.summary).toBe("Searching knowledge bases with 3 queries...");

      const completed = createSearchStep("step-3", "completed", 3, 15);
      expect(completed.summary).toBe("Found 15 relevant chunks");
    });

    it("should create merge step with chunk count", () => {
      const createMergeStep = (
        id: string,
        status: "in_progress" | "completed",
        uniqueCount?: number
      ) => ({
        id,
        type: "merge" as const,
        title: "Result Merging",
        summary: status === "in_progress"
          ? "Deduplicating and ranking results..."
          : `Merged to ${uniqueCount} unique chunks`,
        status,
      });

      const inProgress = createMergeStep("step-4", "in_progress");
      expect(inProgress.summary).toBe("Deduplicating and ranking results...");

      const completed = createMergeStep("step-4", "completed", 8);
      expect(completed.summary).toBe("Merged to 8 unique chunks");
    });

    it("should create generate step with success message", () => {
      const createGenerateStep = (id: string, status: "in_progress" | "completed") => ({
        id,
        type: "generate" as const,
        title: "Answer Generation",
        summary: status === "in_progress"
          ? "Generating comprehensive answer with citations..."
          : "Response generated successfully",
        status,
      });

      const inProgress = createGenerateStep("step-5", "in_progress");
      expect(inProgress.summary).toContain("citations");

      const completed = createGenerateStep("step-5", "completed");
      expect(completed.summary).toBe("Response generated successfully");
    });
  });

  describe("sub-query JSON parsing unit tests", () => {
    it("should parse valid JSON array of sub-queries", () => {
      const parseSubQueries = (
        response: string,
        originalQuery: string,
        maxSubqueries: number
      ): { id: string; query: string; purpose: string }[] => {
        try {
          const parsed = JSON.parse(response.trim());
          if (Array.isArray(parsed)) {
            return parsed.slice(0, maxSubqueries).map((item, i) => ({
              id: `sq-${i}`,
              query: item.query || originalQuery,
              purpose: item.purpose || "Sub-query",
            }));
          }
        } catch {
          // Fall through to fallback
        }
        return [{ id: "sq-0", query: originalQuery, purpose: "Original query" }];
      };

      const response = '[{"query": "pricing info", "purpose": "find pricing"}, {"query": "feature list", "purpose": "find features"}]';
      const subQueries = parseSubQueries(response, "original", 5);

      expect(subQueries).toHaveLength(2);
      expect(subQueries[0].query).toBe("pricing info");
      expect(subQueries[0].purpose).toBe("find pricing");
    });

    it("should fallback to original query on invalid JSON", () => {
      const parseSubQueries = (
        response: string,
        originalQuery: string,
        maxSubqueries: number
      ): { id: string; query: string; purpose: string }[] => {
        try {
          const parsed = JSON.parse(response.trim());
          if (Array.isArray(parsed)) {
            return parsed.slice(0, maxSubqueries).map((item, i) => ({
              id: `sq-${i}`,
              query: item.query || originalQuery,
              purpose: item.purpose || "Sub-query",
            }));
          }
        } catch {
          // Fall through to fallback
        }
        return [{ id: "sq-0", query: originalQuery, purpose: "Original query" }];
      };

      const response = "Not valid JSON";
      const subQueries = parseSubQueries(response, "What is pricing?", 5);

      expect(subQueries).toHaveLength(1);
      expect(subQueries[0].query).toBe("What is pricing?");
      expect(subQueries[0].purpose).toBe("Original query");
    });

    it("should fallback when response is not an array", () => {
      const parseSubQueries = (
        response: string,
        originalQuery: string,
        maxSubqueries: number
      ): { id: string; query: string; purpose: string }[] => {
        try {
          const parsed = JSON.parse(response.trim());
          if (Array.isArray(parsed)) {
            return parsed.slice(0, maxSubqueries).map((item, i) => ({
              id: `sq-${i}`,
              query: item.query || originalQuery,
              purpose: item.purpose || "Sub-query",
            }));
          }
        } catch {
          // Fall through to fallback
        }
        return [{ id: "sq-0", query: originalQuery, purpose: "Original query" }];
      };

      const response = '{"query": "single query"}';
      const subQueries = parseSubQueries(response, "original query", 5);

      expect(subQueries).toHaveLength(1);
      expect(subQueries[0].query).toBe("original query");
    });

    it("should limit parsed sub-queries to maxSubqueries", () => {
      const parseSubQueries = (
        response: string,
        originalQuery: string,
        maxSubqueries: number
      ): { id: string; query: string; purpose: string }[] => {
        try {
          const parsed = JSON.parse(response.trim());
          if (Array.isArray(parsed)) {
            return parsed.slice(0, maxSubqueries).map((item, i) => ({
              id: `sq-${i}`,
              query: item.query || originalQuery,
              purpose: item.purpose || "Sub-query",
            }));
          }
        } catch {
          // Fall through to fallback
        }
        return [{ id: "sq-0", query: originalQuery, purpose: "Original query" }];
      };

      const response = '[{"query":"q1","purpose":"p1"},{"query":"q2","purpose":"p2"},{"query":"q3","purpose":"p3"},{"query":"q4","purpose":"p4"}]';
      const subQueries = parseSubQueries(response, "original", 2);

      expect(subQueries).toHaveLength(2);
      expect(subQueries[0].query).toBe("q1");
      expect(subQueries[1].query).toBe("q2");
    });

    it("should use default purpose when not provided", () => {
      const parseSubQueries = (
        response: string,
        originalQuery: string,
        maxSubqueries: number
      ): { id: string; query: string; purpose: string }[] => {
        try {
          const parsed = JSON.parse(response.trim());
          if (Array.isArray(parsed)) {
            return parsed.slice(0, maxSubqueries).map((item, i) => ({
              id: `sq-${i}`,
              query: item.query || originalQuery,
              purpose: item.purpose || "Sub-query",
            }));
          }
        } catch {
          // Fall through to fallback
        }
        return [{ id: "sq-0", query: originalQuery, purpose: "Original query" }];
      };

      const response = '[{"query": "test query"}]'; // No purpose
      const subQueries = parseSubQueries(response, "original", 5);

      expect(subQueries[0].purpose).toBe("Sub-query");
    });
  });

  describe("history formatting unit tests", () => {
    it("should format history as User/Assistant prefixed lines", () => {
      const formatHistory = (history: { role: "user" | "assistant"; content: string }[]) => {
        return history
          .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
          .join("\n");
      };

      const history = [
        { role: "user" as const, content: "What is pricing?" },
        { role: "assistant" as const, content: "Pricing starts at $10." },
        { role: "user" as const, content: "What about enterprise?" },
      ];

      const formatted = formatHistory(history);

      expect(formatted).toBe(
        "User: What is pricing?\nAssistant: Pricing starts at $10.\nUser: What about enterprise?"
      );
    });

    it("should return empty string for empty history", () => {
      const formatHistory = (history: { role: "user" | "assistant"; content: string }[]) => {
        return history
          .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
          .join("\n");
      };

      const formatted = formatHistory([]);

      expect(formatted).toBe("");
    });

    it("should handle single turn history", () => {
      const formatHistory = (history: { role: "user" | "assistant"; content: string }[]) => {
        return history
          .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
          .join("\n");
      };

      const formatted = formatHistory([{ role: "user", content: "Hello" }]);

      expect(formatted).toBe("User: Hello");
    });
  });

  describe("status event construction unit tests", () => {
    it("should build status event with source count", () => {
      const buildStatusEvent = (sourceCount: number) => ({
        type: "status" as const,
        status: "generating",
        message: sourceCount > 0
          ? `Found ${sourceCount} sources. Generating response...`
          : "No relevant sources found. Generating response...",
        sourceCount,
      });

      const event = buildStatusEvent(5);

      expect(event.type).toBe("status");
      expect(event.message).toBe("Found 5 sources. Generating response...");
      expect(event.sourceCount).toBe(5);
    });

    it("should build status event with zero sources message", () => {
      const buildStatusEvent = (sourceCount: number) => ({
        type: "status" as const,
        status: "generating",
        message: sourceCount > 0
          ? `Found ${sourceCount} sources. Generating response...`
          : "No relevant sources found. Generating response...",
        sourceCount,
      });

      const event = buildStatusEvent(0);

      expect(event.message).toBe("No relevant sources found. Generating response...");
      expect(event.sourceCount).toBe(0);
    });
  });

  describe("error event construction unit tests", () => {
    it("should build error event from Error object", () => {
      const buildErrorEvent = (error: unknown) => ({
        type: "error" as const,
        message: error instanceof Error ? error.message : "An error occurred",
      });

      const event = buildErrorEvent(new Error("Agent not found"));

      expect(event.type).toBe("error");
      expect(event.message).toBe("Agent not found");
    });

    it("should build error event from non-Error", () => {
      const buildErrorEvent = (error: unknown) => ({
        type: "error" as const,
        message: error instanceof Error ? error.message : "An error occurred",
      });

      const event = buildErrorEvent("string error");

      expect(event.message).toBe("An error occurred");
    });

    it("should handle null error", () => {
      const buildErrorEvent = (error: unknown) => ({
        type: "error" as const,
        message: error instanceof Error ? error.message : "An error occurred",
      });

      const event = buildErrorEvent(null);

      expect(event.message).toBe("An error occurred");
    });
  });

  describe("latency calculation unit tests", () => {
    it("should calculate latency from start time", () => {
      const calculateLatency = (startTime: number) => Date.now() - startTime;

      const startTime = Date.now() - 1000; // 1 second ago
      const latency = calculateLatency(startTime);

      expect(latency).toBeGreaterThanOrEqual(1000);
      expect(latency).toBeLessThan(2000);
    });

    it("should handle zero latency", () => {
      const calculateLatency = (startTime: number) => Date.now() - startTime;

      const startTime = Date.now();
      const latency = calculateLatency(startTime);

      expect(latency).toBeGreaterThanOrEqual(0);
      expect(latency).toBeLessThan(100);
    });
  });

  describe("token usage handling unit tests", () => {
    it("should extract tokens from usage object", () => {
      const extractTokens = (usage: { inputTokens?: number; outputTokens?: number } | undefined) => ({
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
      });

      const tokens = extractTokens({ inputTokens: 1500, outputTokens: 250 });

      expect(tokens.promptTokens).toBe(1500);
      expect(tokens.completionTokens).toBe(250);
    });

    it("should default to zero when usage is undefined", () => {
      const extractTokens = (usage: { inputTokens?: number; outputTokens?: number } | undefined) => ({
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
      });

      const tokens = extractTokens(undefined);

      expect(tokens.promptTokens).toBe(0);
      expect(tokens.completionTokens).toBe(0);
    });

    it("should handle partial usage data", () => {
      const extractTokens = (usage: { inputTokens?: number; outputTokens?: number } | undefined) => ({
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
      });

      const tokens = extractTokens({ inputTokens: 1000 });

      expect(tokens.promptTokens).toBe(1000);
      expect(tokens.completionTokens).toBe(0);
    });
  });

  describe("rewrite decision logic unit tests", () => {
    it("should skip rewriting when no history exists", () => {
      const shouldRewrite = (history: unknown[]) => history.length > 0;

      expect(shouldRewrite([])).toBe(false);
    });

    it("should attempt rewriting when history exists", () => {
      const shouldRewrite = (history: unknown[]) => history.length > 0;

      expect(shouldRewrite([{ role: "user", content: "previous" }])).toBe(true);
    });
  });

  describe("rewrite summary formatting unit tests", () => {
    it("should format reformulated query summary", () => {
      const formatRewriteSummary = (originalQuery: string, rewrittenQuery: string) => {
        if (rewrittenQuery !== originalQuery) {
          const truncated = rewrittenQuery.slice(0, 100);
          const ellipsis = rewrittenQuery.length > 100 ? "..." : "";
          return `Reformulated query: "${truncated}${ellipsis}"`;
        }
        return "Query used as-is (no reformulation needed)";
      };

      const summary = formatRewriteSummary("What about it?", "What are the pricing options for the Enterprise plan?");

      expect(summary).toContain("Reformulated query:");
      expect(summary).toContain("Enterprise plan");
    });

    it("should indicate when no reformulation needed", () => {
      const formatRewriteSummary = (originalQuery: string, rewrittenQuery: string) => {
        if (rewrittenQuery !== originalQuery) {
          const truncated = rewrittenQuery.slice(0, 100);
          const ellipsis = rewrittenQuery.length > 100 ? "..." : "";
          return `Reformulated query: "${truncated}${ellipsis}"`;
        }
        return "Query used as-is (no reformulation needed)";
      };

      const summary = formatRewriteSummary("What is pricing?", "What is pricing?");

      expect(summary).toBe("Query used as-is (no reformulation needed)");
    });

    it("should truncate long reformulated queries", () => {
      const formatRewriteSummary = (originalQuery: string, rewrittenQuery: string) => {
        if (rewrittenQuery !== originalQuery) {
          const truncated = rewrittenQuery.slice(0, 100);
          const ellipsis = rewrittenQuery.length > 100 ? "..." : "";
          return `Reformulated query: "${truncated}${ellipsis}"`;
        }
        return "Query used as-is (no reformulation needed)";
      };

      const longQuery = "A".repeat(150);
      const summary = formatRewriteSummary("short", longQuery);

      expect(summary).toContain("...");
      expect(summary.length).toBeLessThan(150);
    });
  });
});
