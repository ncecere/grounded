import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sources, sourceRuns, knowledgeBases } from "@grounded/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { redis } from "@grounded/queue";
import { createCrawlState } from "@grounded/crawl-state";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { NotFoundError, ForbiddenError } from "../middleware/error-handler";
import {
  createSourceWithKbIdSchema,
  updateSourceSchema,
  triggerRunSchema,
  buildSourceUpdateData,
  calculateSourceStats,
  cascadeSoftDeleteSourceChunks,
  findRunningRun,
  createSourceRun,
  queueSourceRunJob,
} from "../services/source-helpers";

export const sourceRoutes = new Hono();

// ============================================================================
// List Sources for KB
// ============================================================================

sourceRoutes.get(
  "/kb/:kbId",
  auth(),
  requireTenant(),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");

    const { kb, sourcesResult } = await withRequestRLS(c, async (tx) => {
      // Verify KB access
      const kb = await tx.query.knowledgeBases.findFirst({
        where: and(
          eq(knowledgeBases.id, kbId),
          isNull(knowledgeBases.deletedAt)
        ),
      });

      if (!kb) {
        throw new NotFoundError("Knowledge base");
      }

      if (kb.tenantId !== authContext.tenantId && !kb.isGlobal) {
        throw new ForbiddenError("Access denied");
      }

      const sourcesResult = await tx.query.sources.findMany({
        where: and(eq(sources.kbId, kbId), isNull(sources.deletedAt)),
        orderBy: [desc(sources.createdAt)],
      });

      return { kb, sourcesResult };
    });

    return c.json({ sources: sourcesResult });
  }
);

// ============================================================================
// Create Source
// ============================================================================

sourceRoutes.post(
  "/",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createSourceWithKbIdSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const source = await withRequestRLS(c, async (tx) => {
      // Verify KB belongs to tenant
      const kb = await tx.query.knowledgeBases.findFirst({
        where: and(
          eq(knowledgeBases.id, body.kbId),
          eq(knowledgeBases.tenantId, authContext.tenantId!),
          isNull(knowledgeBases.deletedAt)
        ),
      });

      if (!kb) {
        throw new NotFoundError("Knowledge base");
      }

      const [source] = await tx
        .insert(sources)
        .values({
          tenantId: authContext.tenantId!,
          kbId: body.kbId,
          name: body.name,
          type: body.type,
          config: body.config,
          enrichmentEnabled: body.enrichmentEnabled,
          createdBy: authContext.user.id,
        })
        .returning();

      return source;
    });

    return c.json({ source }, 201);
  }
);

// ============================================================================
// Get Source
// ============================================================================

sourceRoutes.get("/:sourceId", auth(), requireTenant(), async (c) => {
  const sourceId = c.req.param("sourceId");
  const authContext = c.get("auth");

  const source = await withRequestRLS(c, async (tx) => {
    return tx.query.sources.findFirst({
      where: and(
        eq(sources.id, sourceId),
        eq(sources.tenantId, authContext.tenantId!),
        isNull(sources.deletedAt)
      ),
    });
  });

  if (!source) {
    throw new NotFoundError("Source");
  }

  return c.json({ source });
});

// ============================================================================
// Update Source
// ============================================================================

sourceRoutes.patch(
  "/:sourceId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateSourceSchema),
  async (c) => {
    const sourceId = c.req.param("sourceId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const source = await withRequestRLS(c, async (tx) => {
      const existingSource = await tx.query.sources.findFirst({
        where: and(
          eq(sources.id, sourceId),
          eq(sources.tenantId, authContext.tenantId!),
          isNull(sources.deletedAt)
        ),
      });

      if (!existingSource) {
        throw new NotFoundError("Source");
      }

      const updateData = buildSourceUpdateData(existingSource.config, body);

      const [source] = await tx
        .update(sources)
        .set(updateData)
        .where(eq(sources.id, sourceId))
        .returning();

      return source;
    });

    return c.json({ source });
  }
);

// ============================================================================
// Delete Source
// ============================================================================

sourceRoutes.delete(
  "/:sourceId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const sourceId = c.req.param("sourceId");
    const authContext = c.get("auth");

    const source = await withRequestRLS(c, async (tx) => {
      const [source] = await tx
        .update(sources)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(sources.id, sourceId),
            eq(sources.tenantId, authContext.tenantId!),
            isNull(sources.deletedAt)
          )
        )
        .returning();

      if (!source) {
        throw new NotFoundError("Source");
      }

      // Also soft-delete all chunks from this source
      await cascadeSoftDeleteSourceChunks(tx, sourceId);

      return source;
    });

    return c.json({ message: "Source scheduled for deletion" });
  }
);

// ============================================================================
// Trigger Source Run
// ============================================================================

