import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { withRLSContext } from "@grounded/db";
import {
  validateWidgetToken,
  handleWidgetChatStream,
} from "../services/widget-chat-helpers";
import { widgetChatSchema } from "../modules/widget/schema";
import { enforcePublicAccessPolicy } from "../services/public-access-policy";

export const widgetRoutes = new Hono();

// ============================================================================
// Get Widget Config (Public)
// ============================================================================

widgetRoutes.get("/:token/config", async (c) => {
  const token = c.req.param("token");

  return withRLSContext({ isSystemAdmin: true }, async (tx) => {
    const { agent, widgetConfig } = await validateWidgetToken(tx, token);
    const accessDenied = await enforcePublicAccessPolicy(c, {
      isPublic: widgetConfig?.isPublic ?? true,
      allowedDomains: widgetConfig?.allowedDomains ?? [],
      oidcRequired: widgetConfig?.oidcRequired ?? false,
      requiredTenantId: agent.tenantId,
    });
    if (accessDenied) return accessDenied;

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
