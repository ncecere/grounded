import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, type Database } from "@grounded/db";
import {
  agents,
  agentKbs,
  agentWidgetConfigs,
  retrievalConfigs,
  widgetTokens,
  chatEndpointTokens,
  knowledgeBases,
  tenantQuotas,
  modelConfigurations,
  modelProviders,
} from "@grounded/db/schema";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { widgetThemeSchema, generateId } from "@grounded/shared";
import { log } from "@grounded/logger";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { NotFoundError, QuotaExceededError, ForbiddenError } from "../middleware/error-handler";
import { auditService, extractIpAddress } from "../services/audit";

export const agentRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  welcomeMessage: z.string().max(200).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  rerankerEnabled: z.boolean().default(true),
  citationsEnabled: z.boolean().default(true),
  kbIds: z.array(z.string().uuid()).optional(),
  llmModelConfigId: z.string().uuid().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  welcomeMessage: z.string().max(200).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  rerankerEnabled: z.boolean().optional(),
  citationsEnabled: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  llmModelConfigId: z.string().uuid().nullable().optional(),
  kbIds: z.array(z.string().uuid()).optional(),
});

const updateKbsSchema = z.object({
  kbIds: z.array(z.string().uuid()),
});

const updateRetrievalConfigSchema = z.object({
  topK: z.number().int().min(1).max(50).optional(),
  candidateK: z.number().int().min(1).max(200).optional(),
  maxCitations: z.number().int().min(1).max(20).optional(),
  rerankerEnabled: z.boolean().optional(),
  rerankerType: z.enum(["heuristic", "cross_encoder"]).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
});

const updateWidgetConfigSchema = z.object({
  isPublic: z.boolean().optional(),
  allowedDomains: z.array(z.string()).optional(),
  oidcRequired: z.boolean().optional(),
  theme: widgetThemeSchema.partial().optional(),
});

const createChatEndpointSchema = z.object({
  name: z.string().max(100).optional(),
  endpointType: z.enum(["api", "hosted"]).default("api"),
});

// ============================================================================
// List Available LLM Models
// ============================================================================

agentRoutes.get("/models", auth(), requireTenant(), async (c) => {
  // Get all enabled chat models with their provider info
  const models = await withRequestRLS(c, async (tx) => {
    return tx
      .select({
        id: modelConfigurations.id,
        modelId: modelConfigurations.modelId,
        displayName: modelConfigurations.displayName,
        providerName: modelProviders.displayName,
        isDefault: modelConfigurations.isDefault,
      })
      .from(modelConfigurations)
      .innerJoin(modelProviders, eq(modelProviders.id, modelConfigurations.providerId))
      .where(
        and(
          eq(modelConfigurations.modelType, "chat"),
          eq(modelConfigurations.isEnabled, true),
          eq(modelProviders.isEnabled, true)
        )
      )
      .orderBy(modelConfigurations.isDefault, modelConfigurations.displayName);
  });

  return c.json({ models });
});

// ============================================================================
// List Agents
// ============================================================================

