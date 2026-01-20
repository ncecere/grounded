import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { agentTestSuites, testCases, testCaseResults, testSuiteRuns, users } from "@grounded/db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { BadRequestError, NotFoundError } from "../middleware/error-handler";
import { loadAgentForTenant } from "../services/agent-helpers";
import { calculatePassRate, calculateRegressionCount } from "../services/test-suite-metrics";
import { runTestSuite } from "../services/test-runner";

export const agentTestSuiteRoutes = new Hono();
export const testSuiteRoutes = new Hono();
export const testCaseRoutes = new Hono();
export const testRunRoutes = new Hono();

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

const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
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
// List Test Runs for Suite
// ============================================================================

testSuiteRoutes.get(
  "/:suiteId/runs",
  auth(),
  requireTenant(),
  zValidator("query", listRunsQuerySchema),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");
    const query = c.req.valid("query");

    const result = await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);

      const runs = await tx.query.testSuiteRuns.findMany({
        where: and(
          eq(testSuiteRuns.suiteId, suiteId),
          eq(testSuiteRuns.tenantId, authContext.tenantId!)
        ),
        orderBy: [desc(testSuiteRuns.createdAt)],
        limit: query.limit,
        offset: query.offset,
      });

      const [totalRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(testSuiteRuns)
        .where(
          and(
            eq(testSuiteRuns.suiteId, suiteId),
            eq(testSuiteRuns.tenantId, authContext.tenantId!)
          )
        );

      return { runs, total: Number(totalRow?.count ?? 0) };
    });

    return c.json({
      runs: result.runs.map((run) => ({
        ...run,
        passRate: calculatePassRate({
          passedCases: run.passedCases,
          totalCases: run.totalCases,
          skippedCases: run.skippedCases,
        }),
      })),
      total: result.total,
    });
  }
);

// ============================================================================
// Start Test Run
// ============================================================================

testSuiteRoutes.post(
  "/:suiteId/runs",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");

    await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);
    });

    const result = await runTestSuite(suiteId, "manual", authContext.user.id);

    if (result.status === "error") {
      throw new BadRequestError(result.error ?? "Failed to start test suite");
    }

    return c.json({
      id: result.runId,
      status: result.status,
      message: result.status === "started" ? "Test run started" : "Test run queued",
    });
  }
);

// ============================================================================
// Suite Analytics
// ============================================================================

testSuiteRoutes.get(
  "/:suiteId/analytics",
  auth(),
  requireTenant(),
  zValidator("query", analyticsQuerySchema),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");
    const query = c.req.valid("query");
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (query.days - 1));

    const result = await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);

      const runRows = await tx.query.testSuiteRuns.findMany({
        columns: {
          passedCases: true,
          totalCases: true,
          skippedCases: true,
          completedAt: true,
        },
        where: and(
          eq(testSuiteRuns.suiteId, suiteId),
          eq(testSuiteRuns.tenantId, authContext.tenantId!),
          eq(testSuiteRuns.status, "completed"),
          gte(testSuiteRuns.completedAt, startDate)
        ),
        orderBy: [asc(testSuiteRuns.completedAt)],
      });

      const passRates = runRows.map((run) =>
        calculatePassRate({
          passedCases: run.passedCases,
          totalCases: run.totalCases,
          skippedCases: run.skippedCases,
        })
      );

      const averagePassRate =
        passRates.length > 0
          ? passRates.reduce((sum, value) => sum + value, 0) / passRates.length
          : 0;

      const runsByDay = await tx
        .select({
          date: sql<string>`to_char(${testSuiteRuns.completedAt}, 'YYYY-MM-DD')`,
          passRate: sql<number>`avg(${testSuiteRuns.passedCases}::float / greatest(${testSuiteRuns.totalCases} - ${testSuiteRuns.skippedCases}, 1) * 100)`,
          totalRuns: sql<number>`count(*)`,
        })
        .from(testSuiteRuns)
        .where(
          and(
            eq(testSuiteRuns.suiteId, suiteId),
            eq(testSuiteRuns.tenantId, authContext.tenantId!),
            eq(testSuiteRuns.status, "completed"),
            gte(testSuiteRuns.completedAt, startDate)
          )
        )
        .groupBy(sql`to_char(${testSuiteRuns.completedAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${testSuiteRuns.completedAt}, 'YYYY-MM-DD')`);

      return {
        passRates,
        averagePassRate,
        totalRuns: runRows.length,
        runsByDay,
      };
    });

    return c.json({
      runs: result.runsByDay.map((row) => ({
        date: row.date,
        passRate: Number(row.passRate) || 0,
        totalRuns: Number(row.totalRuns) || 0,
      })),
      averagePassRate: result.averagePassRate,
      totalRuns: result.totalRuns,
      regressions: calculateRegressionCount(result.passRates),
    });
  }
);

