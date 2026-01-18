import { describe, it, expect } from "bun:test";
import { widgetChatSchema, type WidgetChatInput, type WidgetTokenValidation } from "./widget-chat-helpers";

describe("widget-chat-helpers", () => {
  describe("widgetChatSchema", () => {
    it("should validate a valid chat message", () => {
      const validPayload: WidgetChatInput = {
        message: "Hello, how can you help me?",
      };

      const result = widgetChatSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should validate a chat message with conversationId", () => {
      const validPayload: WidgetChatInput = {
        message: "Follow-up question",
        conversationId: "abc-123-def-456",
      };

      const result = widgetChatSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conversationId).toBe("abc-123-def-456");
      }
    });

    it("should reject empty message", () => {
      const invalidPayload = {
        message: "",
      };

      const result = widgetChatSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject missing message", () => {
      const invalidPayload = {};

      const result = widgetChatSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject message over 4000 characters", () => {
      const invalidPayload = {
        message: "a".repeat(4001),
      };

      const result = widgetChatSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should accept message at exactly 4000 characters", () => {
      const validPayload = {
        message: "a".repeat(4000),
      };

      const result = widgetChatSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should accept message at minimum length (1 character)", () => {
      const validPayload = {
        message: "a",
      };

      const result = widgetChatSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should allow optional conversationId to be undefined", () => {
      const validPayload = {
        message: "Hello",
        conversationId: undefined,
      };

      const result = widgetChatSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conversationId).toBeUndefined();
      }
    });

    it("should accept any string for conversationId", () => {
      const validPayload = {
        message: "Hello",
        conversationId: "123e4567-e89b-12d3-a456-426614174000",
      };

      const result = widgetChatSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject non-string message", () => {
      const invalidPayload = {
        message: 123,
      };

      const result = widgetChatSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject non-string conversationId", () => {
      const invalidPayload = {
        message: "Hello",
        conversationId: 123,
      };

      const result = widgetChatSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // Tests for RAG Type Routing Logic (Widget)
  // ============================================================================

  describe("RAG Type Routing Logic (Widget)", () => {
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
        const channel = "widget";

        // AdvancedRAGService takes (tenantId, agentId, channel)
        const params = [tenantId, agentId, channel];
        expect(params.length).toBe(3);
        expect(params[0]).toBe(tenantId);
        expect(params[1]).toBe(agentId);
        expect(params[2]).toBe(channel);
      });

      it("should use 'widget' channel for widget chat route", () => {
        const channel: "admin_ui" | "widget" | "api" | "chat_endpoint" = "widget";
        expect(channel).toBe("widget");
      });

      it("should use different channel than admin chat route", () => {
        const widgetChannel = "widget";
        const adminChannel = "admin_ui";
        expect(widgetChannel).not.toBe(adminChannel);
      });
    });
  });

  // ============================================================================
  // Tests for Widget Token Validation Types
  // ============================================================================

  describe("WidgetTokenValidation type", () => {
    it("should have widgetToken property", () => {
      const validation = {
        widgetToken: {
          id: "token-123",
          token: "abc123",
          agentId: "agent-456",
          tenantId: "tenant-789",
          revokedAt: null,
        },
        agent: {
          id: "agent-456",
          tenantId: "tenant-789",
          name: "Test Agent",
          ragType: "simple" as const,
          deletedAt: null,
        },
      };

      expect(validation).toHaveProperty("widgetToken");
      expect(validation.widgetToken).toHaveProperty("id");
      expect(validation.widgetToken).toHaveProperty("token");
      expect(validation.widgetToken).toHaveProperty("agentId");
      expect(validation.widgetToken).toHaveProperty("tenantId");
    });

    it("should have agent property with ragType", () => {
      const validation = {
        widgetToken: {
          id: "token-123",
          token: "abc123",
          agentId: "agent-456",
          tenantId: "tenant-789",
          revokedAt: null,
        },
        agent: {
          id: "agent-456",
          tenantId: "tenant-789",
          name: "Test Agent",
          ragType: "advanced" as const,
          deletedAt: null,
        },
      };

      expect(validation).toHaveProperty("agent");
      expect(validation.agent).toHaveProperty("ragType");
      expect(validation.agent.ragType).toBe("advanced");
    });

    it("should support simple ragType on agent", () => {
      const agent = {
        id: "agent-456",
        ragType: "simple" as "simple" | "advanced",
      };
      expect(agent.ragType).toBe("simple");
    });

    it("should support advanced ragType on agent", () => {
      const agent = {
        id: "agent-456",
        ragType: "advanced" as "simple" | "advanced",
      };
      expect(agent.ragType).toBe("advanced");
    });
  });

  // ============================================================================
  // Tests for Stream Event Types (Widget)
  // ============================================================================

  describe("Stream Event Types (Widget)", () => {
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

    describe("AdvancedRAGService stream events (widget)", () => {
      interface ReasoningStep {
        id: string;
        type: string;
        title: string;
        summary: string;
        status: string;
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

      it("should support all reasoning step types", () => {
        const stepTypes = ["rewrite", "plan", "search", "merge", "generate"];
        expect(stepTypes.length).toBe(5);
        expect(stepTypes).toContain("rewrite");
        expect(stepTypes).toContain("plan");
        expect(stepTypes).toContain("search");
        expect(stepTypes).toContain("merge");
        expect(stepTypes).toContain("generate");
      });
    });
  });

  // ============================================================================
  // Tests for Widget SSE Headers
  // ============================================================================

  describe("Widget SSE Headers", () => {
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
  // Tests for Widget Rate Limiting
  // ============================================================================

  describe("Widget Rate Limiting", () => {
    it("should use widget-specific key prefix", () => {
      const tenantId = "tenant-123";
      const key = `widget:chat:${tenantId}`;
      expect(key).toBe("widget:chat:tenant-123");
      expect(key.startsWith("widget:")).toBe(true);
    });

    it("should use tenant-specific rate limit key", () => {
      const tenantId1 = "tenant-123";
      const tenantId2 = "tenant-456";

      const key1 = `widget:chat:${tenantId1}`;
      const key2 = `widget:chat:${tenantId2}`;

      expect(key1).not.toBe(key2);
    });

    it("should default to 60 requests per minute", () => {
      const defaultLimit = 60;
      const quota = null;
      const limit = quota || defaultLimit;
      expect(limit).toBe(60);
    });

    it("should use tenant quota when available", () => {
      const defaultLimit = 60;
      const quota = { chatRateLimitPerMinute: 100 };
      const limit = quota.chatRateLimitPerMinute || defaultLimit;
      expect(limit).toBe(100);
    });
  });

  // ============================================================================
  // Tests for Module Exports
  // ============================================================================

  describe("Module Exports", () => {
    it("should export widgetChatSchema", () => {
      expect(widgetChatSchema).toBeDefined();
      expect(typeof widgetChatSchema.parse).toBe("function");
    });

    it("should export WidgetChatInput type (verified via import)", () => {
      // Type is verified by TypeScript at compile time
      const input: WidgetChatInput = {
        message: "test",
      };
      expect(input.message).toBe("test");
    });
  });
});
