import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import {
  toolDefinitions,
  agentTools,
  agentCapabilities,
  mcpConnections,
  agents,
  type ToolType,
  type ApiToolConfig,
  type McpToolConfig,
  type BuiltinToolConfig,
  type ToolParameter,
} from "@grounded/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { NotFoundError } from "../middleware/error-handler";
import { auditService, extractIpAddress } from "../services/audit";

export const toolRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const toolParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  description: z.string(),
  required: z.boolean().optional(),
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});

const apiToolConfigSchema = z.object({
  baseUrl: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  auth: z.object({
    type: z.enum(["none", "api_key", "bearer", "basic", "custom_header"]),
    headerName: z.string().optional(),
    secret: z.string().optional(),
    username: z.string().optional(),
  }),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().optional(),
  responseFormat: z.enum(["json", "text"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const mcpToolConfigSchema = z.object({
  transport: z.enum(["stdio", "sse", "websocket"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().url().optional(),
  connectionOptions: z.record(z.string(), z.unknown()).optional(),
});

const builtinToolConfigSchema = z.object({
  toolType: z.enum(["multi_kb_router", "calculator", "date_time", "web_search"]),
  options: z.record(z.string(), z.unknown()).optional(),
});

const createToolSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  type: z.enum(["api", "mcp", "builtin"]),
  config: z.union([apiToolConfigSchema, mcpToolConfigSchema, builtinToolConfigSchema]),
  parameters: z.array(toolParameterSchema).optional(),
  isEnabled: z.boolean().optional(),
});

const updateToolSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  config: z.union([apiToolConfigSchema, mcpToolConfigSchema, builtinToolConfigSchema]).optional(),
  parameters: z.array(toolParameterSchema).optional(),
  isEnabled: z.boolean().optional(),
});

const updateCapabilitiesSchema = z.object({
  agenticModeEnabled: z.boolean().optional(),
  multiKbRoutingEnabled: z.boolean().optional(),
  toolCallingEnabled: z.boolean().optional(),
  maxToolCallsPerTurn: z.number().int().min(1).max(20).optional(),
  multiStepReasoningEnabled: z.boolean().optional(),
  maxReasoningSteps: z.number().int().min(1).max(10).optional(),
  showChainOfThought: z.boolean().optional(),
});

const attachToolSchema = z.object({
  toolId: z.string().uuid(),
  isEnabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(1000).optional(),
});

// ============================================================================
// Built-in Tools List (MUST be before /:toolId to avoid route conflicts)
// ============================================================================

toolRoutes.get("/builtin", auth(), async (c) => {
  // Return list of available built-in tools
  const builtinTools = [
    {
      id: "multi_kb_router",
      name: "Multi-KB Router",
      description: "Intelligently routes queries to the most relevant knowledge base",
      type: "builtin" as const,
      configSchema: {
        toolType: "multi_kb_router",
        options: {},
      },
    },
    {
      id: "calculator",
      name: "Calculator",
      description: "Performs mathematical calculations",
      type: "builtin" as const,
      configSchema: {
        toolType: "calculator",
        options: {},
      },
    },
    {
      id: "date_time",
      name: "Date & Time",
      description: "Gets current date, time, and performs date calculations",
      type: "builtin" as const,
      configSchema: {
        toolType: "date_time",
        options: {},
      },
    },
    {
      id: "web_search",
      name: "Web Search",
      description: "Searches the web for real-time information (requires configuration)",
      type: "builtin" as const,
      configSchema: {
        toolType: "web_search",
        options: {
          provider: "google", // or "bing", "serper"
          apiKey: "",
        },
      },
      requiresConfig: true,
    },
  ];

  return c.json({ tools: builtinTools });
});

// ============================================================================
// Tool Definitions CRUD
// ============================================================================

// List all tools for tenant
toolRoutes.get("/", auth(), requireTenant(), async (c) => {
  const authContext = c.get("auth");

  const tools = await withRequestRLS(c, async (tx) => {
    return tx.query.toolDefinitions.findMany({
      where: and(
        eq(toolDefinitions.tenantId, authContext.tenantId!),
        isNull(toolDefinitions.deletedAt)
      ),
      orderBy: (tools, { asc }) => [asc(tools.name)],
    });
  });

  return c.json({ tools });
});

// Get single tool
toolRoutes.get("/:toolId", auth(), requireTenant(), async (c) => {
  const toolId = c.req.param("toolId");
  const authContext = c.get("auth");

  const tool = await withRequestRLS(c, async (tx) => {
    return tx.query.toolDefinitions.findFirst({
      where: and(
        eq(toolDefinitions.id, toolId),
        eq(toolDefinitions.tenantId, authContext.tenantId!),
        isNull(toolDefinitions.deletedAt)
      ),
    });
  });

  if (!tool) {
    throw new NotFoundError("Tool");
  }

  return c.json({ tool });
});

// Create tool
toolRoutes.post(
  "/",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createToolSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const [tool] = await withRequestRLS(c, async (tx) => {
      return tx
        .insert(toolDefinitions)
        .values({
          tenantId: authContext.tenantId!,
          name: body.name,
          description: body.description,
          type: body.type as ToolType,
          config: body.config as ApiToolConfig | McpToolConfig | BuiltinToolConfig,
          parameters: (body.parameters || []) as ToolParameter[],
          isEnabled: body.isEnabled ?? true,
          createdBy: authContext.user.id,
        })
        .returning();
    });

    await auditService.logSuccess("api_key.created", "api_key", {
      actorId: authContext.user.id,
      tenantId: authContext.tenantId!,
      ipAddress: extractIpAddress(c.req.raw.headers),
    }, {
      resourceId: tool.id,
      resourceName: tool.name,
      metadata: { type: tool.type },
    });

    return c.json({ tool }, 201);
  }
);

// Update tool
toolRoutes.patch(
  "/:toolId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateToolSchema),
  async (c) => {
    const toolId = c.req.param("toolId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const [tool] = await withRequestRLS(c, async (tx) => {
      return tx
        .update(toolDefinitions)
        .set({
          ...body,
          config: body.config as ApiToolConfig | McpToolConfig | BuiltinToolConfig | undefined,
          parameters: body.parameters as ToolParameter[] | undefined,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(toolDefinitions.id, toolId),
            eq(toolDefinitions.tenantId, authContext.tenantId!),
            isNull(toolDefinitions.deletedAt)
          )
        )
        .returning();
    });

    if (!tool) {
      throw new NotFoundError("Tool");
    }

    return c.json({ tool });
  }
);

