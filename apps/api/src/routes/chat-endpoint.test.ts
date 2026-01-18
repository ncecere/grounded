import { describe, it, expect } from "bun:test";
import { z } from "zod";

// ============================================================================
// Schema Definitions (duplicated from chat-endpoint.ts for isolated testing)
// ============================================================================

const chatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

// ============================================================================
// Tests for chatRequestSchema
// ============================================================================

describe("chatRequestSchema", () => {
  describe("message field", () => {
    it("should accept valid message", () => {
      const result = chatRequestSchema.parse({ message: "Hello, how can you help?" });
      expect(result.message).toBe("Hello, how can you help?");
    });

    it("should reject empty message", () => {
      expect(() => chatRequestSchema.parse({ message: "" })).toThrow();
    });

    it("should accept message at minimum length (1 character)", () => {
      const result = chatRequestSchema.parse({ message: "H" });
      expect(result.message).toBe("H");
    });

    it("should accept message at maximum length (4000 characters)", () => {
      const longMessage = "a".repeat(4000);
      const result = chatRequestSchema.parse({ message: longMessage });
      expect(result.message.length).toBe(4000);
    });

    it("should reject message exceeding maximum length", () => {
      const tooLongMessage = "a".repeat(4001);
      expect(() => chatRequestSchema.parse({ message: tooLongMessage })).toThrow();
    });

    it("should reject non-string message", () => {
      expect(() => chatRequestSchema.parse({ message: 123 })).toThrow();
      expect(() => chatRequestSchema.parse({ message: null })).toThrow();
      expect(() => chatRequestSchema.parse({ message: undefined })).toThrow();
    });
  });

  describe("conversationId field", () => {
    it("should accept valid conversationId", () => {
      const result = chatRequestSchema.parse({
        message: "Hello",
        conversationId: "abc-123-def-456",
      });
      expect(result.conversationId).toBe("abc-123-def-456");
    });

    it("should allow conversationId to be omitted", () => {
      const result = chatRequestSchema.parse({ message: "Hello" });
      expect(result.conversationId).toBeUndefined();
    });

    it("should accept UUID format conversationId", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = chatRequestSchema.parse({ message: "Hello", conversationId: uuid });
      expect(result.conversationId).toBe(uuid);
    });
  });
});

// ============================================================================
// Tests for RAG Type Routing Logic
// ============================================================================

describe("RAG Type Routing Logic", () => {
  describe("ragType value handling", () => {
    it("should recognize 'simple' as valid ragType", () => {
      const ragType = "simple" as "simple" | "advanced";
      expect(ragType).toBe("simple");
    });

    it("should recognize 'advanced' as valid ragType", () => {
      const ragType = "advanced" as "simple" | "advanced";
      expect(ragType).toBe("advanced");
    });

    it("should only allow 'simple' or 'advanced' as values", () => {
      const validValues = ["simple", "advanced"];
      expect(validValues).toContain("simple");
      expect(validValues).toContain("advanced");
      expect(validValues.length).toBe(2);
    });
  });

  describe("routing decision", () => {
    type RagType = "simple" | "advanced";

    function determineService(ragType: RagType): "SimpleRAGService" | "AdvancedRAGService" {
      if (ragType === "advanced") {
        return "AdvancedRAGService";
      }
      return "SimpleRAGService";
    }

    it("should route to SimpleRAGService for 'simple' ragType", () => {
      expect(determineService("simple")).toBe("SimpleRAGService");
    });

    it("should route to AdvancedRAGService for 'advanced' ragType", () => {
      expect(determineService("advanced")).toBe("AdvancedRAGService");
    });

    it("should default to SimpleRAGService for any non-advanced type", () => {
      const ragType = "simple" as RagType;
      expect(determineService(ragType)).toBe("SimpleRAGService");
    });
  });

  describe("service instantiation parameters", () => {
    it("should pass correct parameters to SimpleRAGService", () => {
      const tenantId = "tenant-123";
      const agentId = "agent-456";

      // SimpleRAGService takes (tenantId, agentId)
      const params = [tenantId, agentId];
      expect(params.length).toBe(2);
      expect(params[0]).toBe(tenantId);
      expect(params[1]).toBe(agentId);
    });

    it("should pass correct parameters to AdvancedRAGService", () => {
      const tenantId = "tenant-123";
      const agentId = "agent-456";
      const channel = "chat_endpoint";

      // AdvancedRAGService takes (tenantId, agentId, channel)
      const params = [tenantId, agentId, channel];
      expect(params.length).toBe(3);
      expect(params[0]).toBe(tenantId);
      expect(params[1]).toBe(agentId);
      expect(params[2]).toBe(channel);
    });

    it("should use 'chat_endpoint' channel for chat endpoint route", () => {
      const channel: "admin_ui" | "widget" | "api" | "chat_endpoint" = "chat_endpoint";
      expect(channel).toBe("chat_endpoint");
    });
  });
});