// ============================================================================
// Get Test Run Details
// ============================================================================

testRunRoutes.get("/:runId", auth(), requireTenant(), async (c) => {
  const runId = c.req.param("runId");
  const authContext = c.get("auth");

  const result = await withRequestRLS(c, async (tx) => {
    const run = await tx.query.testSuiteRuns.findFirst({
      where: and(
        eq(testSuiteRuns.id, runId),
        eq(testSuiteRuns.tenantId, authContext.tenantId!)
      ),
    });

    if (!run) {
      throw new NotFoundError("Test run");
    }

    const suite = await loadTestSuiteForTenant(tx, run.suiteId, authContext.tenantId!);

    const triggeredByUser = run.triggeredByUserId
      ? await tx.query.users.findFirst({
          columns: { id: true, primaryEmail: true },
          where: eq(users.id, run.triggeredByUserId),
        })
      : null;

    const results = await tx
      .select({
        id: testCaseResults.id,
        testCaseId: testCaseResults.testCaseId,
        testCaseName: testCases.name,
        question: testCases.question,
        status: testCaseResults.status,
        actualResponse: testCaseResults.actualResponse,
        checkResults: testCaseResults.checkResults,
        durationMs: testCaseResults.durationMs,
        errorMessage: testCaseResults.errorMessage,
      })
      .from(testCaseResults)
      .innerJoin(testCases, eq(testCases.id, testCaseResults.testCaseId))
      .where(
        and(
          eq(testCaseResults.runId, runId),
          eq(testCaseResults.tenantId, authContext.tenantId!)
        )
      )
      .orderBy(asc(testCases.sortOrder), asc(testCaseResults.createdAt));

    return { run, suite, triggeredByUser, results };
  });

  const durationMs =
    result.run.startedAt && result.run.completedAt
      ? result.run.completedAt.getTime() - result.run.startedAt.getTime()
      : null;

  return c.json({
    testRun: {
      id: result.run.id,
      suiteId: result.run.suiteId,
      suiteName: result.suite.name,
      status: result.run.status,
      triggeredBy: result.run.triggeredBy,
      triggeredByUser: result.triggeredByUser
        ? {
            id: result.triggeredByUser.id,
            name: result.triggeredByUser.primaryEmail ?? "Unknown user",
          }
        : null,
      totalCases: result.run.totalCases,
      passedCases: result.run.passedCases,
      failedCases: result.run.failedCases,
      skippedCases: result.run.skippedCases,
      passRate: calculatePassRate({
        passedCases: result.run.passedCases,
        totalCases: result.run.totalCases,
        skippedCases: result.run.skippedCases,
      }),
      startedAt: result.run.startedAt,
      completedAt: result.run.completedAt,
      durationMs,
      errorMessage: result.run.errorMessage,
      results: result.results,
    },
  });
});

// ============================================================================
// Delete or Cancel Test Run
// ============================================================================

testRunRoutes.delete(
  "/:runId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const runId = c.req.param("runId");
    const authContext = c.get("auth");

    const result = await withRequestRLS(c, async (tx) => {
      const run = await tx.query.testSuiteRuns.findFirst({
        where: and(
          eq(testSuiteRuns.id, runId),
          eq(testSuiteRuns.tenantId, authContext.tenantId!)
        ),
      });

      if (!run) {
        throw new NotFoundError("Test run");
      }

      if (run.status === "pending" || run.status === "running") {
        const [updated] = await tx
          .update(testSuiteRuns)
          .set({ status: "cancelled", completedAt: new Date() })
          .where(eq(testSuiteRuns.id, runId))
          .returning({ id: testSuiteRuns.id });

        return { cancelled: true, runId: updated?.id ?? runId };
      }

      await tx.delete(testSuiteRuns).where(eq(testSuiteRuns.id, runId));
      return { cancelled: false, runId };
    });

    return c.json({
      message: result.cancelled
        ? "Test run cancelled"
        : "Test run deleted",
    });
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
): Promise<typeof agentTestSuites.$inferSelect> {
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

  return suite;
}
