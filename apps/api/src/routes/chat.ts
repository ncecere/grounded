import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { auth, requireTenant, withRequestRLS } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { SimpleRAGService } from "../services/simple-rag";
import { AdvancedRAGService } from "../services/advanced-rag";
import { log } from "@grounded/logger";
import { getChatAgentRagType } from "../modules/chat/service";
import { chatSchema } from "../modules/chat/schema";
import { streamWithHeartbeat } from "../services/sse-stream";

export const chatRoutes = new Hono();

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

    // Fetch agent to determine RAG type
    const ragType = await withRequestRLS(c, (tx) =>
      getChatAgentRagType(tx, {
        agentId,
        tenantId: authContext.tenantId!,
      })
    );

    if (!ragType) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return streamWithHeartbeat(c, {
      onStream: async (controller) => {
        try {
          // Route to the appropriate RAG service based on agent configuration
          if (ragType === "advanced") {
            const service = new AdvancedRAGService(authContext.tenantId!, agentId, "admin_ui");
            for await (const event of service.chat(body.message, body.conversationId)) {
              if (controller.isAborted()) break;
              await controller.writeJson(event);
            }
          } else {
            const service = new SimpleRAGService(authContext.tenantId!, agentId);
            for await (const event of service.chat(body.message, body.conversationId)) {
              if (controller.isAborted()) break;
              await controller.writeJson(event);
            }
          }
        } catch (error) {
          log.error("api", "Admin chat stream error", {
            error: error instanceof Error ? error.message : String(error),
          });
          if (!controller.isAborted()) {
            await controller.writeJson({
              type: "error",
              message: "An error occurred while generating the response.",
            });
          }
        }
      },
    });
  }
);