agentRoutes.get("/", auth(), requireTenant(), async (c) => {
  const authContext = c.get("auth");

  const agentsWithKbs = await withRequestRLS(c, async (tx) => {
    const agentsList = await tx.query.agents.findMany({
      where: and(
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    // Get kbIds for each agent
    return Promise.all(
      agentsList.map(async (agent) => {
        const kbs = await tx
          .select({ kbId: agentKbs.kbId })
          .from(agentKbs)
          .where(and(eq(agentKbs.agentId, agent.id), isNull(agentKbs.deletedAt)));
        return {
          ...agent,
          kbIds: kbs.map((kb) => kb.kbId),
        };
      })
    );
  });

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

    const agent = await withRequestRLS(c, async (tx) => {
      // Check quota
      const quotas = await tx.query.tenantQuotas.findFirst({
        where: eq(tenantQuotas.tenantId, authContext.tenantId!),
      });

      const agentCount = await tx
        .select({ count: sql<number>`count(*)` })
        .from(agents)
        .where(
          and(
            eq(agents.tenantId, authContext.tenantId!),
            isNull(agents.deletedAt)
          )
        );

      if (quotas && agentCount[0].count >= quotas.maxAgents) {
        throw new QuotaExceededError("agents");
      }

      // Create agent
      const [newAgent] = await tx
        .insert(agents)
        .values({
          tenantId: authContext.tenantId!,
          name: body.name,
          systemPrompt: body.systemPrompt,
          rerankerEnabled: body.rerankerEnabled,
          citationsEnabled: body.citationsEnabled,
          llmModelConfigId: body.llmModelConfigId,
          createdBy: authContext.user.id,
        })
        .returning();

      // Create default retrieval config
      await tx.insert(retrievalConfigs).values({
        agentId: newAgent.id,
      });

      // Create default widget config
      await tx.insert(agentWidgetConfigs).values({
        agentId: newAgent.id,
      });

      // Create default widget token
      const token = `wt_${generateId().replace(/-/g, "")}`;
      await tx.insert(widgetTokens).values({
        tenantId: authContext.tenantId!,
        agentId: newAgent.id,
        token,
        name: "Default",
        createdBy: authContext.user.id,
      });

      // Attach KBs if provided
      if (body.kbIds && body.kbIds.length > 0) {
        await attachKbs(tx, authContext.tenantId!, newAgent.id, body.kbIds);
      }

      return newAgent;
    });

    // Audit log - agent created
    await auditService.logSuccess("agent.created", "agent", {
      actorId: authContext.user.id,
      tenantId: authContext.tenantId!,
      ipAddress: extractIpAddress(c.req.raw.headers),
    }, {
      resourceId: agent.id,
      resourceName: agent.name,
      metadata: { kbIds: body.kbIds || [] },
    });

    return c.json({ agent: { ...agent, kbIds: body.kbIds || [] } }, 201);
  }
);

// ============================================================================
// Get Agent
// ============================================================================

agentRoutes.get("/:agentId", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const result = await withRequestRLS(c, async (tx) => {
    const agent = await tx.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    // Get attached KBs
    const attachedKbs = await tx
      .select({ kbId: agentKbs.kbId, name: knowledgeBases.name })
      .from(agentKbs)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, agentKbs.kbId))
      .where(and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)));

    return { agent, attachedKbs };
  });

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

    const agent = await withRequestRLS(c, async (tx) => {
      const [updatedAgent] = await tx
        .update(agents)
        .set(agentData)
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.tenantId, authContext.tenantId!),
            isNull(agents.deletedAt)
          )
        )
        .returning();

      if (!updatedAgent) {
        throw new NotFoundError("Agent");
      }

      // Update KBs if provided
      if (kbIds !== undefined) {
        // Soft delete existing attachments
        await tx
          .update(agentKbs)
          .set({ deletedAt: new Date() })
          .where(and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)));

        // Attach new KBs
        if (kbIds.length > 0) {
          await attachKbs(tx, authContext.tenantId!, agentId, kbIds);
        }
      }

      return updatedAgent;
    });

    // Audit log - agent updated
    await auditService.logSuccess("agent.updated", "agent", {
      actorId: authContext.user.id,
      tenantId: authContext.tenantId!,
      ipAddress: extractIpAddress(c.req.raw.headers),
    }, {
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

    const agent = await withRequestRLS(c, async (tx) => {
      const [deletedAgent] = await tx
        .update(agents)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.tenantId, authContext.tenantId!),
            isNull(agents.deletedAt)
          )
        )
        .returning();

      if (!deletedAgent) {
        throw new NotFoundError("Agent");
      }

      return deletedAgent;
    });

    // Audit log - agent deleted
    await auditService.logSuccess("agent.deleted", "agent", {
      actorId: authContext.user.id,
      tenantId: authContext.tenantId!,
      ipAddress: extractIpAddress(c.req.raw.headers),
    }, {
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

  const kbs = await withRequestRLS(c, async (tx) => {
    // Verify agent belongs to tenant
    const agent = await tx.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    return tx
      .select({
        id: knowledgeBases.id,
        name: knowledgeBases.name,
        description: knowledgeBases.description,
        isGlobal: knowledgeBases.isGlobal,
      })
      .from(agentKbs)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, agentKbs.kbId))
      .where(and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)));
  });

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

    await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      // Soft delete existing attachments
      await tx
        .update(agentKbs)
        .set({ deletedAt: new Date() })
        .where(and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)));

      // Attach new KBs
      if (body.kbIds.length > 0) {
        await attachKbs(tx, authContext.tenantId!, agentId, body.kbIds);
      }
    });

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

    const config = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      return tx.query.retrievalConfigs.findFirst({
        where: eq(retrievalConfigs.agentId, agentId),
      });
    });

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

    const config = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      const [updatedConfig] = await tx
        .update(retrievalConfigs)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(retrievalConfigs.agentId, agentId))
        .returning();

      return updatedConfig;
    });

    return c.json({ retrievalConfig: config });
  }
);

// ============================================================================
// Get Widget Config
// ============================================================================

agentRoutes.get("/:agentId/widget", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const result = await withRequestRLS(c, async (tx) => {
    // Verify agent belongs to tenant
    const agent = await tx.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    const config = await tx.query.agentWidgetConfigs.findFirst({
      where: eq(agentWidgetConfigs.agentId, agentId),
    });

    // Get widget tokens
    let tokens = await tx.query.widgetTokens.findMany({
      where: and(
        eq(widgetTokens.agentId, agentId),
        isNull(widgetTokens.revokedAt)
      ),
    });

    // Auto-create a token if none exists (for existing agents without tokens)
    if (tokens.length === 0) {
      const newToken = `wt_${generateId().replace(/-/g, "")}`;
      const [created] = await tx.insert(widgetTokens).values({
        tenantId: authContext.tenantId!,
        agentId,
        token: newToken,
        name: "Default",
        createdBy: authContext.user.id,
      }).returning();
      tokens = [created];
    }

    return { config, tokens };
  });

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

    const config = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      const existing = await tx.query.agentWidgetConfigs.findFirst({
        where: eq(agentWidgetConfigs.agentId, agentId),
      });

      const updateData: any = { updatedAt: new Date() };
      if (body.isPublic !== undefined) updateData.isPublic = body.isPublic;
      if (body.allowedDomains) updateData.allowedDomains = body.allowedDomains;
      if (body.oidcRequired !== undefined) updateData.oidcRequired = body.oidcRequired;
      if (body.theme && existing) {
        log.debug("api", "Widget config theme update", {
          receivedTheme: body.theme,
          existingTheme: existing.theme,
        });
        updateData.theme = { ...existing.theme, ...body.theme };
        log.debug("api", "Widget config merged theme", { mergedTheme: updateData.theme });
      }

      const [updatedConfig] = await tx
        .update(agentWidgetConfigs)
        .set(updateData)
        .where(eq(agentWidgetConfigs.agentId, agentId))
        .returning();

      return updatedConfig;
    });

    return c.json({ widgetConfig: config });
  }
);

