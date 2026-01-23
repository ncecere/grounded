import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@grounded/db";
import {
  agents,
  agentTestSuites,
  testCases,
  testCaseResults,
  testSuiteRuns,
  testRunPromptAnalyses,
  testRunExperiments,
  users,
} from "@grounded/db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, sql, or } from "drizzle-orm";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { BadRequestError, NotFoundError } from "../middleware/error-handler";
import { loadAgentForTenant } from "../services/agent-helpers";
import {
  parseTestCaseJsonl,
  serializeTestCasesJsonl,
} from "../services/test-suite-import";
import { calculatePassRate, calculateRegressionCount } from "../services/test-suite-metrics";
import { runTestSuite } from "../services/test-runner";
import {
  getLatestAnalysisForRun,
  getLatestAnalysisForSuite,
  listAnalysesForSuite,
  runPromptAnalysis,
  markAnalysisApplied,
} from "../services/prompt-analysis";
import {
  startExperiment,
  startExperimentWithPrompt,
  getExperimentComparison,
  listExperimentsForSuite,
  getExperiment,
} from "../services/ab-experiment";
import {
  createTestSuiteSchema,
  updateTestSuiteSchema,
  createTestCaseSchema,
  updateTestCaseSchema,
  reorderTestCasesSchema,
  listRunsQuerySchema,
  analyticsQuerySchema,
  startExperimentWithPromptSchema,
  listExperimentsQuerySchema,
  listAnalysesQuerySchema,
} from "../modules/test-suites/schema";

export const agentTestSuiteRoutes = new Hono();
export const testSuiteRoutes = new Hono();
export const testCaseRoutes = new Hono();
export const testRunRoutes = new Hono();
export const experimentRoutes = new Hono();

// ============================================================================
// List Test Suites for Agent
// ============================================================================

agentTestSuiteRoutes.get("/:agentId/test-suites", auth(), requireTenant(), async (c) => {
  const agentId = c.req.param("agentId");
  const authContext = c.get("auth");

  const suites = await withRequestRLS(c, async (tx) => {
    await loadAgentForTenant(tx, agentId, authContext.tenantId!);

    const baseSuites = await tx.query.agentTestSuites.findMany({
      where: and(
        eq(agentTestSuites.agentId, agentId),
        eq(agentTestSuites.tenantId, authContext.tenantId!),
        isNull(agentTestSuites.deletedAt)
      ),
      orderBy: [desc(agentTestSuites.createdAt)],
    });

    if (baseSuites.length === 0) {
      return [];
    }

    const suiteIds = baseSuites.map((suite) => suite.id);

    const caseCounts = await tx
      .select({
        suiteId: testCases.suiteId,
        count: sql<number>`count(*)`,
      })
      .from(testCases)
      .where(
        and(
          inArray(testCases.suiteId, suiteIds),
          eq(testCases.tenantId, authContext.tenantId!),
          isNull(testCases.deletedAt)
        )
      )
      .groupBy(testCases.suiteId);

    const countsBySuite = new Map(
      caseCounts.map((row) => [row.suiteId, Number(row.count)])
    );

    const runs = await tx
      .select({
        id: testSuiteRuns.id,
        suiteId: testSuiteRuns.suiteId,
        status: testSuiteRuns.status,
        passedCases: testSuiteRuns.passedCases,
        totalCases: testSuiteRuns.totalCases,
        skippedCases: testSuiteRuns.skippedCases,
        completedAt: testSuiteRuns.completedAt,
        createdAt: testSuiteRuns.createdAt,
      })
      .from(testSuiteRuns)
      .where(
        and(
          inArray(testSuiteRuns.suiteId, suiteIds),
          eq(testSuiteRuns.tenantId, authContext.tenantId!)
        )
      )
      .orderBy(desc(testSuiteRuns.createdAt));

    const lastRunBySuite = new Map<string, { id: string; status: string; passRate: number; completedAt: Date | null }>();
    for (const run of runs) {
      if (lastRunBySuite.has(run.suiteId)) continue;
      lastRunBySuite.set(run.suiteId, {
        id: run.id,
        status: run.status,
        passRate: calculatePassRate({
          passedCases: run.passedCases,
          totalCases: run.totalCases,
          skippedCases: run.skippedCases,
        }),
        completedAt: run.completedAt,
      });
    }

    return baseSuites.map((suite) => ({
      ...suite,
      testCaseCount: countsBySuite.get(suite.id) ?? 0,
      lastRun: lastRunBySuite.get(suite.id) ?? null,
    }));
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
// Import Test Cases
// ============================================================================

testSuiteRoutes.post(
  "/:suiteId/import",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");
    const formData = await c.req.parseBody();
    const file = formData["file"];

    if (!file || typeof file === "string") {
      throw new BadRequestError("No file uploaded");
    }

    const content = await file.text();
    const { entries, errors, skipped } = parseTestCaseJsonl(content);

    const imported = await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);

      if (entries.length === 0) {
        return 0;
      }

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

      const startingOrder = (maxRow?.maxSort ?? -1) + 1;
      const values = entries.map((entry, index) => ({
        tenantId: authContext.tenantId!,
        suiteId,
        name: entry.name,
        description: entry.description ?? null,
        question: entry.question,
        expectedBehavior: entry.expectedBehavior,
        sortOrder: startingOrder + index,
        isEnabled: entry.isEnabled ?? true,
      }));

      const created = await tx
        .insert(testCases)
        .values(values)
        .returning({ id: testCases.id });

      return created.length;
    });

    return c.json({
      imported,
      skipped,
      errors,
    });
  }
);