// Delete tool
toolRoutes.delete(
  "/:toolId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const toolId = c.req.param("toolId");
    const authContext = c.get("auth");

    const [tool] = await withRequestRLS(c, async (tx) => {
      return tx
        .update(toolDefinitions)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(toolDefinitions.id, toolId),
            eq(toolDefinitions.tenantId, authContext.tenantId!),
            isNull(toolDefinitions.deletedAt)
          )
        )
        .returning();
    });

    if (!tool) {
      throw new NotFoundError("Tool");
    }

    return c.json({ message: "Tool deleted" });
  }
);

// ============================================================================
// Agent Capabilities
// ============================================================================

// Get agent capabilities
toolRoutes.get("/agents/:agentId/capabilities", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const { agent, capabilities } = await withRequestRLS(c, async (tx) => {
    // Verify agent belongs to tenant
    const agent = await tx.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      return { agent: null, capabilities: null };
    }

    // Get or create capabilities
    let capabilities = await tx.query.agentCapabilities.findFirst({
      where: eq(agentCapabilities.agentId, agentId),
    });

    if (!capabilities) {
      // Create default capabilities
      [capabilities] = await tx
        .insert(agentCapabilities)
        .values({ agentId })
        .returning();
    }

    return { agent, capabilities };
  });

  if (!agent) {
    throw new NotFoundError("Agent");
  }

  return c.json({ capabilities });
});

