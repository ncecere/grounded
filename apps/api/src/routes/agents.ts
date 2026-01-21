import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { auditService, buildAuditContext } from "../services/audit";
import * as agentService from "../modules/agents/service";
import {
  createAgentSchema,
  updateAgentSchema,
  updateKbsSchema,
  updateRetrievalConfigSchema,
  updateWidgetConfigSchema,
  createChatEndpointSchema,
  createWidgetTokenSchema,
} from "../modules/agents/schema";

export const agentRoutes = new Hono();

// ============================================================================
// List Available LLM Models
// ============================================================================

agentRoutes.get("/models", auth(), requireTenant(), async (c) => {
  const models = await withRequestRLS(c, (tx) => agentService.listModels(tx));

  return c.json({ models });
});

// ============================================================================
// List Agents
// ============================================================================

agentRoutes.get("/", auth(), requireTenant(), async (c) => {
  const authContext = c.get("auth");

  const agentsWithKbs = await withRequestRLS(c, (tx) =>
    agentService.listAgentsWithKbs(tx, authContext.tenantId!)
  );

  return c.json({ agents: agentsWithKbs });
});

// ============================================================================
// Create Agent
// ============================================================================

agentRoutes.post(
  "/",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createAgentSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const { agent, kbIds } = await withRequestRLS(c, (tx) =>
      agentService.createAgent(tx, {
        tenantId: authContext.tenantId!,
        userId: authContext.user.id,
        body,
      })
    );

    // Audit log - agent created
    const auditContext = buildAuditContext({ authContext, headers: c.req.raw.headers });

    await auditService.logSuccess("agent.created", "agent", auditContext, {
      resourceId: agent.id,
      resourceName: agent.name,
      metadata: { kbIds },
    });

    return c.json({ agent: { ...agent, kbIds } }, 201);
  }
);

// ============================================================================
// Get Agent
// ============================================================================

agentRoutes.get("/:agentId", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const result = await withRequestRLS(c, (tx) =>
    agentService.getAgentDetails(tx, {
      agentId,
      tenantId: authContext.tenantId!,
    })
  );

  return c.json({
    agent: result.agent,
    knowledgeBases: result.attachedKbs,
  });
});

// ============================================================================
// Update Agent
// ============================================================================

agentRoutes.patch(
  "/:agentId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateAgentSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    // Extract kbIds from body - handle separately
    const { kbIds, ...agentData } = body;

    const agent = await withRequestRLS(c, (tx) =>
      agentService.updateAgent(tx, {
        agentId,
        tenantId: authContext.tenantId!,
        body,
      })
    );

    // Audit log - agent updated
    const auditContext = buildAuditContext({ authContext, headers: c.req.raw.headers });

    await auditService.logSuccess("agent.updated", "agent", auditContext, {
      resourceId: agent.id,
      resourceName: agent.name,
      metadata: { updatedFields: Object.keys(body) },
    });

    return c.json({ agent });
  }
);

// ============================================================================
// Delete Agent
// ============================================================================

agentRoutes.delete(
  "/:agentId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");

    const agent = await withRequestRLS(c, (tx) =>
      agentService.deleteAgent(tx, {
        agentId,
        tenantId: authContext.tenantId!,
      })
    );

    // Audit log - agent deleted
    const auditContext = buildAuditContext({ authContext, headers: c.req.raw.headers });

    await auditService.logSuccess("agent.deleted", "agent", auditContext, {
      resourceId: agent.id,
      resourceName: agent.name,
    });

    return c.json({ message: "Agent scheduled for deletion" });
  }
);

// ============================================================================
// Get Agent KBs
// ============================================================================

agentRoutes.get("/:agentId/kbs", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const kbs = await withRequestRLS(c, (tx) =>
    agentService.getAgentKbs(tx, {
      agentId,
      tenantId: authContext.tenantId!,
    })
  );

  return c.json({ knowledgeBases: kbs });
});

// ============================================================================
// Update Agent KBs
// ============================================================================

agentRoutes.put(
  "/:agentId/kbs",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateKbsSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    await withRequestRLS(c, (tx) =>
      agentService.updateAgentKbs(tx, {
        agentId,
        tenantId: authContext.tenantId!,
        body,
      })
    );

    return c.json({ message: "Knowledge bases updated" });
  }
);

// ============================================================================
// Get Retrieval Config
// ============================================================================

