import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { agentTestSuites, testCases, testCaseResults } from "@grounded/db/schema";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { BadRequestError, NotFoundError } from "../middleware/error-handler";
import { loadAgentForTenant } from "../services/agent-helpers";

export const agentTestSuiteRoutes = new Hono();
export const testSuiteRoutes = new Hono();
export const testCaseRoutes = new Hono();

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

const expectedBehaviorSchema = z.object({
  checks: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("contains_phrases"),
          phrases: z.array(z.string().min(1)).min(1),
          caseSensitive: z.boolean().optional(),
        }),
        z.object({
          type: z.literal("semantic_similarity"),
          expectedAnswer: z.string().min(1),
          threshold: z.number().min(0).max(1),
        }),
        z.object({
          type: z.literal("llm_judge"),
          expectedAnswer: z.string().min(1),
          criteria: z.string().optional(),
        }),
      ])
    )
    .min(1),
  mode: z.enum(["all", "any"]),
});

const createTestCaseSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  question: z.string().min(1).max(4000),
  expectedBehavior: expectedBehaviorSchema,
  sortOrder: z.number().int().min(0).optional(),
  isEnabled: z.boolean().default(true),
});

const updateTestCaseSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  question: z.string().min(1).max(4000).optional(),
  expectedBehavior: expectedBehaviorSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
  isEnabled: z.boolean().optional(),
});

const reorderTestCasesSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1),
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

// ============================================================================
// List Test Cases for Suite
// ============================================================================

testSuiteRoutes.get("/:suiteId/cases", auth(), requireTenant(), async (c) => {
  const suiteId = c.req.param("suiteId");
  const authContext = c.get("auth");

  const result = await withRequestRLS(c, async (tx) => {
    await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);

    const cases = await tx.query.testCases.findMany({
      where: and(
        eq(testCases.suiteId, suiteId),
        eq(testCases.tenantId, authContext.tenantId!),
        isNull(testCases.deletedAt)
      ),
      orderBy: [asc(testCases.sortOrder), asc(testCases.createdAt)],
    });

    const caseIds = cases.map((testCase) => testCase.id);
    const lastResults = new Map<
      string,
      { status: string; runId: string; createdAt: Date }
    >();

    if (caseIds.length > 0) {
      const results = await tx.query.testCaseResults.findMany({
        columns: {
          testCaseId: true,
          status: true,
          runId: true,
          createdAt: true,
        },
        where: and(
          inArray(testCaseResults.testCaseId, caseIds),
          eq(testCaseResults.tenantId, authContext.tenantId!)
        ),
        orderBy: [desc(testCaseResults.createdAt)],
      });

      for (const result of results) {
        if (!lastResults.has(result.testCaseId)) {
          lastResults.set(result.testCaseId, {
            status: result.status,
            runId: result.runId,
            createdAt: result.createdAt,
          });
        }
      }
    }

    return { cases, lastResults };
  });

  return c.json({
    cases: result.cases.map((testCase) => ({
      ...testCase,
      lastResult: result.lastResults.get(testCase.id) ?? null,
    })),
  });
});

// ============================================================================
// Create Test Case
// ============================================================================

testSuiteRoutes.post(
  "/:suiteId/cases",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createTestCaseSchema),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const testCase = await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);

      let sortOrder = body.sortOrder;

      if (sortOrder === undefined) {
        const [maxRow] = await tx
          .select({ maxSort: sql<number | null>`max(${testCases.sortOrder})` })
          .from(testCases)
          .where(
            and(
              eq(testCases.suiteId, suiteId),
              eq(testCases.tenantId, authContext.tenantId!),
              isNull(testCases.deletedAt)
            )
          );

        sortOrder = (maxRow?.maxSort ?? -1) + 1;
      }

      const [created] = await tx
        .insert(testCases)
        .values({
          tenantId: authContext.tenantId!,
          suiteId,
          name: body.name,
          description: body.description,
          question: body.question,
          expectedBehavior: body.expectedBehavior,
          sortOrder,
          isEnabled: body.isEnabled,
        })
        .returning();

      return created;
    });

    return c.json({ testCase }, 201);
  }
);

// ============================================================================
// Reorder Test Cases
// ============================================================================

testSuiteRoutes.post(
  "/:suiteId/cases/reorder",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", reorderTestCasesSchema),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);

      const cases = await tx.query.testCases.findMany({
        columns: { id: true },
        where: and(
          eq(testCases.suiteId, suiteId),
          eq(testCases.tenantId, authContext.tenantId!),
          isNull(testCases.deletedAt),
          inArray(testCases.id, body.caseIds)
        ),
      });

      if (cases.length !== body.caseIds.length) {
        throw new BadRequestError("One or more test cases could not be found");
      }

      await Promise.all(
        body.caseIds.map((caseId, index) =>
          tx
            .update(testCases)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(
              and(
                eq(testCases.id, caseId),
                eq(testCases.tenantId, authContext.tenantId!),
                isNull(testCases.deletedAt)
              )
            )
        )
      );
    });

    return c.json({ message: "Test cases reordered" });
  }
);

// ============================================================================
// Get Test Case
// ============================================================================

testCaseRoutes.get("/:caseId", auth(), requireTenant(), async (c) => {
  const caseId = c.req.param("caseId");
  const authContext = c.get("auth");

  const testCase = await withRequestRLS(c, async (tx) => {
    const found = await tx.query.testCases.findFirst({
      where: and(
        eq(testCases.id, caseId),
        eq(testCases.tenantId, authContext.tenantId!),
        isNull(testCases.deletedAt)
      ),
    });

    if (!found) {
      throw new NotFoundError("Test case");
    }

    return found;
  });

  return c.json({ testCase });
});

// ============================================================================
// Update Test Case
// ============================================================================

testCaseRoutes.patch(
  "/:caseId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateTestCaseSchema),
  async (c) => {
    const caseId = c.req.param("caseId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const testCase = await withRequestRLS(c, async (tx) => {
      const [updated] = await tx
        .update(testCases)
        .set({ ...body, updatedAt: new Date() })
        .where(
          and(
            eq(testCases.id, caseId),
            eq(testCases.tenantId, authContext.tenantId!),
            isNull(testCases.deletedAt)
          )
        )
        .returning();

      if (!updated) {
        throw new NotFoundError("Test case");
      }

      return updated;
    });

    return c.json({ testCase });
  }
);

// ============================================================================
// Delete Test Case
// ============================================================================

testCaseRoutes.delete(
  "/:caseId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const caseId = c.req.param("caseId");
    const authContext = c.get("auth");

    await withRequestRLS(c, async (tx) => {
      const [deleted] = await tx
        .update(testCases)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(testCases.id, caseId),
            eq(testCases.tenantId, authContext.tenantId!),
            isNull(testCases.deletedAt)
          )
        )
        .returning();

      if (!deleted) {
        throw new NotFoundError("Test case");
      }
    });

    return c.json({ message: "Test case scheduled for deletion" });
  }
);

// ============================================================================
// Helpers
// ============================================================================

async function loadTestSuiteForTenant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  suiteId: string,
  tenantId: string
): Promise<void> {
  const suite = await tx.query.agentTestSuites.findFirst({
    where: and(
      eq(agentTestSuites.id, suiteId),
      eq(agentTestSuites.tenantId, tenantId),
      isNull(agentTestSuites.deletedAt)
    ),
  });

  if (!suite) {
    throw new NotFoundError("Test suite");
  }
}