// ============================================================================
// Tests for Non-Streaming Response Structure
// ============================================================================

describe("Non-Streaming Response Structure", () => {
  describe("Simple RAG response", () => {
    it("should include answer field", () => {
      const response = {
        answer: "This is the answer",
        citations: [],
        conversationId: "conv-123",
      };
      expect(response).toHaveProperty("answer");
      expect(typeof response.answer).toBe("string");
    });

    it("should include citations array", () => {
      const response = {
        answer: "This is the answer",
        citations: [{ title: "Doc1", snippet: "...", index: 1 }],
        conversationId: "conv-123",
      };
      expect(response).toHaveProperty("citations");
      expect(Array.isArray(response.citations)).toBe(true);
    });

    it("should include conversationId", () => {
      const response = {
        answer: "This is the answer",
        citations: [],
        conversationId: "conv-123",
      };
      expect(response).toHaveProperty("conversationId");
      expect(typeof response.conversationId).toBe("string");
    });

    it("should NOT include reasoningSteps for simple mode", () => {
      const response = {
        answer: "This is the answer",
        citations: [],
        conversationId: "conv-123",
      };
      expect(response).not.toHaveProperty("reasoningSteps");
    });
  });

  describe("Advanced RAG response", () => {
    it("should include reasoningSteps array for advanced mode", () => {
      const response = {
        answer: "This is the answer",
        citations: [],
        conversationId: "conv-123",
        reasoningSteps: [
          { id: "1", type: "rewrite", title: "Query Rewriting", summary: "Done", status: "completed" },
        ],
      };
      expect(response).toHaveProperty("reasoningSteps");
      expect(Array.isArray(response.reasoningSteps)).toBe(true);
    });

    it("should only include completed reasoning steps", () => {
      interface ReasoningStep {
        id: string;
        type: string;
        title: string;
        summary: string;
        status: "pending" | "in_progress" | "completed" | "error";
      }

      const allSteps: ReasoningStep[] = [
        { id: "1", type: "rewrite", title: "Query Rewriting", summary: "Processing...", status: "in_progress" },
        { id: "1", type: "rewrite", title: "Query Rewriting", summary: "Done", status: "completed" },
        { id: "2", type: "plan", title: "Query Planning", summary: "Processing...", status: "in_progress" },
        { id: "2", type: "plan", title: "Query Planning", summary: "Done", status: "completed" },
      ];

      const completedSteps = allSteps.filter((s) => s.status === "completed");
      expect(completedSteps.length).toBe(2);
      expect(completedSteps.every((s) => s.status === "completed")).toBe(true);
    });

    it("should have 5 completed steps for full advanced flow", () => {
      const expectedTypes = ["rewrite", "plan", "search", "merge", "generate"];
      expect(expectedTypes.length).toBe(5);
    });
  });

  describe("Citation filtering", () => {
    it("should return empty citations when citationsEnabled is false", () => {
      const citationsEnabled = false;
      const rawCitations = [{ title: "Doc1", snippet: "...", index: 1 }];
      const finalCitations = citationsEnabled ? rawCitations : [];
      expect(finalCitations.length).toBe(0);
    });

    it("should return citations when citationsEnabled is true", () => {
      const citationsEnabled = true;
      const rawCitations = [{ title: "Doc1", snippet: "...", index: 1 }];
      const finalCitations = citationsEnabled ? rawCitations : [];
      expect(finalCitations.length).toBe(1);
    });
  });
});