// ============================================================================
// Export Test Cases
// ============================================================================

testSuiteRoutes.get("/:suiteId/export", auth(), requireTenant(), async (c) => {
  const suiteId = c.req.param("suiteId");
  const authContext = c.get("auth");

  const cases = await withRequestRLS(c, async (tx) => {
    await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);

    return tx.query.testCases.findMany({
      columns: {
        name: true,
        description: true,
        question: true,
        expectedBehavior: true,
        isEnabled: true,
      },
      where: and(
        eq(testCases.suiteId, suiteId),
        eq(testCases.tenantId, authContext.tenantId!),
        isNull(testCases.deletedAt)
      ),
      orderBy: [asc(testCases.sortOrder), asc(testCases.createdAt)],
    });
  });

  const jsonl = serializeTestCasesJsonl(cases);

  c.header("Content-Type", "application/jsonl");
  c.header("Content-Disposition", `attachment; filename="test-suite-${suiteId}.jsonl"`);
  return c.text(jsonl);
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
      const suite = await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);

      const runs = await tx.query.testSuiteRuns.findMany({
        where: and(
          eq(testSuiteRuns.suiteId, suiteId),
          eq(testSuiteRuns.tenantId, authContext.tenantId!)
        ),
        orderBy: [desc(testSuiteRuns.createdAt)],
        limit: query.limit,
        offset: query.offset,
      });

      // Batch fetch users for triggered by
      const userIds = runs
        .map((r) => r.triggeredByUserId)
        .filter((id): id is string => id !== null);
      const usersMap = new Map<string, { id: string; name: string }>();
      if (userIds.length > 0) {
        const foundUsers = await tx.query.users.findMany({
          where: inArray(users.id, userIds),
          columns: { id: true, primaryEmail: true },
        });
        for (const u of foundUsers) {
          usersMap.set(u.id, { id: u.id, name: u.primaryEmail ?? "Unknown" });
        }
      }

      const [totalRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(testSuiteRuns)
        .where(
          and(
            eq(testSuiteRuns.suiteId, suiteId),
            eq(testSuiteRuns.tenantId, authContext.tenantId!)
          )
        );

      return { runs, total: Number(totalRow?.count ?? 0), suiteName: suite.name, usersMap };
    });

    return c.json({
      runs: result.runs.map((run) => {
        const durationMs =
          run.startedAt && run.completedAt
            ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
            : null;
        return {
          ...run,
          suiteName: result.suiteName,
          triggeredByUser: run.triggeredByUserId
            ? result.usersMap.get(run.triggeredByUserId) ?? null
            : null,
          durationMs,
          passRate: calculatePassRate({
            passedCases: run.passedCases,
            totalCases: run.totalCases,
            skippedCases: run.skippedCases,
          }),
        };
      }),
      total: result.total,
    });
  }
);

// ============================================================================
// Start Test Run (or A/B Experiment if enabled)
// ============================================================================

testSuiteRoutes.post(
  "/:suiteId/runs",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");

    const suite = await withRequestRLS(c, async (tx) => {
      return await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);
    });

    // If A/B testing is enabled, start an experiment instead of a regular run
    if (suite.abTestingEnabled) {
      const result = await startExperiment(suiteId, "manual", authContext.user.id);

      if (result.status === "error") {
        throw new BadRequestError(result.error ?? "Failed to start A/B experiment");
      }

      return c.json({
        id: result.baselineRunId,
        experimentId: result.experimentId,
        status: result.status,
        message:
          result.status === "started"
            ? "A/B experiment started (baseline running)"
            : "A/B experiment queued",
        isExperiment: true,
      });
    }

    // Regular run
    const result = await runTestSuite(suiteId, "manual", authContext.user.id);

    if (result.status === "error") {
      throw new BadRequestError(result.error ?? "Failed to start test suite");
    }

    return c.json({
      id: result.runId,
      status: result.status,
      message: result.status === "started" ? "Test run started" : "Test run queued",
      isExperiment: false,
    });
  }
);

