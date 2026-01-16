import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { auth, requireTenant } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { SimpleRAGService } from "../services/simple-rag";

export const chatRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

// ============================================================================
// Simple RAG Streaming Chat Endpoint
// ============================================================================

chatRoutes.post(
  "/simple/:agentId",
  auth(),
  requireTenant(),
  rateLimit({ keyPrefix: "chat", limit: 60, windowSeconds: 60 }),
  zValidator("json", chatSchema),
  async (c) => {
    const authContext = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = c.req.valid("json");

    // Headers for SSE streaming
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Connection", "keep-alive");

    return streamSSE(c, async (stream) => {
      const service = new SimpleRAGService(authContext.tenantId!, agentId);

      for await (const event of service.chat(body.message, body.conversationId)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }
    });
  }
);
