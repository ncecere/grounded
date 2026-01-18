import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import { withRLSContext, type Database } from "@grounded/db";
import {
  widgetTokens,
  agents,
  tenantQuotas,
} from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { checkRateLimit } from "@grounded/queue";
import { NotFoundError, RateLimitError } from "../middleware/error-handler";
import { SimpleRAGService } from "./simple-rag";
import { AdvancedRAGService } from "./advanced-rag";
import { z } from "zod";
import type { InferSelectModel } from "drizzle-orm";

// ============================================================================
// Validation Schemas
// ============================================================================

export const widgetChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

export type WidgetChatInput = z.infer<typeof widgetChatSchema>;

// ============================================================================
// Types
// ============================================================================

type WidgetToken = InferSelectModel<typeof widgetTokens>;
type Agent = InferSelectModel<typeof agents>;

export interface WidgetTokenValidation {
  widgetToken: WidgetToken;
  agent: Agent;
}

// ============================================================================
// Helper: Validate Widget Token
// ============================================================================

export async function validateWidgetToken(
  tx: Database,
  token: string
): Promise<WidgetTokenValidation> {
  const widgetToken = await tx.query.widgetTokens.findFirst({
    where: and(
      eq(widgetTokens.token, token),
      isNull(widgetTokens.revokedAt)
    ),
  });

  if (!widgetToken) {
    throw new NotFoundError("Widget");
  }

  const agent = await tx.query.agents.findFirst({
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

export async function checkWidgetRateLimit(
  tx: Database,
  tenantId: string
): Promise<void> {
  const quota = await tx.query.tenantQuotas.findFirst({
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
// Helper: Set SSE Headers
// ============================================================================

export function setSSEHeaders(c: Context): void {
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  c.header("Connection", "keep-alive");
}

// ============================================================================
// Shared Streaming Chat Handler
// ============================================================================

export async function handleWidgetChatStream(
  c: Context,
  token: string,
  body: WidgetChatInput
): Promise<Response> {
  // Validate token and check rate limit within RLS context
  const { widgetToken, agent } = await withRLSContext(
    { isSystemAdmin: true },
    async (tx) => {
      const result = await validateWidgetToken(tx, token);
      await checkWidgetRateLimit(tx, result.widgetToken.tenantId);
      return result;
    }
  );

  // Set SSE headers
  setSSEHeaders(c);

  return streamSSE(c, async (stream) => {
    // Route to the appropriate RAG service based on agent configuration
    if (agent.ragType === "advanced") {
      const service = new AdvancedRAGService(widgetToken.tenantId, agent.id, "widget");
      for await (const event of service.chat(body.message, body.conversationId)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }
    } else {
      const service = new SimpleRAGService(widgetToken.tenantId, agent.id);
      for await (const event of service.chat(body.message, body.conversationId)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }
    }
  });
}