sourceRoutes.post(
  "/:sourceId/runs",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", triggerRunSchema.optional()),
  async (c) => {
    const sourceId = c.req.param("sourceId");
    const authContext = c.get("auth");
    const body = c.req.valid("json") || { forceReindex: false };
    const forceReindex = body.forceReindex ?? false;

    const result = await withRequestRLS(c, async (tx) => {
      const source = await tx.query.sources.findFirst({
        where: and(
          eq(sources.id, sourceId),
          eq(sources.tenantId, authContext.tenantId!),
          isNull(sources.deletedAt)
        ),
      });

      if (!source) {
        throw new NotFoundError("Source");
      }

      // Check for running runs
      const runningRun = await findRunningRun(tx, sourceId);

      if (runningRun) {
        return { error: "A run is already in progress" as const };
      }

      // Create new run
      const run = await createSourceRun(tx, {
        tenantId: authContext.tenantId!,
        sourceId,
        forceReindex,
      });

      return { run };
    });

    if ("error" in result) {
      return c.json({ error: result.error }, 409);
    }

    // Queue the run (outside transaction since it's Redis)
    await queueSourceRunJob({
      tenantId: authContext.tenantId!,
      sourceId,
      runId: result.run.id,
      requestId: c.get("requestId"),
      traceId: c.get("traceId"),
    });

    return c.json({ run: result.run }, 201);
  }
);

// ============================================================================
// List Source Runs
// ============================================================================

sourceRoutes.get(
  "/:sourceId/runs",
  auth(),
  requireTenant(),
  async (c) => {
    const sourceId = c.req.param("sourceId");
    const authContext = c.get("auth");
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");

    const runs = await withRequestRLS(c, async (tx) => {
      const source = await tx.query.sources.findFirst({
        where: and(
          eq(sources.id, sourceId),
          eq(sources.tenantId, authContext.tenantId!),
          isNull(sources.deletedAt)
        ),
      });

      if (!source) {
        throw new NotFoundError("Source");
      }

      return tx.query.sourceRuns.findMany({
        where: eq(sourceRuns.sourceId, sourceId),
        orderBy: [desc(sourceRuns.createdAt)],
        limit,
        offset,
      });
    });

    return c.json({ runs });
  }
);

// ============================================================================
// Get Source Run
// ============================================================================

sourceRoutes.get(
  "/runs/:runId",
  auth(),
  requireTenant(),
  async (c) => {
    const runId = c.req.param("runId");
    const authContext = c.get("auth");

    const run = await withRequestRLS(c, async (tx) => {
      return tx.query.sourceRuns.findFirst({
        where: and(
          eq(sourceRuns.id, runId),
          eq(sourceRuns.tenantId, authContext.tenantId!)
        ),
      });
    });

    if (!run) {
      throw new NotFoundError("Run");
    }

    return c.json({ run });
  }
);

// ============================================================================
// Cancel Source Run
// ============================================================================

sourceRoutes.post(
  "/runs/:runId/cancel",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const runId = c.req.param("runId");
    const authContext = c.get("auth");

    const run = await withRequestRLS(c, async (tx) => {
      const [run] = await tx
        .update(sourceRuns)
        .set({
          status: "canceled",
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(sourceRuns.id, runId),
            eq(sourceRuns.tenantId, authContext.tenantId!),
            eq(sourceRuns.status, "running")
          )
        )
        .returning();

      return run;
    });

    if (!run) {
      throw new NotFoundError("Running source run");
    }

    return c.json({ run });
  }
);

// ============================================================================
// Get Source Run Progress (Real-time from Redis)
// ============================================================================

sourceRoutes.get(
  "/runs/:runId/progress",
  auth(),
  requireTenant(),
  async (c) => {
    const runId = c.req.param("runId");
    const authContext = c.get("auth");

    const run = await withRequestRLS(c, async (tx) => {
      return tx.query.sourceRuns.findFirst({
        where: and(
          eq(sourceRuns.id, runId),
          eq(sourceRuns.tenantId, authContext.tenantId!)
        ),
      });
    });

    if (!run) {
      throw new NotFoundError("Run");
    }

    // If run is finished, return stats from database
    if (run.finishedAt || run.status !== "running") {
      return c.json({
        progress: {
          queued: 0,
          fetched: 0,
          processed: run.stats?.pagesIndexed || 0,
          failed: run.stats?.pagesFailed || 0,
          total: run.stats?.pagesSeen || 0,
          percentComplete: 100,
          status: run.status,
        },
      });
    }

    // For running crawls, get real-time progress from Redis
    const crawlState = createCrawlState(redis, runId);
    const progress = await crawlState.getProgress();

    return c.json({
      progress: {
        ...progress,
        status: run.status,
        inProgress: progress.queued + progress.fetched,
      },
    });
  }
);

// ============================================================================
// Get Source Stats (page count, chunk count)
// ============================================================================

sourceRoutes.get(
  "/:sourceId/stats",
  auth(),
  requireTenant(),
  async (c) => {
    const sourceId = c.req.param("sourceId");
    const authContext = c.get("auth");

    const stats = await withRequestRLS(c, async (tx) => {
      const source = await tx.query.sources.findFirst({
        where: and(
          eq(sources.id, sourceId),
          eq(sources.tenantId, authContext.tenantId!),
          isNull(sources.deletedAt)
        ),
      });

      if (!source) {
        throw new NotFoundError("Source");
      }

      return calculateSourceStats(tx, sourceId);
    });

    return c.json({ stats });
  }
);