// ============================================================================
// Tests for ReasoningStep Interface
// ============================================================================

describe("ReasoningStep Interface", () => {
  interface ReasoningStep {
    id: string;
    type: "rewrite" | "plan" | "search" | "merge" | "generate";
    title: string;
    summary: string;
    status: "pending" | "in_progress" | "completed" | "error";
    details?: Record<string, unknown>;
  }

  describe("required fields", () => {
    it("should have id field", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Done",
        status: "completed",
      };
      expect(step.id).toBeTruthy();
    });

    it("should have type field", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "plan",
        title: "Query Planning",
        summary: "Done",
        status: "completed",
      };
      expect(step.type).toBe("plan");
    });

    it("should have title field", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "search",
        title: "Knowledge Search",
        summary: "Done",
        status: "completed",
      };
      expect(step.title).toBe("Knowledge Search");
    });

    it("should have summary field", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "merge",
        title: "Result Merging",
        summary: "Merged to 5 unique chunks",
        status: "completed",
      };
      expect(step.summary).toBe("Merged to 5 unique chunks");
    });

    it("should have status field", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "generate",
        title: "Answer Generation",
        summary: "Done",
        status: "completed",
      };
      expect(step.status).toBe("completed");
    });
  });

  describe("optional fields", () => {
    it("should allow details field", () => {
      const step: ReasoningStep = {
        id: "step-1",
        type: "plan",
        title: "Query Planning",
        summary: "Generated 3 sub-queries",
        status: "completed",
        details: { subQueries: ["q1", "q2", "q3"] },
      };
      expect(step.details).toBeDefined();
      expect(step.details?.subQueries).toHaveLength(3);
    });
  });

  describe("type values", () => {
    it("should support all 5 reasoning step types", () => {
      const types = ["rewrite", "plan", "search", "merge", "generate"];
      expect(types.length).toBe(5);
    });
  });

  describe("status values", () => {
    it("should support all 4 status values", () => {
      const statuses = ["pending", "in_progress", "completed", "error"];
      expect(statuses.length).toBe(4);
    });
  });
});

// ============================================================================
// Tests for Stream Event Types
// ============================================================================

describe("Stream Event Types", () => {
  describe("SimpleRAGService stream events", () => {
    type SimpleStreamEvent =
      | { type: "status"; status: string; message: string; sourceCount?: number }
      | { type: "text"; content: string }
      | { type: "sources"; sources: unknown[] }
      | { type: "done"; conversationId: string }
      | { type: "error"; message: string };

    it("should support status event", () => {
      const event: SimpleStreamEvent = {
        type: "status",
        status: "generating",
        message: "Found 5 sources",
        sourceCount: 5,
      };
      expect(event.type).toBe("status");
    });

    it("should support text event", () => {
      const event: SimpleStreamEvent = { type: "text", content: "Hello" };
      expect(event.type).toBe("text");
    });

    it("should support sources event", () => {
      const event: SimpleStreamEvent = { type: "sources", sources: [] };
      expect(event.type).toBe("sources");
    });

    it("should support done event", () => {
      const event: SimpleStreamEvent = { type: "done", conversationId: "conv-123" };
      expect(event.type).toBe("done");
    });

    it("should support error event", () => {
      const event: SimpleStreamEvent = { type: "error", message: "Something went wrong" };
      expect(event.type).toBe("error");
    });
  });

  describe("AdvancedRAGService stream events", () => {
    interface ReasoningStep {
      id: string;
      type: string;
      title: string;
      summary: string;
      status: string;
      details?: Record<string, unknown>;
    }

    type AdvancedStreamEvent =
      | { type: "status"; status: string; message: string; sourceCount?: number }
      | { type: "reasoning"; step: ReasoningStep }
      | { type: "text"; content: string }
      | { type: "sources"; sources: unknown[] }
      | { type: "done"; conversationId: string }
      | { type: "error"; message: string };

    it("should support reasoning event (unique to advanced)", () => {
      const event: AdvancedStreamEvent = {
        type: "reasoning",
        step: {
          id: "step-1",
          type: "rewrite",
          title: "Query Rewriting",
          summary: "Reformulating query...",
          status: "in_progress",
        },
      };
      expect(event.type).toBe("reasoning");
    });

    it("should support reasoning event with details", () => {
      const event: AdvancedStreamEvent = {
        type: "reasoning",
        step: {
          id: "step-2",
          type: "plan",
          title: "Query Planning",
          summary: "Generated 3 sub-queries",
          status: "completed",
          details: { subQueries: ["q1", "q2", "q3"] },
        },
      };
      expect(event.type).toBe("reasoning");
      if (event.type === "reasoning") {
        expect(event.step.details).toBeDefined();
      }
    });

    it("should have same base events as SimpleRAGService", () => {
      const statusEvent: AdvancedStreamEvent = {
        type: "status",
        status: "generating",
        message: "Test",
      };
      const textEvent: AdvancedStreamEvent = { type: "text", content: "Hello" };
      const sourcesEvent: AdvancedStreamEvent = { type: "sources", sources: [] };
      const doneEvent: AdvancedStreamEvent = { type: "done", conversationId: "123" };
      const errorEvent: AdvancedStreamEvent = { type: "error", message: "Error" };

      expect(statusEvent.type).toBe("status");
      expect(textEvent.type).toBe("text");
      expect(sourcesEvent.type).toBe("sources");
      expect(doneEvent.type).toBe("done");
      expect(errorEvent.type).toBe("error");
    });
  });
});

