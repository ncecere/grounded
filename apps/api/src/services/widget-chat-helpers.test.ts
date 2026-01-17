import { describe, it, expect } from "bun:test";
import { widgetChatSchema, type WidgetChatInput } from "./widget-chat-helpers";

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
});
