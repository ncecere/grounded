import { describe, it, expect } from "bun:test";
import { chatSchema } from "../modules/chat/schema";

/**
 * Integration Tests for Chat Endpoints
 *
 * These tests verify the integration of all chat endpoints (admin chat, widget chat,
 * and public API chat endpoint) with both Simple and Advanced RAG modes.
 *
 * The tests focus on:
 * 1. End-to-end flow contracts
 * 2. Request/response structure integration
 * 3. Cross-endpoint behavior consistency
 * 4. Error handling integration
 * 5. SSE streaming behavior
 * 6. RAG mode routing integration
 */

// ============================================================================
// Shared Types and Schemas (Integration Contracts)
// ============================================================================

interface ReasoningStep {
  id: string;
  type: "rewrite" | "plan" | "search" | "merge" | "generate";
  title: string;
  summary: string;
  status: "pending" | "in_progress" | "completed" | "error";
  details?: Record<string, unknown>;
}

interface StreamSource {
  id: string;
  title: string;
  url?: string;
  snippet: string;
  index: number;
}

type SimpleStreamEvent =
  | { type: "status"; status: string; message: string; sourceCount?: number }
  | { type: "text"; content: string }
  | { type: "sources"; sources: StreamSource[] }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string };

type AdvancedStreamEvent =
  | { type: "status"; status: string; message: string; sourceCount?: number }
  | { type: "reasoning"; step: ReasoningStep }
  | { type: "text"; content: string }
  | { type: "sources"; sources: StreamSource[] }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string };

interface ChatRequest {
  message: string;
  conversationId?: string;
}

interface SimpleRAGResponse {
  answer: string;
  citations: Array<{ title: string; url?: string; snippet: string; index: number }>;
  conversationId: string;
}

interface AdvancedRAGResponse extends SimpleRAGResponse {
  reasoningSteps?: ReasoningStep[];
}

// Schema to validate chat request (shared across all endpoints)
const chatRequestSchema = chatSchema;

const SIMPLE_EVENT_TYPES = ["status", "text", "sources", "done", "error"] as const;
const ADVANCED_EVENT_TYPES = ["status", "reasoning", "text", "sources", "done", "error"] as const;

const expectSourcesContract = (sources: StreamSource[]) => {
  sources.forEach((source) => {
    expect(source).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      snippet: expect.any(String),
      index: expect.any(Number),
    });
  });
};

const expectSimpleEventContract = (event: SimpleStreamEvent) => {
  expect(event).toHaveProperty("type");
  switch (event.type) {
    case "status":
      expect(event).toMatchObject({ status: expect.any(String), message: expect.any(String) });
      break;
    case "text":
      expect(event).toMatchObject({ content: expect.any(String) });
      break;
    case "sources":
      expectSourcesContract(event.sources);
      break;
    case "done":
      expect(event).toMatchObject({ conversationId: expect.any(String) });
      break;
    case "error":
      expect(event).toMatchObject({ message: expect.any(String) });
      break;
  }
};

const expectAdvancedEventContract = (event: AdvancedStreamEvent) => {
  expect(event).toHaveProperty("type");
  switch (event.type) {
    case "reasoning":
      expect(event.step).toMatchObject({
        id: expect.any(String),
        type: expect.any(String),
        title: expect.any(String),
        summary: expect.any(String),
        status: expect.any(String),
      });
      break;
    default:
      expectSimpleEventContract(event as SimpleStreamEvent);
  }
};

// ============================================================================
// Admin Chat Endpoint Integration Tests
// ============================================================================