agentRoutes.get(
  "/:agentId/retrieval-config",
  auth(),
  requireTenant(),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");

    const config = await withRequestRLS(c, (tx) =>
      agentService.getRetrievalConfig(tx, {
        agentId,
        tenantId: authContext.tenantId!,
      })
    );

    return c.json({ retrievalConfig: config });
  }
);

// ============================================================================
// Update Retrieval Config
// ============================================================================

agentRoutes.put(
  "/:agentId/retrieval-config",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateRetrievalConfigSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const config = await withRequestRLS(c, (tx) =>
      agentService.updateRetrievalConfig(tx, {
        agentId,
        tenantId: authContext.tenantId!,
        body,
      })
    );

    return c.json({ retrievalConfig: config });
  }
);

// ============================================================================
// Get Widget Config
// ============================================================================

agentRoutes.get("/:agentId/widget", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const result = await withRequestRLS(c, (tx) =>
    agentService.getWidgetConfig(tx, {
      agentId,
      tenantId: authContext.tenantId!,
      userId: authContext.user.id,
    })
  );

  return c.json({
    widgetConfig: result.config,
    tokens: result.tokens.map((t) => ({
      id: t.id,
      name: t.name,
      token: t.token,
      createdAt: t.createdAt,
    })),
  });
});

// ============================================================================
// Update Widget Config
// ============================================================================

agentRoutes.put(
  "/:agentId/widget",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateWidgetConfigSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const config = await withRequestRLS(c, (tx) =>
      agentService.updateWidgetConfig(tx, {
        agentId,
        tenantId: authContext.tenantId!,
        body,
      })
    );

    return c.json({ widgetConfig: config });
  }
);

// ============================================================================
// Get or Create Widget Token (convenience endpoint)
// ============================================================================

agentRoutes.get("/:agentId/widget-token", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const token = await withRequestRLS(c, (tx) =>
    agentService.getWidgetToken(tx, {
      agentId,
      tenantId: authContext.tenantId!,
      userId: authContext.user.id,
    })
  );

  return c.json({ token });
});

// ============================================================================
// Create Widget Token
// ============================================================================

agentRoutes.post(
  "/:agentId/widget/tokens",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createWidgetTokenSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const widgetToken = await withRequestRLS(c, (tx) =>
      agentService.createWidgetToken(tx, {
        agentId,
        tenantId: authContext.tenantId!,
        userId: authContext.user.id,
        body,
      })
    );

    return c.json({ token: widgetToken }, 201);
  }
);

// ============================================================================
// Revoke Widget Token
// ============================================================================

agentRoutes.delete(
  "/:agentId/widget/tokens/:tokenId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const agentId = c.req.param("agentId");
    const tokenId = c.req.param("tokenId");
    const authContext = c.get("auth");

    await withRequestRLS(c, (tx) =>
      agentService.revokeWidgetToken(tx, {
        tokenId,
        agentId,
        tenantId: authContext.tenantId!,
      })
    );

    return c.json({ message: "Token revoked" });
  }
);

// ============================================================================
// List Chat Endpoints
// ============================================================================

agentRoutes.get("/:agentId/chat-endpoints", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const endpoints = await withRequestRLS(c, (tx) =>
    agentService.listChatEndpoints(tx, {
      agentId,
      tenantId: authContext.tenantId!,
    })
  );

  return c.json({
    chatEndpoints: endpoints.map((ep) => ({
      id: ep.id,
      name: ep.name,
      token: ep.token,
      endpointType: ep.endpointType,
      createdAt: ep.createdAt,
    })),
  });
});

// ============================================================================
// Create Chat Endpoint
// ============================================================================

agentRoutes.post(
  "/:agentId/chat-endpoints",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createChatEndpointSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const chatEndpoint = await withRequestRLS(c, (tx) =>
      agentService.createChatEndpoint(tx, {
        agentId,
        tenantId: authContext.tenantId!,
        userId: authContext.user.id,
        body,
      })
    );

    return c.json({ chatEndpoint }, 201);
  }
);

// ============================================================================
// Revoke Chat Endpoint
// ============================================================================

agentRoutes.delete(
  "/:agentId/chat-endpoints/:endpointId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const agentId = c.req.param("agentId");
    const endpointId = c.req.param("endpointId");
    const authContext = c.get("auth");

    await withRequestRLS(c, (tx) =>
      agentService.revokeChatEndpoint(tx, {
        endpointId,
        agentId,
        tenantId: authContext.tenantId!,
      })
    );

    return c.json({ message: "Chat endpoint revoked" });
  }
);
