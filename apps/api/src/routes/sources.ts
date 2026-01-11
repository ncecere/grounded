import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@kcb/db";
import { sources, sourceRuns, knowledgeBases, sourceRunPages, kbChunks } from "@kcb/db/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { sourceConfigSchema } from "@kcb/shared";
import { addSourceRunStartJob } from "@kcb/queue";
import { auth, requireRole, requireTenant } from "../middleware/auth";
import { NotFoundError, ForbiddenError } from "../middleware/error-handler";

export const sourceRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const createSourceSchema = z.object({
  kbId: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: z.enum(["web"]),
  config: sourceConfigSchema,
  enrichmentEnabled: z.boolean().default(false),
});

const updateSourceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: sourceConfigSchema.partial().optional(),
  enrichmentEnabled: z.boolean().optional(),
});

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

    // Verify KB access
    const kb = await db.query.knowledgeBases.findFirst({
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

    const sourcesResult = await db.query.sources.findMany({
      where: and(eq(sources.kbId, kbId), isNull(sources.deletedAt)),
      orderBy: [desc(sources.createdAt)],
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
  zValidator("json", createSourceSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    // Verify KB belongs to tenant
    const kb = await db.query.knowledgeBases.findFirst({
      where: and(
        eq(knowledgeBases.id, body.kbId),
        eq(knowledgeBases.tenantId, authContext.tenantId!),
        isNull(knowledgeBases.deletedAt)
      ),
    });

    if (!kb) {
      throw new NotFoundError("Knowledge base");
    }

    const [source] = await db
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

    return c.json({ source }, 201);
  }
);

// ============================================================================
// Get Source
// ============================================================================

sourceRoutes.get("/:sourceId", auth(), requireTenant(), async (c) => {
  const sourceId = c.req.param("sourceId");
  const authContext = c.get("auth");

  const source = await db.query.sources.findFirst({
    where: and(
      eq(sources.id, sourceId),
      eq(sources.tenantId, authContext.tenantId!),
      isNull(sources.deletedAt)
    ),
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

    const existingSource = await db.query.sources.findFirst({
      where: and(
        eq(sources.id, sourceId),
        eq(sources.tenantId, authContext.tenantId!),
        isNull(sources.deletedAt)
      ),
    });

    if (!existingSource) {
      throw new NotFoundError("Source");
    }

    const updateData: any = {};
    if (body.name) updateData.name = body.name;
    if (body.enrichmentEnabled !== undefined)
      updateData.enrichmentEnabled = body.enrichmentEnabled;
    if (body.config) {
      updateData.config = { ...existingSource.config, ...body.config };
    }

    const [source] = await db
      .update(sources)
      .set(updateData)
      .where(eq(sources.id, sourceId))
      .returning();

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

    const [source] = await db
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

    return c.json({ message: "Source scheduled for deletion" });
  }
);

// ============================================================================
// Trigger Source Run
// ============================================================================

const triggerRunSchema = z.object({
  forceReindex: z.boolean().optional().default(false),
});

sourceRoutes.post(
  "/:sourceId/runs",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", triggerRunSchema.optional()),
  async (c) => {
    const sourceId = c.req.param("sourceId");
    const authContext = c.get("auth");
    const body = c.req.valid("json") || {};
    const forceReindex = body.forceReindex ?? false;

    const source = await db.query.sources.findFirst({
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
    const runningRun = await db.query.sourceRuns.findFirst({
      where: and(
        eq(sourceRuns.sourceId, sourceId),
        eq(sourceRuns.status, "running")
      ),
    });

    if (runningRun) {
      return c.json({ error: "A run is already in progress" }, 409);
    }

    // Create new run
    const [run] = await db
      .insert(sourceRuns)
      .values({
        tenantId: authContext.tenantId!,
        sourceId,
        trigger: "manual",
        status: "pending",
        forceReindex,
      })
      .returning();

    // Queue the run
    await addSourceRunStartJob({
      tenantId: authContext.tenantId!,
      sourceId,
      runId: run.id,
    });

    return c.json({ run }, 201);
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

    const source = await db.query.sources.findFirst({
      where: and(
        eq(sources.id, sourceId),
        eq(sources.tenantId, authContext.tenantId!),
        isNull(sources.deletedAt)
      ),
    });

    if (!source) {
      throw new NotFoundError("Source");
    }

    const runs = await db.query.sourceRuns.findMany({
      where: eq(sourceRuns.sourceId, sourceId),
      orderBy: [desc(sourceRuns.createdAt)],
      limit,
      offset,
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

    const run = await db.query.sourceRuns.findFirst({
      where: and(
        eq(sourceRuns.id, runId),
        eq(sourceRuns.tenantId, authContext.tenantId!)
      ),
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

    const [run] = await db
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

    if (!run) {
      throw new NotFoundError("Running source run");
    }

    return c.json({ run });
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

    const source = await db.query.sources.findFirst({
      where: and(
        eq(sources.id, sourceId),
        eq(sources.tenantId, authContext.tenantId!),
        isNull(sources.deletedAt)
      ),
    });

    if (!source) {
      throw new NotFoundError("Source");
    }

    // Get unique page count (from the most recent successful run)
    const latestRun = await db.query.sourceRuns.findFirst({
      where: and(
        eq(sourceRuns.sourceId, sourceId),
        eq(sourceRuns.status, "succeeded")
      ),
      orderBy: [desc(sourceRuns.createdAt)],
    });

    let pageCount = 0;
    if (latestRun) {
      const pageResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sourceRunPages)
        .where(and(
          eq(sourceRunPages.sourceRunId, latestRun.id),
          eq(sourceRunPages.status, "succeeded")
        ));
      pageCount = pageResult[0]?.count || 0;
    }

    // Get chunk count for this source
    const chunkResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kbChunks)
      .where(and(
        eq(kbChunks.sourceId, sourceId),
        isNull(kbChunks.deletedAt)
      ));
    const chunkCount = chunkResult[0]?.count || 0;

    return c.json({
      stats: {
        pageCount,
        chunkCount,
      }
    });
  }
);