// ============================================================================
// Start Experiment with Custom Prompt
// ============================================================================

testSuiteRoutes.post(
  "/:suiteId/experiment",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", startExperimentWithPromptSchema),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);
    });

    const result = await startExperimentWithPrompt(
      suiteId,
      body.candidatePrompt,
      "manual",
      authContext.user.id
    );

    if (result.status === "error") {
      throw new BadRequestError(result.error ?? "Failed to start experiment");
    }

    return c.json({
      id: result.baselineRunId,
      experimentId: result.experimentId,
      status: result.status,
      message:
        result.status === "started"
          ? "A/B experiment started with custom prompt (baseline running)"
          : "A/B experiment queued with custom prompt",
      isExperiment: true,
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

      const baselineRunFilter = or(
        isNull(testSuiteRuns.promptVariant),
        eq(testSuiteRuns.promptVariant, "baseline")
      );

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
          gte(testSuiteRuns.completedAt, startDate),
          baselineRunFilter
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
          passRate: sql<number>`avg(case when ${testSuiteRuns.totalCases} - ${testSuiteRuns.skippedCases} <= 0 then 100 else ${testSuiteRuns.passedCases}::float / (${testSuiteRuns.totalCases} - ${testSuiteRuns.skippedCases}) * 100 end)`,
          totalRuns: sql<number>`count(*)`,
        })
        .from(testSuiteRuns)
        .where(
          and(
            eq(testSuiteRuns.suiteId, suiteId),
            eq(testSuiteRuns.tenantId, authContext.tenantId!),
            eq(testSuiteRuns.status, "completed"),
            gte(testSuiteRuns.completedAt, startDate),
            baselineRunFilter
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
      systemPrompt: result.run.systemPrompt ?? null,
      promptVariant: result.run.promptVariant ?? null,
      experimentId: result.run.experimentId ?? null,
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
// Get Analysis for Test Run
// ============================================================================

testRunRoutes.get("/:runId/analysis", auth(), requireTenant(), async (c) => {
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

    const analysis = await getLatestAnalysisForRun(runId);
    return { run, analysis };
  });

  return c.json({ analysis: result.analysis });
});

// ============================================================================
// Run Analysis on Test Run (on demand)
// ============================================================================

testRunRoutes.post(
  "/:runId/analysis",
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

      if (run.status !== "completed") {
        throw new BadRequestError("Can only analyze completed runs");
      }

      if (!run.systemPrompt) {
        throw new BadRequestError("Run has no system prompt recorded");
      }

      const suite = await loadTestSuiteForTenant(tx, run.suiteId, authContext.tenantId!);
      return { run, suite };
    });

    const { analysisId, analysis } = await runPromptAnalysis(runId, {
      modelConfigId: result.suite.analysisModelConfigId,
    });

    return c.json({
      analysisId,
      summary: analysis.summary,
      failureClusters: analysis.failureClusters,
      suggestedPrompt: analysis.suggestedPrompt,
      rationale: analysis.rationale,
    });
  }
);

// ============================================================================
// Mark Analysis as Applied (legacy - just marks without updating agent)
// ============================================================================

testRunRoutes.post(
  "/:runId/analysis/apply",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const runId = c.req.param("runId");
    const authContext = c.get("auth");

    await withRequestRLS(c, async (tx) => {
      const run = await tx.query.testSuiteRuns.findFirst({
        where: and(
          eq(testSuiteRuns.id, runId),
          eq(testSuiteRuns.tenantId, authContext.tenantId!)
        ),
      });

      if (!run) {
        throw new NotFoundError("Test run");
      }
    });

    const analysis = await getLatestAnalysisForRun(runId);
    if (!analysis) {
      throw new NotFoundError("Analysis");
    }

    await markAnalysisApplied(analysis.id);

    return c.json({ message: "Analysis marked as applied" });
  }
);

// ============================================================================
// Apply Analysis Prompt to Agent
// ============================================================================