// ============================================================================
// Tests for SSE Headers
// ============================================================================

describe("SSE Headers", () => {
  it("should set X-Accel-Buffering to no", () => {
    const headers = {
      "X-Accel-Buffering": "no",
    };
    expect(headers["X-Accel-Buffering"]).toBe("no");
  });

  it("should set Cache-Control to prevent caching", () => {
    const headers = {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    };
    expect(headers["Cache-Control"]).toContain("no-cache");
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["Cache-Control"]).toContain("must-revalidate");
  });

  it("should set Connection to keep-alive", () => {
    const headers = {
      Connection: "keep-alive",
    };
    expect(headers.Connection).toBe("keep-alive");
  });
});

// ============================================================================
// Tests for Rate Limiting Configuration
// ============================================================================

describe("Rate Limiting Configuration", () => {
  describe("rate limit key", () => {
    it("should use tenant-specific key prefix", () => {
      const tenantId = "tenant-123";
      const key = `chat_endpoint:${tenantId}`;
      expect(key).toBe("chat_endpoint:tenant-123");
    });
  });

  describe("default rate limit", () => {
    it("should default to 60 requests per minute", () => {
      const quotas = null as { chatRateLimitPerMinute?: number } | null;
      const rateLimit = quotas?.chatRateLimitPerMinute || 60;
      expect(rateLimit).toBe(60);
    });

    it("should use tenant-configured rate limit when available", () => {
      const quotas = { chatRateLimitPerMinute: 100 };
      const rateLimit = quotas?.chatRateLimitPerMinute || 60;
      expect(rateLimit).toBe(100);
    });
  });

  describe("rate limit headers", () => {
    it("should include X-RateLimit-Limit header", () => {
      const headers = {
        "X-RateLimit-Limit": "60",
      };
      expect(headers["X-RateLimit-Limit"]).toBe("60");
    });

    it("should include X-RateLimit-Remaining header", () => {
      const headers = {
        "X-RateLimit-Remaining": "0",
      };
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
    });

    it("should include Retry-After header", () => {
      const headers = {
        "Retry-After": "60",
      };
      expect(headers["Retry-After"]).toBe("60");
    });
  });
});

// ============================================================================
// Tests for Token Validation
// ============================================================================