// ============================================================================
// Get or Create Widget Token (convenience endpoint)
// ============================================================================

agentRoutes.get("/:agentId/widget-token", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const token = await withRequestRLS(c, async (tx) => {
    // Verify agent belongs to tenant
    const agent = await tx.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    // Check for existing token
    const existingToken = await tx.query.widgetTokens.findFirst({
      where: and(
        eq(widgetTokens.agentId, agentId),
        isNull(widgetTokens.revokedAt)
      ),
    });

    if (existingToken) {
      return existingToken.token;
    }

    // Create new token if none exists
    const newToken = `wt_${generateId().replace(/-/g, "")}`;

    await tx.insert(widgetTokens).values({
      tenantId: authContext.tenantId!,
      agentId,
      token: newToken,
      name: "Default",
      createdBy: authContext.user.id,
    });

    return newToken;
  });

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
  zValidator("json", z.object({ name: z.string().optional() })),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const widgetToken = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      const token = `wt_${generateId().replace(/-/g, "")}`;

      const [newToken] = await tx
        .insert(widgetTokens)
        .values({
          tenantId: authContext.tenantId!,
          agentId,
          token,
          name: body.name,
          createdBy: authContext.user.id,
        })
        .returning();

      return newToken;
    });

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

    const token = await withRequestRLS(c, async (tx) => {
      const [revokedToken] = await tx
        .update(widgetTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(widgetTokens.id, tokenId),
            eq(widgetTokens.agentId, agentId),
            eq(widgetTokens.tenantId, authContext.tenantId!),
            isNull(widgetTokens.revokedAt)
          )
        )
        .returning();

      if (!revokedToken) {
        throw new NotFoundError("Widget token");
      }

      return revokedToken;
    });

    return c.json({ message: "Token revoked" });
  }
);

// ============================================================================
// List Chat Endpoints
// ============================================================================

agentRoutes.get("/:agentId/chat-endpoints", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const endpoints = await withRequestRLS(c, async (tx) => {
    // Verify agent belongs to tenant
    const agent = await tx.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    return tx.query.chatEndpointTokens.findMany({
      where: and(
        eq(chatEndpointTokens.agentId, agentId),
        isNull(chatEndpointTokens.revokedAt)
      ),
    });
  });

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

    const chatEndpoint = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      // Generate token with prefix based on type
      const prefix = body.endpointType === "hosted" ? "ch_" : "ce_";
      const token = `${prefix}${generateId().replace(/-/g, "")}`;

      const [newEndpoint] = await tx
        .insert(chatEndpointTokens)
        .values({
          tenantId: authContext.tenantId!,
          agentId,
          token,
          name: body.name,
          endpointType: body.endpointType,
          createdBy: authContext.user.id,
        })
        .returning();

      return newEndpoint;
    });

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

    const endpoint = await withRequestRLS(c, async (tx) => {
      const [revokedEndpoint] = await tx
        .update(chatEndpointTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(chatEndpointTokens.id, endpointId),
            eq(chatEndpointTokens.agentId, agentId),
            eq(chatEndpointTokens.tenantId, authContext.tenantId!),
            isNull(chatEndpointTokens.revokedAt)
          )
        )
        .returning();

      if (!revokedEndpoint) {
        throw new NotFoundError("Chat endpoint");
      }

      return revokedEndpoint;
    });

    return c.json({ message: "Chat endpoint revoked" });
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

async function attachKbs(
  tx: Database,
  tenantId: string,
  agentId: string,
  kbIds: string[]
): Promise<void> {
  // Verify all KBs are accessible
  const accessibleKbs = await tx.query.knowledgeBases.findMany({
    where: and(
      inArray(knowledgeBases.id, kbIds),
      isNull(knowledgeBases.deletedAt)
    ),
  });

  const accessibleKbIds = new Set(
    accessibleKbs
      .filter((kb) => kb.tenantId === tenantId || (kb.isGlobal && kb.publishedAt))
      .map((kb) => kb.id)
  );

  const validKbIds = kbIds.filter((id) => accessibleKbIds.has(id));

  if (validKbIds.length > 0) {
    await tx.insert(agentKbs).values(
      validKbIds.map((kbId) => ({
        agentId,
        kbId,
      }))
    );
  }
}
