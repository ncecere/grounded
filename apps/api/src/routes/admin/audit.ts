import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import { users, tenants } from "@grounded/db/schema";
import { eq, inArray } from "drizzle-orm";
import { auth, requireSystemAdmin } from "../../middleware/auth";
import { auditService, type AuditQueryOptions } from "../../services/audit";

export const adminAuditRoutes = new Hono();

// All routes require system admin
adminAuditRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// Validation Schemas
// ============================================================================

const querySchema = z.object({
  tenantId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ============================================================================
// List Audit Logs
// ============================================================================

adminAuditRoutes.get("/", zValidator("query", querySchema), async (c) => {
  const query = c.req.valid("query");

  const options: AuditQueryOptions = {
    tenantId: query.tenantId,
    actorId: query.actorId,
    action: query.action as AuditQueryOptions["action"],
    resourceType: query.resourceType as AuditQueryOptions["resourceType"],
    resourceId: query.resourceId,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  };

  const result = await auditService.query(options);

  // Enrich logs with actor and tenant names
  const actorIds = [...new Set(result.logs.map((l) => l.actorId).filter(Boolean))] as string[];
  const tenantIds = [...new Set(result.logs.map((l) => l.tenantId).filter(Boolean))] as string[];

  const [actorsList, tenantsList] = await Promise.all([
    actorIds.length > 0
      ? db
          .select({ id: users.id, email: users.primaryEmail })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [],
    tenantIds.length > 0
      ? db
          .select({ id: tenants.id, name: tenants.name })
          .from(tenants)
          .where(inArray(tenants.id, tenantIds))
      : [],
  ]);

  const actorMap = new Map(actorsList.map((a) => [a.id, a.email]));
  const tenantMap = new Map(tenantsList.map((t) => [t.id, t.name]));

  const enrichedLogs = result.logs.map((log) => ({
    ...log,
    actorEmail: log.actorId ? actorMap.get(log.actorId) || null : null,
    tenantName: log.tenantId ? tenantMap.get(log.tenantId) || null : null,
  }));

  return c.json({
    logs: enrichedLogs,
    total: result.total,
    hasMore: result.hasMore,
  });
});

// ============================================================================
// Get Audit Log by ID
// ============================================================================

adminAuditRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const log = await auditService.getById(id);

  if (!log) {
    return c.json({ error: "Audit log not found" }, 404);
  }

  // Enrich with actor and tenant names
  let actorEmail: string | null = null;
  let tenantName: string | null = null;

  if (log.actorId) {
    const [actor] = await db
      .select({ email: users.primaryEmail })
      .from(users)
      .where(eq(users.id, log.actorId))
      .limit(1);
    actorEmail = actor?.email || null;
  }

  if (log.tenantId) {
    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, log.tenantId))
      .limit(1);
    tenantName = tenant?.name || null;
  }

  return c.json({
    log: {
      ...log,
      actorEmail,
      tenantName,
    },
  });
});

// ============================================================================
// Get Resource History
// ============================================================================

adminAuditRoutes.get(
  "/resource/:resourceType/:resourceId",
  async (c) => {
    const resourceType = c.req.param("resourceType") as AuditQueryOptions["resourceType"];
    const resourceId = c.req.param("resourceId");

    const logs = await auditService.getResourceHistory(
      resourceType!,
      resourceId,
      50
    );

    // Enrich with actor names
    const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))] as string[];

    const actorsList = actorIds.length > 0
      ? await db
          .select({ id: users.id, email: users.primaryEmail })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];

    const actorMap = new Map(actorsList.map((a) => [a.id, a.email]));

    const enrichedLogs = logs.map((log) => ({
      ...log,
      actorEmail: log.actorId ? actorMap.get(log.actorId) || null : null,
    }));

    return c.json({ logs: enrichedLogs });
  }
);

// ============================================================================
// Get Summary Stats
// ============================================================================

adminAuditRoutes.get("/summary/:tenantId", async (c) => {
  const tenantId = c.req.param("tenantId");
  const days = parseInt(c.req.query("days") || "30");

  const summary = await auditService.getTenantSummary(tenantId, days);

  return c.json({ summary });
});

// ============================================================================
// Get Available Filters
// ============================================================================

adminAuditRoutes.get("/filters/options", async (c) => {
  // Return available action types and resource types for filtering
  const actions = [
    // Auth
    "auth.login",
    "auth.logout",
    "auth.login_failed",
    "auth.password_changed",
    // Tenant
    "tenant.created",
    "tenant.updated",
    "tenant.deleted",
    // User
    "user.created",
    "user.updated",
    "user.disabled",
    "user.enabled",
    "user.role_changed",
    // Agent
    "agent.created",
    "agent.updated",
    "agent.deleted",
    "agent.enabled",
    "agent.disabled",
    // Knowledge Base
    "kb.created",
    "kb.updated",
    "kb.deleted",
    "kb.published",
    "kb.unpublished",
    // Source
    "source.created",
    "source.updated",
    "source.deleted",
    "source.run_triggered",
    // API Keys
    "api_key.created",
    "api_key.revoked",
    "widget_token.created",
    "widget_token.revoked",
    "chat_endpoint.created",
    "chat_endpoint.revoked",
    // Settings
    "settings.updated",
    // Models
    "model.created",
    "model.updated",
    "model.deleted",
    "provider.created",
    "provider.updated",
    "provider.deleted",
  ];

  const resourceTypes = [
    "user",
    "tenant",
    "agent",
    "knowledge_base",
    "source",
    "api_key",
    "widget_token",
    "chat_endpoint",
    "settings",
    "model",
    "provider",
    "membership",
  ];

  // Get list of tenants for filter dropdown
  const tenantsList = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .orderBy(tenants.name);

  return c.json({
    actions,
    resourceTypes,
    tenants: tenantsList,
  });
});