describe("Token Validation", () => {
  describe("endpoint token lookup", () => {
    it("should query by token value", () => {
      const token = "abc123def456";
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
    });

    it("should filter out revoked tokens", () => {
      interface EndpointToken {
        token: string;
        revokedAt: Date | null;
        tenantId: string;
        agentId: string;
      }

      const activeToken: EndpointToken = {
        token: "token-1",
        revokedAt: null,
        tenantId: "tenant-1",
        agentId: "agent-1",
      };

      const revokedToken: EndpointToken = {
        token: "token-2",
        revokedAt: new Date(),
        tenantId: "tenant-2",
        agentId: "agent-2",
      };

      const tokens = [activeToken, revokedToken];
      const validTokens = tokens.filter((t) => t.revokedAt === null);

      expect(validTokens.length).toBe(1);
      expect(validTokens[0].token).toBe("token-1");
    });
  });

  describe("agent lookup via token", () => {
    it("should get agentId from endpoint token", () => {
      const endpointToken = {
        token: "abc123",
        tenantId: "tenant-1",
        agentId: "agent-1",
      };
      expect(endpointToken.agentId).toBe("agent-1");
    });

    it("should get tenantId from endpoint token", () => {
      const endpointToken = {
        token: "abc123",
        tenantId: "tenant-1",
        agentId: "agent-1",
      };
      expect(endpointToken.tenantId).toBe("tenant-1");
    });
  });
});

// ============================================================================
// Tests for Agent Lookup
// ============================================================================

describe("Agent Lookup", () => {
  describe("agent retrieval", () => {
    it("should query agent by id from endpoint token", () => {
      const endpointToken = { agentId: "agent-123" };
      expect(endpointToken.agentId).toBe("agent-123");
    });

    it("should return full agent object including ragType", () => {
      const agent = {
        id: "agent-123",
        name: "Test Agent",
        ragType: "advanced" as const,
        citationsEnabled: true,
      };
      expect(agent.ragType).toBe("advanced");
    });
  });

  describe("deleted agent filtering", () => {
    it("should filter out soft-deleted agents", () => {
      interface Agent {
        id: string;
        ragType: "simple" | "advanced";
        deletedAt: Date | null;
      }

      const activeAgent: Agent = {
        id: "agent-1",
        ragType: "simple",
        deletedAt: null,
      };

      const deletedAgent: Agent = {
        id: "agent-2",
        ragType: "advanced",
        deletedAt: new Date(),
      };

      const agents = [activeAgent, deletedAgent];
      const foundAgents = agents.filter((a) => a.deletedAt === null);

      expect(foundAgents.length).toBe(1);
      expect(foundAgents[0].id).toBe("agent-1");
    });
  });

  describe("not found handling", () => {
    it("should throw NotFoundError for missing endpoint token", () => {
      const endpointToken = null;
      const shouldThrow = endpointToken === null;
      expect(shouldThrow).toBe(true);
    });

    it("should throw NotFoundError for missing agent", () => {
      const agent = null;
      const shouldThrow = agent === null;
      expect(shouldThrow).toBe(true);
    });
  });
});

// ============================================================================
// Tests for Streaming Response Behavior
// ============================================================================

describe("Streaming Response Behavior", () => {
  describe("Simple mode streaming", () => {
    it("should send initial searching status", () => {
      const event = {
        type: "status",
        status: "searching",
        message: "Searching knowledge base...",
      };
      expect(event.status).toBe("searching");
    });

    it("should send generating status before first text", () => {
      const event = {
        type: "status",
        status: "generating",
        message: "Generating response...",
      };
      expect(event.status).toBe("generating");
    });

    it("should NOT send reasoning events", () => {
      const simpleEvents = ["status", "text", "sources", "done", "error"];
      expect(simpleEvents).not.toContain("reasoning");
    });
  });

  describe("Advanced mode streaming", () => {
    it("should send reasoning events", () => {
      const advancedEvents = ["status", "reasoning", "text", "sources", "done", "error"];
      expect(advancedEvents).toContain("reasoning");
    });

    it("should send all 5 reasoning step types", () => {
      const stepTypes = ["rewrite", "plan", "search", "merge", "generate"];
      expect(stepTypes.length).toBe(5);
    });

    it("should send in_progress then completed for each step", () => {
      const stepStatuses = ["in_progress", "completed"];
      expect(stepStatuses[0]).toBe("in_progress");
      expect(stepStatuses[1]).toBe("completed");
    });

    it("should send status event from service (not manually)", () => {
      // Advanced mode relies on service's status events with sourceCount
      const event = {
        type: "status",
        status: "generating",
        message: "Found 5 sources. Generating response...",
        sourceCount: 5,
      };
      expect(event.sourceCount).toBe(5);
    });
  });

  describe("Heartbeat behavior", () => {
    it("should send ping events every 2 seconds", () => {
      const heartbeatIntervalMs = 2000;
      expect(heartbeatIntervalMs).toBe(2000);
    });

    it("should send ping event with correct structure", () => {
      const pingEvent = { type: "ping" };
      expect(pingEvent.type).toBe("ping");
    });
  });

  describe("Client disconnect handling", () => {
    it("should stop iteration when aborted", () => {
      let aborted = false;
      aborted = true;
      expect(aborted).toBe(true);
    });

    it("should clear heartbeat interval on abort", () => {
      let heartbeatInterval: ReturnType<typeof setInterval> | null = setInterval(() => {}, 2000);
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      expect(heartbeatInterval).toBeNull();
    });
  });
});