testRunRoutes.post(
  "/:runId/analysis/apply-to-agent",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const runId = c.req.param("runId");
    const authContext = c.get("auth");

    const { run, suite } = await withRequestRLS(c, async (tx) => {
      const runResult = await tx.query.testSuiteRuns.findFirst({
        where: and(
          eq(testSuiteRuns.id, runId),
          eq(testSuiteRuns.tenantId, authContext.tenantId!)
        ),
      });

      if (!runResult) {
        throw new NotFoundError("Test run");
      }

      const suiteResult = await loadTestSuiteForTenant(tx, runResult.suiteId, authContext.tenantId!);
      return { run: runResult, suite: suiteResult };
    });

    const analysis = await getLatestAnalysisForRun(runId);
    if (!analysis) {
      throw new NotFoundError("Analysis");
    }

    if (!analysis.suggestedPrompt) {
      throw new BadRequestError("Analysis has no suggested prompt");
    }

    // Update the agent's system prompt
    await db
      .update(agents)
      .set({ systemPrompt: analysis.suggestedPrompt })
      .where(eq(agents.id, suite.agentId));

    // Mark analysis as applied
    await markAnalysisApplied(analysis.id);

    return c.json({ message: "Suggested prompt applied to agent" });
  }
);

// ============================================================================
// List Experiments for Suite
// ============================================================================

testSuiteRoutes.get(
  "/:suiteId/experiments",
  auth(),
  requireTenant(),
  zValidator("query", listExperimentsQuerySchema),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const authContext = c.get("auth");
    const query = c.req.valid("query");

    await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);
    });

    const { experiments, total } = await listExperimentsForSuite(suiteId, {
      limit: query.limit,
      offset: query.offset,
    });

    return c.json({ experiments, total });
  }
);

// ============================================================================
// Get Latest Analysis for Suite
// ============================================================================

testSuiteRoutes.get("/:suiteId/latest-analysis", auth(), requireTenant(), async (c) => {
  const suiteId = c.req.param("suiteId");
  const authContext = c.get("auth");

  await withRequestRLS(c, async (tx) => {
    await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);
  });

  const analysis = await getLatestAnalysisForSuite(suiteId);

  return c.json({ analysis });
});

// ============================================================================
// List Analyses for Suite
// ============================================================================

testSuiteRoutes.get(
  "/:suiteId/analyses",
  auth(),
  requireTenant(),
  zValidator("query", listAnalysesQuerySchema),
  async (c) => {
    const suiteId = c.req.param("suiteId");
    const query = c.req.valid("query");
    const authContext = c.get("auth");

    await withRequestRLS(c, async (tx) => {
      await loadTestSuiteForTenant(tx, suiteId, authContext.tenantId!);
    });

    const { analyses, total } = await listAnalysesForSuite(suiteId, {
      limit: query.limit,
      offset: query.offset,
    });

    return c.json({ analyses, total });
  }
);

// ============================================================================
// Get Experiment Details with Comparison
// ============================================================================

experimentRoutes.get("/:experimentId", auth(), requireTenant(), async (c) => {
  const experimentId = c.req.param("experimentId");
  const authContext = c.get("auth");

  const experiment = await getExperiment(experimentId);
  if (!experiment) {
    throw new NotFoundError("Experiment");
  }

  await withRequestRLS(c, async (tx) => {
    await loadTestSuiteForTenant(tx, experiment.suiteId, authContext.tenantId!);
  });

  const comparison = await getExperimentComparison(experimentId);

  return c.json({ comparison });
});

// ============================================================================
// Apply Experiment Candidate Prompt to Agent
// ============================================================================

experimentRoutes.post(
  "/:experimentId/apply",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const experimentId = c.req.param("experimentId");
    const authContext = c.get("auth");

    const experiment = await getExperiment(experimentId);
    if (!experiment) {
      throw new NotFoundError("Experiment");
    }

    if (!experiment.candidatePrompt) {
      throw new BadRequestError("Experiment has no candidate prompt to apply");
    }

    if (experiment.status !== "completed") {
      throw new BadRequestError("Can only apply prompts from completed experiments");
    }

    const suite = await withRequestRLS(c, async (tx) => {
      return await loadTestSuiteForTenant(tx, experiment.suiteId, authContext.tenantId!);
    });

    // Update the agent's system prompt (with tenant check for security)
    const [updatedAgent] = await db
      .update(agents)
      .set({
        systemPrompt: experiment.candidatePrompt,
      })
      .where(
        and(
          eq(agents.id, suite.agentId),
          eq(agents.tenantId, authContext.tenantId!)
        )
      )
      .returning({ id: agents.id });

    if (!updatedAgent) {
      throw new NotFoundError("Agent");
    }

    return c.json({ message: "Candidate prompt applied to agent" });
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