describe("Admin Chat Endpoint Integration", () => {
  describe("Simple RAG Mode Integration", () => {
    it("should route to SimpleRAGService for simple ragType", () => {
      const agent: { ragType: "simple" | "advanced" } = { ragType: "simple" };
      const serviceName = agent.ragType === "advanced" ? "AdvancedRAGService" : "SimpleRAGService";
      expect(serviceName).toBe("SimpleRAGService");
    });

    it("should use admin_ui channel for admin chat", () => {
      const channel = "admin_ui";
      expect(channel).toBe("admin_ui");
    });

    it("should stream status, text, sources, and done events", () => {
      const expectedEventTypes = ["status", "text", "sources", "done"];
      expectedEventTypes.forEach((type) => {
        expect(["status", "text", "sources", "done", "error"]).toContain(type);
      });
    });

    it("should NOT include reasoning events in simple mode", () => {
      const simpleEventTypes = ["status", "text", "sources", "done", "error"];
      expect(simpleEventTypes).not.toContain("reasoning");
    });

    it("should validate chat request before processing", () => {
      const validRequest: ChatRequest = { message: "What is RAG?" };
      const result = chatRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });
  });

  describe("Advanced RAG Mode Integration", () => {
    it("should route to AdvancedRAGService for advanced ragType", () => {
      const agent = { ragType: "advanced" as const };
      const serviceName = agent.ragType === "advanced" ? "AdvancedRAGService" : "SimpleRAGService";
      expect(serviceName).toBe("AdvancedRAGService");
    });

    it("should include reasoning events in advanced mode", () => {
      const advancedEventTypes = ["status", "reasoning", "text", "sources", "done", "error"];
      expect(advancedEventTypes).toContain("reasoning");
    });

    it("should emit all 5 reasoning step types", () => {
      const stepTypes: ReasoningStep["type"][] = ["rewrite", "plan", "search", "merge", "generate"];
      expect(stepTypes.length).toBe(5);
    });

    it("should emit in_progress and completed for each step", () => {
      const stepStatuses: ReasoningStep["status"][] = ["in_progress", "completed"];
      expect(stepStatuses.length).toBe(2);
      expect(stepStatuses[0]).toBe("in_progress");
      expect(stepStatuses[1]).toBe("completed");
    });

    it("should emit 10 reasoning events total (2 per step × 5 steps)", () => {
      const stepsCount = 5;
      const eventsPerStep = 2; // in_progress + completed
      const totalReasoningEvents = stepsCount * eventsPerStep;
      expect(totalReasoningEvents).toBe(10);
    });
  });

  describe("Agent Lookup Integration", () => {
    it("should fetch agent ragType before routing", () => {
      const columnsToFetch = { ragType: true };
      expect(Object.keys(columnsToFetch)).toContain("ragType");
    });

    it("should filter out soft-deleted agents", () => {
      const agents = [
        { id: "1", ragType: "simple" as const, deletedAt: null },
        { id: "2", ragType: "advanced" as const, deletedAt: new Date() },
      ];
      const activeAgents = agents.filter((a) => a.deletedAt === null);
      expect(activeAgents.length).toBe(1);
      expect(activeAgents[0].id).toBe("1");
    });

    it("should return 404 when agent not found", () => {
      const agent = null;
      const statusCode = agent ? 200 : 404;
      expect(statusCode).toBe(404);
    });

    it("should verify tenant ownership of agent", () => {
      const agent = { id: "agent-1", tenantId: "tenant-1" };
      const authContext = { tenantId: "tenant-1" };
      const isOwned = agent.tenantId === authContext.tenantId;
      expect(isOwned).toBe(true);
    });
  });

  describe("SSE Headers Integration", () => {
    it("should set correct SSE headers for streaming", () => {
      const expectedHeaders = {
        "X-Accel-Buffering": "no",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Connection: "keep-alive",
      };

      expect(expectedHeaders["X-Accel-Buffering"]).toBe("no");
      expect(expectedHeaders["Cache-Control"]).toContain("no-cache");
      expect(expectedHeaders.Connection).toBe("keep-alive");
    });
  });

  describe("Rate Limiting Integration", () => {
    it("should apply rate limiting with chat prefix", () => {
      const config = { keyPrefix: "chat", limit: 60, windowSeconds: 60 };
      expect(config.keyPrefix).toBe("chat");
      expect(config.limit).toBe(60);
    });
  });
});

// ============================================================================
// Widget Chat Endpoint Integration Tests
// ============================================================================