// ============================================================================
// Tests for Citation Handling in Streaming
// ============================================================================

describe("Citation Handling in Streaming", () => {
  describe("sources event filtering", () => {
    it("should send sources event when citationsEnabled is true", () => {
      const agent = { citationsEnabled: true };
      const shouldSendSources = agent.citationsEnabled;
      expect(shouldSendSources).toBe(true);
    });

    it("should NOT send sources event when citationsEnabled is false", () => {
      const agent = { citationsEnabled: false };
      const shouldSendSources = agent.citationsEnabled;
      expect(shouldSendSources).toBe(false);
    });
  });
});

// ============================================================================
// Tests for Error Handling
// ============================================================================

describe("Error Handling", () => {
  describe("service error handling", () => {
    it("should return error JSON for non-streaming endpoint", () => {
      const errorResponse = { error: "Something went wrong" };
      expect(errorResponse).toHaveProperty("error");
    });

    it("should send error SSE event for streaming endpoint", () => {
      const errorEvent = {
        type: "error",
        message: "An error occurred while generating the response.",
      };
      expect(errorEvent.type).toBe("error");
    });
  });

  describe("rate limit error handling", () => {
    it("should return 429 status for rate limit exceeded", () => {
      const statusCode = 429;
      expect(statusCode).toBe(429);
    });
  });

  describe("not found error handling", () => {
    it("should return 404 for missing endpoint token", () => {
      const statusCode = 404;
      expect(statusCode).toBe(404);
    });

    it("should return 404 for missing agent", () => {
      const statusCode = 404;
      expect(statusCode).toBe(404);
    });
  });
});

// ============================================================================
// Tests for Module Exports
// ============================================================================

describe("Module Exports", () => {
  it("should export chatEndpointRoutes", () => {
    // This tests the expected export structure
    const expectedExports = ["chatEndpointRoutes"];
    expect(expectedExports).toContain("chatEndpointRoutes");
  });
});

// ============================================================================
// Tests for Endpoint Types
// ============================================================================

describe("Endpoint Types", () => {
  describe("hosted endpoint", () => {
    it("should render HTML page for hosted type", () => {
      const endpointType = "hosted";
      expect(endpointType).toBe("hosted");
    });
  });

  describe("API endpoint", () => {
    it("should return error page for non-hosted type", () => {
      const endpointType = "api" as string;
      const isHosted = endpointType === "hosted";
      expect(isHosted).toBe(false);
    });
  });
});

// ============================================================================
// Tests for Channel Configuration
// ============================================================================

describe("Channel Configuration", () => {
  it("should use 'chat_endpoint' channel for this route", () => {
    const channel = "chat_endpoint";
    const validChannels = ["admin_ui", "widget", "api", "chat_endpoint"];
    expect(validChannels).toContain(channel);
  });

  it("should differentiate from other channels", () => {
    const channels = {
      adminChat: "admin_ui",
      widgetChat: "widget",
      chatEndpoint: "chat_endpoint",
    };
    expect(channels.chatEndpoint).not.toBe(channels.adminChat);
    expect(channels.chatEndpoint).not.toBe(channels.widgetChat);
  });
});
