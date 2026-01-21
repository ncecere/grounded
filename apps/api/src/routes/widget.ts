import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { withRLSContext } from "@grounded/db";
import { agentWidgetConfigs } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import {
  validateWidgetToken,
  handleWidgetChatStream,
} from "../services/widget-chat-helpers";
import { widgetChatSchema } from "../modules/widget/schema";

export const widgetRoutes = new Hono();

// ============================================================================
// Get Widget Config (Public)
// ============================================================================

widgetRoutes.get("/:token/config", async (c) => {
  const token = c.req.param("token");

  return withRLSContext({ isSystemAdmin: true }, async (tx) => {
    const { agent } = await validateWidgetToken(tx, token);

    const widgetConfig = await tx.query.agentWidgetConfigs.findFirst({
      where: eq(agentWidgetConfigs.agentId, agent.id),
    });

    return c.json({
      agentName: agent.name,
      description: agent.description || "Ask me anything. I'm here to assist you.",
      welcomeMessage: agent.welcomeMessage || "How can I help?",
      logoUrl: agent.logoUrl || null,
      theme: widgetConfig?.theme || {},
      isPublic: widgetConfig?.isPublic ?? true,
      ragType: agent.ragType,
      showReasoningSteps: agent.showReasoningSteps,
    });
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
    return handleWidgetChatStream(c, token, body);
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
    return handleWidgetChatStream(c, token, body);
  }
);