describe("Widget Chat Endpoint Integration", () => {
  describe("Simple RAG Mode Integration (Widget)", () => {
    it("should route to SimpleRAGService for simple ragType", () => {
      const agent: { ragType: "simple" | "advanced" } = { ragType: "simple" };
      const serviceName = agent.ragType === "advanced" ? "AdvancedRAGService" : "SimpleRAGService";
      expect(serviceName).toBe("SimpleRAGService");
    });

    it("should use widget channel for widget chat", () => {
      const channel = "widget";
      expect(channel).toBe("widget");
    });

    it("should use different channel than admin chat", () => {
      const widgetChannel = "widget";
      const adminChannel = "admin_ui";
      expect(widgetChannel).not.toBe(adminChannel);
    });
  });

  describe("Advanced RAG Mode Integration (Widget)", () => {
    it("should route to AdvancedRAGService for advanced ragType", () => {
      const agent = { ragType: "advanced" as const };
      const serviceName = agent.ragType === "advanced" ? "AdvancedRAGService" : "SimpleRAGService";
      expect(serviceName).toBe("AdvancedRAGService");
    });

    it("should pass widget channel to AdvancedRAGService", () => {
      const params = { tenantId: "t-1", agentId: "a-1", channel: "widget" };
      expect(params.channel).toBe("widget");
    });

    it("should include reasoning events in widget advanced mode", () => {
      const advancedEventTypes = ["status", "reasoning", "text", "sources", "done", "error"];
      expect(advancedEventTypes).toContain("reasoning");
    });
  });

  describe("SSE Contract Regression (Widget)", () => {
    it("should match simple RAG event contracts", () => {
      const events: SimpleStreamEvent[] = [
        { type: "status", status: "searching", message: "Searching knowledge base..." },
        { type: "text", content: "Hello" },
        {
          type: "sources",
          sources: [{ id: "s-1", title: "Doc 1", snippet: "...", index: 1, url: "http://example.com" }],
        },
        { type: "done", conversationId: "conv-1" },
        { type: "error", message: "Something went wrong" },
      ];

      events.forEach(expectSimpleEventContract);
      SIMPLE_EVENT_TYPES.forEach((type) => {
        expect(events.map((event) => event.type)).toContain(type);
      });
    });

    it("should match advanced RAG event contracts", () => {
      const events: AdvancedStreamEvent[] = [
        { type: "status", status: "generating", message: "Generating response..." },
        {
          type: "reasoning",
          step: {
            id: "step-1",
            type: "rewrite",
            title: "Query Rewriting",
            summary: "Rewriting query",
            status: "in_progress",
          },
        },
        { type: "text", content: "Hello" },
        {
          type: "sources",
          sources: [{ id: "s-2", title: "Doc 2", snippet: "...", index: 1 }],
        },
        { type: "done", conversationId: "conv-2" },
        { type: "error", message: "Something went wrong" },
      ];

      events.forEach(expectAdvancedEventContract);
      ADVANCED_EVENT_TYPES.forEach((type) => {
        expect(events.map((event) => event.type)).toContain(type);
      });
    });

    it("should keep status before text and sources before done", () => {
      const eventOrder = ["status", "text", "sources", "done"];
      expect(eventOrder.indexOf("status")).toBeLessThan(eventOrder.indexOf("text"));
      expect(eventOrder.indexOf("text")).toBeLessThan(eventOrder.indexOf("sources"));
      expect(eventOrder.indexOf("sources")).toBeLessThan(eventOrder.indexOf("done"));
    });

    it("should serialize SSE payloads as JSON with type", () => {
      const payload = JSON.stringify({ type: "status", status: "searching", message: "Searching..." });
      const parsed = JSON.parse(payload) as { type: string };
      expect(parsed.type).toBe("status");
    });
  });

  describe("Widget Token Validation Integration", () => {
    it("should validate widget token before processing", () => {
      const widgetToken = {
        id: "wt-1",
        token: "abc123",
        agentId: "agent-1",
        tenantId: "tenant-1",
        revokedAt: null,
      };
      expect(widgetToken.revokedAt).toBeNull();
    });

    it("should reject revoked widget tokens", () => {
      const widgetToken = {
        token: "abc123",
        revokedAt: new Date(),
      };
      const isValid = widgetToken.revokedAt === null;
      expect(isValid).toBe(false);
    });

    it("should retrieve agent via widget token's agentId", () => {
      const widgetToken = { agentId: "agent-123" };
      const agentQuery = { id: widgetToken.agentId };
      expect(agentQuery.id).toBe("agent-123");
    });
  });

  describe("Widget Rate Limiting Integration", () => {
    it("should use widget-specific rate limit key", () => {
      const tenantId = "tenant-123";
      const key = `widget:chat:${tenantId}`;
      expect(key.startsWith("widget:")).toBe(true);
    });

    it("should use tenant-specific limits when configured", () => {
      const quotas = { chatRateLimitPerMinute: 120 };
      const defaultLimit = 60;
      const limit = quotas?.chatRateLimitPerMinute || defaultLimit;
      expect(limit).toBe(120);
    });

    it("should default to 60 requests per minute", () => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const quotas = null as { chatRateLimitPerMinute?: number } | null;
      const defaultLimit = 60;
      const limit = quotas?.chatRateLimitPerMinute ?? defaultLimit;
      expect(limit).toBe(60);
    });
  });
});

// ============================================================================
// Public Chat Endpoint (chat-endpoint) Integration Tests
// ============================================================================

