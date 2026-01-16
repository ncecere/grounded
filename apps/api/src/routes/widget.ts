import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { db } from "@grounded/db";
import {
  widgetTokens,
  agents,
  agentWidgetConfigs,
  chatEvents,
  tenantQuotas,
} from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { checkRateLimit } from "@grounded/queue";
import { NotFoundError, RateLimitError } from "../middleware/error-handler";
import { SimpleRAGService } from "../services/simple-rag";

export const widgetRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const widgetChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

// ============================================================================
// Helper: Validate Widget Token
// ============================================================================

async function validateWidgetToken(token: string) {
  const widgetToken = await db.query.widgetTokens.findFirst({
    where: and(
      eq(widgetTokens.token, token),
      isNull(widgetTokens.revokedAt)
    ),
  });

  if (!widgetToken) {
    throw new NotFoundError("Widget");
  }

  const agent = await db.query.agents.findFirst({
    where: and(
      eq(agents.id, widgetToken.agentId),
      isNull(agents.deletedAt)
    ),
  });

  if (!agent) {
    throw new NotFoundError("Agent");
  }

  return { widgetToken, agent };
}

// ============================================================================
// Helper: Check Rate Limit
// ============================================================================

async function checkWidgetRateLimit(tenantId: string) {
  // Get tenant quota
  const quota = await db.query.tenantQuotas.findFirst({
    where: eq(tenantQuotas.tenantId, tenantId),
  });

  const limit = quota?.chatRateLimitPerMinute || 60;
  const key = `widget:chat:${tenantId}`;
  
  const result = await checkRateLimit(key, limit, 60);
  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    throw new RateLimitError(retryAfter > 0 ? retryAfter : 60);
  }
}

// ============================================================================
// Get Widget Config (Public)
// ============================================================================

widgetRoutes.get("/:token/config", async (c) => {
  const token = c.req.param("token");
  const { agent } = await validateWidgetToken(token);

  const widgetConfig = await db.query.agentWidgetConfigs.findFirst({
    where: eq(agentWidgetConfigs.agentId, agent.id),
  });

  return c.json({
    agentName: agent.name,
    description: agent.description || "Ask me anything. I'm here to assist you.",
    welcomeMessage: agent.welcomeMessage || "How can I help?",
    logoUrl: agent.logoUrl || null,
    theme: widgetConfig?.theme || {},
    isPublic: widgetConfig?.isPublic ?? true,
  });
});

// ============================================================================
// Widget Chat - Streaming (Public)
// ============================================================================

widgetRoutes.post(
  "/:token/chat",
  zValidator("json", widgetChatSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");

    const { widgetToken, agent } = await validateWidgetToken(token);
    await checkWidgetRateLimit(widgetToken.tenantId);

    // Headers for SSE streaming
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Connection", "keep-alive");

    return streamSSE(c, async (stream) => {
      const service = new SimpleRAGService(widgetToken.tenantId, agent.id);

      for await (const event of service.chat(body.message, body.conversationId)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }
    });
  }
);

// ============================================================================
// Widget Chat - Streaming (Alias for backwards compatibility)
// ============================================================================

widgetRoutes.post(
  "/:token/chat/stream",
  zValidator("json", widgetChatSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");

    const { widgetToken, agent } = await validateWidgetToken(token);
    await checkWidgetRateLimit(widgetToken.tenantId);

    // Headers for SSE streaming
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Connection", "keep-alive");

    return streamSSE(c, async (stream) => {
      const service = new SimpleRAGService(widgetToken.tenantId, agent.id);

      for await (const event of service.chat(body.message, body.conversationId)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }
    });
  }
);