// Update agent capabilities
toolRoutes.put(
  "/agents/:agentId/capabilities",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateCapabilitiesSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const { agent, capabilities } = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        return { agent: null, capabilities: null };
      }

      // Upsert capabilities
      const existing = await tx.query.agentCapabilities.findFirst({
        where: eq(agentCapabilities.agentId, agentId),
      });

      let capabilities;
      if (existing) {
        [capabilities] = await tx
          .update(agentCapabilities)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(agentCapabilities.agentId, agentId))
          .returning();
      } else {
        [capabilities] = await tx
          .insert(agentCapabilities)
          .values({ agentId, ...body })
          .returning();
      }

      return { agent, capabilities };
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    await auditService.logSuccess("agent.updated", "agent", {
      actorId: authContext.user.id,
      tenantId: authContext.tenantId!,
      ipAddress: extractIpAddress(c.req.raw.headers),
    }, {
      resourceId: agentId,
      resourceName: agent.name,
      metadata: { updatedCapabilities: Object.keys(body) },
    });

    return c.json({ capabilities });
  }
);

// ============================================================================
// Agent Tools (attach/detach tools to agents)
// ============================================================================

// List tools attached to agent
toolRoutes.get("/agents/:agentId/tools", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const { agent, attachedTools } = await withRequestRLS(c, async (tx) => {
    // Verify agent belongs to tenant
    const agent = await tx.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      return { agent: null, attachedTools: [] };
    }

    // Get attached tools with tool details
    const attachedTools = await tx
      .select({
        id: agentTools.id,
        toolId: agentTools.toolId,
        isEnabled: agentTools.isEnabled,
        priority: agentTools.priority,
        createdAt: agentTools.createdAt,
        tool: {
          id: toolDefinitions.id,
          name: toolDefinitions.name,
          description: toolDefinitions.description,
          type: toolDefinitions.type,
          isEnabled: toolDefinitions.isEnabled,
        },
      })
      .from(agentTools)
      .innerJoin(toolDefinitions, eq(toolDefinitions.id, agentTools.toolId))
      .where(
        and(
          eq(agentTools.agentId, agentId),
          isNull(agentTools.deletedAt),
          isNull(toolDefinitions.deletedAt)
        )
      );

    return { agent, attachedTools };
  });

  if (!agent) {
    throw new NotFoundError("Agent");
  }

  return c.json({ tools: attachedTools });
});

// Attach tool to agent
toolRoutes.post(
  "/agents/:agentId/tools",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", attachToolSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const { agent, tool, agentTool, isNew } = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        return { agent: null, tool: null, agentTool: null, isNew: false };
      }

      // Verify tool belongs to tenant
      const tool = await tx.query.toolDefinitions.findFirst({
        where: and(
          eq(toolDefinitions.id, body.toolId),
          eq(toolDefinitions.tenantId, authContext.tenantId!),
          isNull(toolDefinitions.deletedAt)
        ),
      });

      if (!tool) {
        return { agent, tool: null, agentTool: null, isNew: false };
      }

      // Check if already attached
      const existing = await tx.query.agentTools.findFirst({
        where: and(
          eq(agentTools.agentId, agentId),
          eq(agentTools.toolId, body.toolId),
          isNull(agentTools.deletedAt)
        ),
      });

      if (existing) {
        // Update existing
        const [updated] = await tx
          .update(agentTools)
          .set({
            isEnabled: body.isEnabled ?? existing.isEnabled,
            priority: body.priority ?? existing.priority,
          })
          .where(eq(agentTools.id, existing.id))
          .returning();

        return { agent, tool, agentTool: updated, isNew: false };
      }

      // Create new attachment
      const [newAgentTool] = await tx
        .insert(agentTools)
        .values({
          agentId,
          toolId: body.toolId,
          isEnabled: body.isEnabled ?? true,
          priority: body.priority ?? 100,
        })
        .returning();

      return { agent, tool, agentTool: newAgentTool, isNew: true };
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    if (!tool) {
      throw new NotFoundError("Tool");
    }

    return c.json({ agentTool }, isNew ? 201 : 200);
  }
);

// Detach tool from agent
toolRoutes.delete(
  "/agents/:agentId/tools/:toolId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const agentId = c.req.param("agentId");
    const toolId = c.req.param("toolId");
    const authContext = c.get("auth");

    const { agent, deleted } = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        return { agent: null, deleted: null };
      }

      const [deleted] = await tx
        .update(agentTools)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(agentTools.agentId, agentId),
            eq(agentTools.toolId, toolId),
            isNull(agentTools.deletedAt)
          )
        )
        .returning();

      return { agent, deleted };
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    if (!deleted) {
      throw new NotFoundError("Agent tool attachment");
    }

    return c.json({ message: "Tool detached from agent" });
  }
);