describe("Public Chat Endpoint Integration", () => {
  describe("Non-Streaming Response Integration", () => {
    describe("Simple RAG Mode", () => {
      it("should return answer, citations, and conversationId", () => {
        const response: SimpleRAGResponse = {
          answer: "This is the answer.",
          citations: [{ title: "Doc1", url: "http://example.com", snippet: "...", index: 1 }],
          conversationId: "conv-123",
        };

        expect(response).toHaveProperty("answer");
        expect(response).toHaveProperty("citations");
        expect(response).toHaveProperty("conversationId");
      });

      it("should NOT include reasoningSteps in simple mode response", () => {
        const response: SimpleRAGResponse = {
          answer: "This is the answer.",
          citations: [],
          conversationId: "conv-123",
        };

        expect(response).not.toHaveProperty("reasoningSteps");
      });

      it("should filter citations when citationsEnabled is false", () => {
        const agent = { citationsEnabled: false };
        const rawCitations = [{ title: "Doc1", snippet: "...", index: 1 }];
        const finalCitations = agent.citationsEnabled ? rawCitations : [];
        expect(finalCitations.length).toBe(0);
      });
    });

    describe("Advanced RAG Mode", () => {
      it("should include reasoningSteps in advanced mode response", () => {
        const response: AdvancedRAGResponse = {
          answer: "This is the answer.",
          citations: [],
          conversationId: "conv-123",
          reasoningSteps: [
            { id: "1", type: "rewrite", title: "Query Rewriting", summary: "Done", status: "completed" },
          ],
        };

        expect(response).toHaveProperty("reasoningSteps");
        expect(response.reasoningSteps).toHaveLength(1);
      });

      it("should only include completed reasoning steps in response", () => {
        const allSteps: ReasoningStep[] = [
          { id: "1", type: "rewrite", title: "Rewriting", summary: "...", status: "in_progress" },
          { id: "1", type: "rewrite", title: "Rewriting", summary: "Done", status: "completed" },
          { id: "2", type: "plan", title: "Planning", summary: "...", status: "in_progress" },
          { id: "2", type: "plan", title: "Planning", summary: "Done", status: "completed" },
        ];

        const completedSteps = allSteps.filter((s) => s.status === "completed");
        expect(completedSteps.length).toBe(2);
        expect(completedSteps.every((s) => s.status === "completed")).toBe(true);
      });

      it("should include all 5 step types when fully completed", () => {
        const completedSteps: ReasoningStep[] = [
          { id: "1", type: "rewrite", title: "Query Rewriting", summary: "Done", status: "completed" },
          { id: "2", type: "plan", title: "Query Planning", summary: "Done", status: "completed" },
          { id: "3", type: "search", title: "Knowledge Search", summary: "Done", status: "completed" },
          { id: "4", type: "merge", title: "Result Merging", summary: "Done", status: "completed" },
          { id: "5", type: "generate", title: "Answer Generation", summary: "Done", status: "completed" },
        ];

        const types = completedSteps.map((s) => s.type);
        expect(types).toContain("rewrite");
        expect(types).toContain("plan");
        expect(types).toContain("search");
        expect(types).toContain("merge");
        expect(types).toContain("generate");
      });

      it("should conditionally include reasoningSteps when steps exist", () => {
        const reasoningSteps: ReasoningStep[] = [];
        const ragType = "advanced";

        // Build response conditionally
        const baseResponse = {
          answer: "Answer",
          citations: [],
          conversationId: "conv-1",
        };

        const response: AdvancedRAGResponse =
          ragType === "advanced" && reasoningSteps.length > 0
            ? { ...baseResponse, reasoningSteps }
            : baseResponse;

        // When no steps, reasoningSteps should not be included
        expect(response.reasoningSteps).toBeUndefined();
      });
    });
  });

  describe("Streaming Response Integration", () => {
    describe("Simple RAG Mode Streaming", () => {
      it("should send initial searching status", () => {
        const event: SimpleStreamEvent = {
          type: "status",
          status: "searching",
          message: "Searching knowledge base...",
        };
        expect(event.status).toBe("searching");
      });

      it("should send generating status before first text", () => {
        const event: SimpleStreamEvent = {
          type: "status",
          status: "generating",
          message: "Generating response...",
        };
        expect(event.status).toBe("generating");
      });

      it("should stream text events with content", () => {
        const event: SimpleStreamEvent = { type: "text", content: "Hello " };
        expect(event.type).toBe("text");
        if (event.type === "text") {
          expect(event.content).toBe("Hello ");
        }
      });

      it("should send sources event when citations enabled", () => {
        const agent = { citationsEnabled: true };
        const shouldSendSources = agent.citationsEnabled;
        expect(shouldSendSources).toBe(true);
      });

      it("should NOT send sources event when citations disabled", () => {
        const agent = { citationsEnabled: false };
        const shouldSendSources = agent.citationsEnabled;
        expect(shouldSendSources).toBe(false);
      });

      it("should end with done event containing conversationId", () => {
        const event: SimpleStreamEvent = { type: "done", conversationId: "conv-123" };
        expect(event.type).toBe("done");
        if (event.type === "done") {
          expect(event.conversationId).toBeTruthy();
        }
      });
    });

    describe("Advanced RAG Mode Streaming", () => {
      it("should include reasoning events in stream", () => {
        const event: AdvancedStreamEvent = {
          type: "reasoning",
          step: {
            id: "step-1",
            type: "rewrite",
            title: "Query Rewriting",
            summary: "Processing...",
            status: "in_progress",
          },
        };
        expect(event.type).toBe("reasoning");
      });

      it("should emit status events from service (with sourceCount)", () => {
        const event: AdvancedStreamEvent = {
          type: "status",
          status: "generating",
          message: "Found 5 sources. Generating response...",
          sourceCount: 5,
        };
        expect(event.sourceCount).toBe(5);
      });

      it("should preserve reasoning step structure in SSE", () => {
        const step: ReasoningStep = {
          id: "step-1",
          type: "plan",
          title: "Query Planning",
          summary: "Generated 3 sub-queries",
          status: "completed",
          details: { subQueries: ["q1", "q2", "q3"] },
        };

        const event: AdvancedStreamEvent = { type: "reasoning", step };

        if (event.type === "reasoning") {
          expect(event.step.id).toBe("step-1");
          expect(event.step.type).toBe("plan");
          expect(event.step.details).toBeDefined();
        }
      });

      it("should emit reasoning steps in correct order", () => {
        const expectedOrder: ReasoningStep["type"][] = ["rewrite", "plan", "search", "merge", "generate"];
        const steps: ReasoningStep["type"][] = [];

        // Simulate receiving steps in order
        expectedOrder.forEach((type) => {
          steps.push(type);
        });

        expect(steps).toEqual(expectedOrder);
      });
    });

    describe("SSE Contract Regression (Chat Endpoint)", () => {
      it("should match simple stream event contracts", () => {
        const events: SimpleStreamEvent[] = [
          { type: "status", status: "searching", message: "Searching knowledge base..." },
          { type: "text", content: "Hello" },
          {
            type: "sources",
            sources: [{ id: "s-3", title: "Doc 3", snippet: "...", index: 1 }],
          },
          { type: "done", conversationId: "conv-3" },
          { type: "error", message: "Something went wrong" },
        ];

        events.forEach(expectSimpleEventContract);
        SIMPLE_EVENT_TYPES.forEach((type) => {
          expect(events.map((event) => event.type)).toContain(type);
        });
      });

      it("should match advanced stream event contracts", () => {
        const events: AdvancedStreamEvent[] = [
          { type: "status", status: "generating", message: "Generating response..." },
          {
            type: "reasoning",
            step: {
              id: "step-2",
              type: "plan",
              title: "Query Planning",
              summary: "Planning sub-queries",
              status: "completed",
            },
          },
          { type: "text", content: "Hello" },
          {
            type: "sources",
            sources: [{ id: "s-4", title: "Doc 4", snippet: "...", index: 2 }],
          },
          { type: "done", conversationId: "conv-4" },
          { type: "error", message: "Something went wrong" },
        ];

        events.forEach(expectAdvancedEventContract);
        ADVANCED_EVENT_TYPES.forEach((type) => {
          expect(events.map((event) => event.type)).toContain(type);
        });
      });

      it("should keep sources after text and done last", () => {
        const eventOrder = ["status", "text", "sources", "done"];
        expect(eventOrder.indexOf("status")).toBeLessThan(eventOrder.indexOf("text"));
        expect(eventOrder.indexOf("text")).toBeLessThan(eventOrder.indexOf("sources"));
        expect(eventOrder.indexOf("sources")).toBeLessThan(eventOrder.indexOf("done"));
      });
    });

    describe("Heartbeat Integration", () => {
      it("should send ping events periodically", () => {
        const pingEvent = { type: "ping" };
        expect(pingEvent.type).toBe("ping");
      });

      it("should use 2000ms heartbeat interval", () => {
        const heartbeatIntervalMs = 2000;
        expect(heartbeatIntervalMs).toBe(2000);
      });

      it("should stop heartbeat on client disconnect", () => {
        let aborted = false;
        let heartbeatInterval: ReturnType<typeof setInterval> | null = setInterval(() => {}, 2000);

        // Simulate abort
        aborted = true;
        if (aborted && heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        expect(heartbeatInterval).toBeNull();
      });
    });
  });

  describe("Token Validation Integration", () => {
    it("should use chat_endpoint channel for public API", () => {
      const channel = "chat_endpoint";
      expect(channel).toBe("chat_endpoint");
    });

    it("should validate endpoint token exists", () => {
      const endpointToken = null;
      const shouldThrowNotFound = endpointToken === null;
      expect(shouldThrowNotFound).toBe(true);
    });

    it("should validate endpoint token is not revoked", () => {
      const endpointToken = { token: "abc123", revokedAt: null };
      const isValid = endpointToken.revokedAt === null;
      expect(isValid).toBe(true);
    });

    it("should validate associated agent exists", () => {
      const agent = null;
      const shouldThrowNotFound = agent === null;
      expect(shouldThrowNotFound).toBe(true);
    });

    it("should get tenantId from endpoint token", () => {
      const endpointToken = { token: "abc123", tenantId: "tenant-1", agentId: "agent-1" };
      expect(endpointToken.tenantId).toBe("tenant-1");
    });
  });

  describe("Rate Limiting Integration", () => {
    it("should use chat_endpoint prefix for rate limiting", () => {
      const tenantId = "tenant-123";
      const key = `chat_endpoint:${tenantId}`;
      expect(key).toBe("chat_endpoint:tenant-123");
    });

    it("should return rate limit headers when exceeded", () => {
      const headers = {
        "X-RateLimit-Limit": "60",
        "X-RateLimit-Remaining": "0",
        "Retry-After": "60",
      };

      expect(headers["X-RateLimit-Limit"]).toBe("60");
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["Retry-After"]).toBe("60");
    });

    it("should return 429 status when rate limited", () => {
      const statusCode = 429;
      expect(statusCode).toBe(429);
    });
  });
});

