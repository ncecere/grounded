import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { agentTestSuites } from "@grounded/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { NotFoundError } from "../middleware/error-handler";
import { loadAgentForTenant } from "../services/agent-helpers";

export const agentTestSuiteRoutes = new Hono();
export const testSuiteRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const scheduleTypeSchema = z.enum(["manual", "hourly", "daily", "weekly"]);
const scheduleTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Schedule time must be HH:MM in 24-hour format");

const createTestSuiteSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scheduleType: scheduleTypeSchema.default("manual"),
  scheduleTime: scheduleTimeSchema.nullable().optional(),
  scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  llmJudgeModelConfigId: z.string().uuid().nullable().optional(),
  alertOnRegression: z.boolean().default(true),
  alertThresholdPercent: z.number().int().min(1).max(100).default(10),
  isEnabled: z.boolean().default(true),
});

const updateTestSuiteSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  scheduleType: scheduleTypeSchema.optional(),
  scheduleTime: scheduleTimeSchema.nullable().optional(),
  scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  llmJudgeModelConfigId: z.string().uuid().nullable().optional(),
  alertOnRegression: z.boolean().optional(),
  alertThresholdPercent: z.number().int().min(1).max(100).optional(),
  isEnabled: z.boolean().optional(),
});

// ============================================================================
// List Test Suites for Agent
// ============================================================================

agentTestSuiteRoutes.get("/:agentId/test-suites", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const suites = await withRequestRLS(c, async (tx) => {
    await loadAgentForTenant(tx, agentId, authContext.tenantId!);

    return tx.query.agentTestSuites.findMany({
      where: and(
        eq(agentTestSuites.agentId, agentId),
        eq(agentTestSuites.tenantId, authContext.tenantId!),
        isNull(agentTestSuites.deletedAt)
      ),
      orderBy: [desc(agentTestSuites.createdAt)],
    });
  });

  return c.json({ testSuites: suites });
});

// ============================================================================
// Create Test Suite for Agent
// ============================================================================

agentTestSuiteRoutes.post(
  "/:agentId/test-suites",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createTestSuiteSchema),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const suite = await withRequestRLS(c, async (tx) => {
      await loadAgentForTenant(tx, agentId, authContext.tenantId!);

      const [created] = await tx
        .insert(agentTestSuites)
        .values({
          tenantId: authContext.tenantId!,
          agentId,
          name: body.name,
          description: body.description,
          scheduleType: body.scheduleType,
          scheduleTime: body.scheduleTime ?? null,
          scheduleDayOfWeek: body.scheduleDayOfWeek ?? null,
          llmJudgeModelConfigId: body.llmJudgeModelConfigId ?? null,
          alertOnRegression: body.alertOnRegression,
          alertThresholdPercent: body.alertThresholdPercent,
          isEnabled: body.isEnabled,
          createdBy: authContext.user.id,
        })
        .returning();

      return created;
    });

    return c.json({ testSuite: suite }, 201);
  }
);

// ============================================================================
// Get Test Suite
// ============================================================================

testSuiteRoutes.get("/:suiteId", auth(), requireTenant(), async (c) => {
  const suiteId = c.req.param("suiteId");
  const authContext = c.get("auth");

  const suite = await withRequestRLS(c, async (tx) => {
    const found = await tx.query.agentTestSuites.findFirst({
      where: and(
        eq(agentTestSuites.id, suiteId),
        eq(agentTestSuites.tenantId, authContext.tenantId!),
        isNull(agentTestSuites.deletedAt)
      ),
    });

    if (!found) {
      throw new NotFoundError("Test suite");
    }

    return found;
  });

  return c.json({ testSuite: suite });
});

// ============================================================================
// Update Test Suite
// ============================================================================

testSuiteRoutes.patch(
  "/:suiteId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateTestSuiteSchema),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const suite = await withRequestRLS(c, async (tx) => {
      const [updated] = await tx
        .update(agentTestSuites)
        .set({ ...body, updatedAt: new Date() })
        .where(
          and(
            eq(agentTestSuites.id, suiteId),
            eq(agentTestSuites.tenantId, authContext.tenantId!),
            isNull(agentTestSuites.deletedAt)
          )
        )
        .returning();

      if (!updated) {
        throw new NotFoundError("Test suite");
      }

      return updated;
    });

    return c.json({ testSuite: suite });
  }
);

// ============================================================================
// Delete Test Suite
// ============================================================================

testSuiteRoutes.delete(
  "/:suiteId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");

    await withRequestRLS(c, async (tx) => {
      const [suite] = await tx
        .update(agentTestSuites)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(agentTestSuites.id, suiteId),
            eq(agentTestSuites.tenantId, authContext.tenantId!),
            isNull(agentTestSuites.deletedAt)
          )
        )
        .returning();

      if (!suite) {
        throw new NotFoundError("Test suite");
      }
    });

    return c.json({ message: "Test suite scheduled for deletion" });
  }
);