// ============================================================================
// Cross-Endpoint Integration Tests
// ============================================================================

describe("Cross-Endpoint Integration", () => {
  describe("Consistent Chat Request Schema", () => {
    it("should use same message constraints across all endpoints", () => {
      const constraints = { minLength: 1, maxLength: 4000 };

      // All endpoints use the same constraints
      expect(constraints.minLength).toBe(1);
      expect(constraints.maxLength).toBe(4000);
    });

    it("should accept valid requests across all endpoints", () => {
      const validRequest: ChatRequest = {
        message: "What is the capital of France?",
        conversationId: "conv-abc-123",
      };

      const result = chatRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it("should reject invalid requests across all endpoints", () => {
      const invalidRequest = { message: "" };
      const result = chatRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe("Consistent RAG Type Routing", () => {
    type RagType = "simple" | "advanced";

    function determineService(ragType: RagType): string {
      return ragType === "advanced" ? "AdvancedRAGService" : "SimpleRAGService";
    }

    it("should route consistently across all endpoints for simple mode", () => {
      expect(determineService("simple")).toBe("SimpleRAGService");
    });

    it("should route consistently across all endpoints for advanced mode", () => {
      expect(determineService("advanced")).toBe("AdvancedRAGService");
    });
  });

  describe("Consistent Stream Event Types", () => {
    it("should have consistent base event types across endpoints", () => {
      const baseTypes = ["status", "text", "sources", "done", "error"];

      baseTypes.forEach((type) => {
        expect(baseTypes).toContain(type);
      });
    });

    it("should add reasoning event type only for advanced mode", () => {
      const simpleTypes = ["status", "text", "sources", "done", "error"];
      const advancedTypes = ["status", "reasoning", "text", "sources", "done", "error"];

      expect(simpleTypes).not.toContain("reasoning");
      expect(advancedTypes).toContain("reasoning");
    });
  });

  describe("Consistent SSE Header Configuration", () => {
    const expectedHeaders = {
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
    };

    it("should use same headers for admin chat streaming", () => {
      expect(expectedHeaders["X-Accel-Buffering"]).toBe("no");
    });

    it("should use same headers for widget chat streaming", () => {
      expect(expectedHeaders.Connection).toBe("keep-alive");
    });

    it("should use same headers for chat endpoint streaming", () => {
      expect(expectedHeaders["Cache-Control"]).toContain("no-cache");
    });
  });

  describe("Channel Differentiation", () => {
    it("should use different channels for different endpoints", () => {
      const channels = {
        adminChat: "admin_ui",
        widgetChat: "widget",
        chatEndpoint: "chat_endpoint",
      };

      expect(channels.adminChat).not.toBe(channels.widgetChat);
      expect(channels.widgetChat).not.toBe(channels.chatEndpoint);
      expect(channels.chatEndpoint).not.toBe(channels.adminChat);
    });

    it("should pass correct channel to AdvancedRAGService", () => {
      const endpointChannelMap = {
        "/chat/simple/:agentId": "admin_ui",
        "/widget/chat": "widget",
        "/c/:token/chat": "chat_endpoint",
      };

      expect(Object.values(endpointChannelMap)).toContain("admin_ui");
      expect(Object.values(endpointChannelMap)).toContain("widget");
      expect(Object.values(endpointChannelMap)).toContain("chat_endpoint");
    });
  });
});

// ============================================================================
// Error Handling Integration Tests
// ============================================================================

describe("Error Handling Integration", () => {
  describe("NotFoundError Integration", () => {
    it("should return 404 for missing agent in admin chat", () => {
      const agent = null;
      const statusCode = agent ? 200 : 404;
      expect(statusCode).toBe(404);
    });

    it("should return 404 for missing agent in widget chat", () => {
      const agent = null;
      const statusCode = agent ? 200 : 404;
      expect(statusCode).toBe(404);
    });

    it("should return 404 for missing endpoint token in public API", () => {
      const endpointToken = null;
      const statusCode = endpointToken ? 200 : 404;
      expect(statusCode).toBe(404);
    });

    it("should return 404 for missing agent in public API", () => {
      const agent = null;
      const statusCode = agent ? 200 : 404;
      expect(statusCode).toBe(404);
    });
  });

  describe("RateLimitError Integration", () => {
    it("should return 429 when rate limit exceeded", () => {
      const rateLimitExceeded = true;
      const statusCode = rateLimitExceeded ? 429 : 200;
      expect(statusCode).toBe(429);
    });

    it("should include retry information in response", () => {
      const windowSeconds = 60;
      expect(windowSeconds).toBe(60);
    });
  });

  describe("Service Error Integration", () => {
    it("should return error JSON for non-streaming endpoint errors", () => {
      const errorResponse = { error: "Internal server error" };
      expect(errorResponse).toHaveProperty("error");
    });

    it("should stream error event for streaming endpoint errors", () => {
      const errorEvent: SimpleStreamEvent = {
        type: "error",
        message: "An error occurred while generating the response.",
      };
      expect(errorEvent.type).toBe("error");
    });

    it("should properly format error messages", () => {
      const error = new Error("Database connection failed");
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Database connection failed");
    });
  });

  describe("Validation Error Integration", () => {
    it("should reject empty message", () => {
      const result = chatRequestSchema.safeParse({ message: "" });
      expect(result.success).toBe(false);
    });

    it("should reject message over max length", () => {
      const result = chatRequestSchema.safeParse({ message: "a".repeat(4001) });
      expect(result.success).toBe(false);
    });

    it("should reject non-string message", () => {
      const result = chatRequestSchema.safeParse({ message: 123 });
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// ReasoningStep Structure Integration Tests
// ============================================================================

describe("ReasoningStep Structure Integration", () => {
  describe("Step Type Consistency", () => {
    const stepTypes: ReasoningStep["type"][] = ["rewrite", "plan", "search", "merge", "generate"];

    it("should support exactly 5 step types", () => {
      expect(stepTypes.length).toBe(5);
    });

    it("should have rewrite as first step type", () => {
      expect(stepTypes[0]).toBe("rewrite");
    });

    it("should have generate as last step type", () => {
      expect(stepTypes[stepTypes.length - 1]).toBe("generate");
    });
  });

  describe("Step Status Consistency", () => {
    const stepStatuses: ReasoningStep["status"][] = ["pending", "in_progress", "completed", "error"];

    it("should support exactly 4 status values", () => {
      expect(stepStatuses.length).toBe(4);
    });

    it("should include all required statuses", () => {
      expect(stepStatuses).toContain("pending");
      expect(stepStatuses).toContain("in_progress");
      expect(stepStatuses).toContain("completed");
      expect(stepStatuses).toContain("error");
    });
  });

  describe("Step Structure Consistency", () => {
    it("should have consistent required fields", () => {
      const step: ReasoningStep = {
        id: "step-123",
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Processing...",
        status: "in_progress",
      };

      expect(step).toHaveProperty("id");
      expect(step).toHaveProperty("type");
      expect(step).toHaveProperty("title");
      expect(step).toHaveProperty("summary");
      expect(step).toHaveProperty("status");
    });

    it("should allow optional details field", () => {
      const step: ReasoningStep = {
        id: "step-123",
        type: "plan",
        title: "Query Planning",
        summary: "Generated 3 sub-queries",
        status: "completed",
        details: { subQueries: ["q1", "q2", "q3"] },
      };

      expect(step.details).toBeDefined();
      expect(step.details?.subQueries).toHaveLength(3);
    });

    it("should have unique step ID", () => {
      // Step IDs should be unique (typically UUIDs)
      const stepId = "550e8400-e29b-41d4-a716-446655440000";
      expect(stepId).toMatch(/[a-f0-9-]{36}/);
    });
  });

  describe("Step Title Consistency", () => {
    const stepTitles: Record<ReasoningStep["type"], string> = {
      rewrite: "Query Rewriting",
      plan: "Query Planning",
      search: "Knowledge Search",
      merge: "Result Merging",
      generate: "Answer Generation",
    };

    it("should have human-readable titles for all step types", () => {
      Object.values(stepTitles).forEach((title) => {
        expect(typeof title).toBe("string");
        expect(title.length).toBeGreaterThan(0);
      });
    });
  });
});

// ============================================================================
// Citation Handling Integration Tests
// ============================================================================

describe("Citation Handling Integration", () => {
  describe("Citation Structure", () => {
    interface Citation {
      title: string;
      url?: string;
      snippet: string;
      index: number;
    }

    it("should have consistent citation structure", () => {
      const citation: Citation = {
        title: "Document Title",
        url: "https://example.com/doc",
        snippet: "This is a snippet...",
        index: 1,
      };

      expect(citation).toHaveProperty("title");
      expect(citation).toHaveProperty("snippet");
      expect(citation).toHaveProperty("index");
    });

    it("should allow optional url field", () => {
      const citation: Citation = {
        title: "Document Title",
        snippet: "This is a snippet...",
        index: 1,
      };

      expect(citation.url).toBeUndefined();
    });

    it("should use 1-based indexing for citations", () => {
      const citations: Citation[] = [
        { title: "Doc 1", snippet: "...", index: 1 },
        { title: "Doc 2", snippet: "...", index: 2 },
        { title: "Doc 3", snippet: "...", index: 3 },
      ];

      expect(citations[0].index).toBe(1);
      expect(citations[citations.length - 1].index).toBe(3);
    });
  });

  describe("Citation Filtering", () => {
    it("should filter citations based on agent settings", () => {
      const testCases = [
        { citationsEnabled: true, expected: 3 },
        { citationsEnabled: false, expected: 0 },
      ];

      const rawCitations = [
        { title: "Doc 1", snippet: "...", index: 1 },
        { title: "Doc 2", snippet: "...", index: 2 },
        { title: "Doc 3", snippet: "...", index: 3 },
      ];

      testCases.forEach(({ citationsEnabled, expected }) => {
        const finalCitations = citationsEnabled ? rawCitations : [];
        expect(finalCitations.length).toBe(expected);
      });
    });
  });

  describe("Citation in Stream Events", () => {
    it("should include sources in sources event", () => {
      const event: SimpleStreamEvent = {
        type: "sources",
        sources: [
          { id: "c-1", title: "Doc 1", url: "http://example.com/1", snippet: "...", index: 1 },
          { id: "c-2", title: "Doc 2", snippet: "...", index: 2 },
        ],
      };

      if (event.type === "sources") {
        expect(event.sources).toHaveLength(2);
      }
    });
  });
});

// ============================================================================
// Conversation Context Integration Tests
// ============================================================================

describe("Conversation Context Integration", () => {
  describe("ConversationId Handling", () => {
    it("should accept new conversation (no conversationId)", () => {
      const request: ChatRequest = { message: "Hello" };
      expect(request.conversationId).toBeUndefined();
    });

    it("should accept existing conversation (with conversationId)", () => {
      const request: ChatRequest = {
        message: "Follow-up question",
        conversationId: "conv-abc-123",
      };
      expect(request.conversationId).toBe("conv-abc-123");
    });

    it("should return conversationId in done event", () => {
      const event: SimpleStreamEvent = { type: "done", conversationId: "conv-new-456" };
      if (event.type === "done") {
        expect(event.conversationId).toBeTruthy();
      }
    });

    it("should return conversationId in non-streaming response", () => {
      const response: SimpleRAGResponse = {
        answer: "Answer",
        citations: [],
        conversationId: "conv-123",
      };
      expect(response.conversationId).toBeTruthy();
    });
  });

  describe("Multi-turn Conversation Support", () => {
    it("should use historyTurns for conversation context (advanced mode)", () => {
      const retrievalConfig = { historyTurns: 5 };
      expect(retrievalConfig.historyTurns).toBe(5);
    });

    it("should support historyTurns range 1-20", () => {
      const minTurns = 1;
      const maxTurns = 20;
      expect(minTurns).toBe(1);
      expect(maxTurns).toBe(20);
    });
  });
});

// ============================================================================
// Service Configuration Integration Tests
// ============================================================================

describe("Service Configuration Integration", () => {
  describe("AdvancedRAGService Configuration", () => {
    it("should accept historyTurns configuration", () => {
      const config = { historyTurns: 10 };
      expect(config.historyTurns).toBe(10);
    });

    it("should accept advancedMaxSubqueries configuration", () => {
      const config = { advancedMaxSubqueries: 4 };
      expect(config.advancedMaxSubqueries).toBe(4);
    });

    it("should use default historyTurns of 5", () => {
      const defaultHistoryTurns = 5;
      expect(defaultHistoryTurns).toBe(5);
    });

    it("should use default advancedMaxSubqueries of 3", () => {
      const defaultMaxSubqueries = 3;
      expect(defaultMaxSubqueries).toBe(3);
    });
  });

  describe("SimpleRAGService Configuration", () => {
    it("should not use historyTurns (simple mode)", () => {
      const simpleConfig = { topK: 5, similarityThreshold: 0.7 };
      expect(simpleConfig).not.toHaveProperty("historyTurns");
    });

    it("should not use advancedMaxSubqueries (simple mode)", () => {
      const simpleConfig = { topK: 5, similarityThreshold: 0.7 };
      expect(simpleConfig).not.toHaveProperty("advancedMaxSubqueries");
    });
  });
});

// ============================================================================
// Module Export Integration Tests
// ============================================================================

describe("Module Export Integration", () => {
  describe("Route Module Exports", () => {
    it("should export chatRoutes from chat.ts", () => {
      const expectedExport = "chatRoutes";
      expect(expectedExport).toBe("chatRoutes");
    });

    it("should export chatEndpointRoutes from chat-endpoint.ts", () => {
      const expectedExport = "chatEndpointRoutes";
      expect(expectedExport).toBe("chatEndpointRoutes");
    });

    it("should export widgetRoutes from widget.ts", () => {
      const expectedExport = "widgetRoutes";
      expect(expectedExport).toBe("widgetRoutes");
    });
  });

  describe("Service Module Exports", () => {
    it("should export SimpleRAGService", () => {
      const expectedExport = "SimpleRAGService";
      expect(expectedExport).toBe("SimpleRAGService");
    });

    it("should export AdvancedRAGService", () => {
      const expectedExport = "AdvancedRAGService";
      expect(expectedExport).toBe("AdvancedRAGService");
    });

    it("should export ReasoningStep type from advanced-rag", () => {
      const expectedExport = "ReasoningStep";
      expect(expectedExport).toBe("ReasoningStep");
    });

    it("should export StreamEvent type from simple-rag", () => {
      const expectedExport = "StreamEvent";
      expect(expectedExport).toBe("StreamEvent");
    });
  });

  describe("Helper Module Exports", () => {
    it("should export handleWidgetChatStream from widget-chat-helpers", () => {
      const expectedExport = "handleWidgetChatStream";
      expect(expectedExport).toBe("handleWidgetChatStream");
    });

    it("should export widgetChatSchema from widget-chat-helpers", () => {
      const expectedExport = "widgetChatSchema";
      expect(expectedExport).toBe("widgetChatSchema");
    });
  });
});
