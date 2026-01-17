import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import {
  knowledgeBases,
  tenantKbSubscriptions,
  tenantQuotas,
  sources,
  kbChunks,
} from "@grounded/db/schema";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { auth, requireRole, requireTenant, requireSystemAdmin, withRequestRLS } from "../middleware/auth";
import { NotFoundError, QuotaExceededError, ForbiddenError, ConflictError } from "../middleware/error-handler";
import { getAIRegistry } from "@grounded/ai-providers";
import { addKbReindexJob } from "@grounded/queue";

export const kbRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const createKbSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  embeddingModelId: z.string().uuid().optional(), // Optional: specify which embedding model to use
});

const updateKbSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const reindexKbSchema = z.object({
  embeddingModelId: z.string().uuid(),
});

// ============================================================================
// List Knowledge Bases
// ============================================================================

kbRoutes.get("/", auth(), requireTenant(), async (c) => {
  const authContext = c.get("auth");

  const result = await withRequestRLS(c, async (tx) => {
    // Get tenant's own KBs
    const ownKbs = await tx.query.knowledgeBases.findMany({
      where: and(
        eq(knowledgeBases.tenantId, authContext.tenantId!),
        isNull(knowledgeBases.deletedAt)
      ),
    });

    const ownKbIds = new Set(ownKbs.map((kb) => kb.id));

    // Get ALL published global KBs (visible to everyone)
    const globalKbs = await tx.query.knowledgeBases.findMany({
      where: and(
        eq(knowledgeBases.isGlobal, true),
        sql`${knowledgeBases.publishedAt} IS NOT NULL`,
        isNull(knowledgeBases.deletedAt)
      ),
    });

    // Get KBs specifically shared with this tenant
    const sharedSubscriptions = await tx
      .select({
        kb: knowledgeBases,
      })
      .from(tenantKbSubscriptions)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, tenantKbSubscriptions.kbId))
      .where(
        and(
          eq(tenantKbSubscriptions.tenantId, authContext.tenantId!),
          isNull(tenantKbSubscriptions.deletedAt),
          isNull(knowledgeBases.deletedAt)
        )
      );

    const sharedKbs = sharedSubscriptions.map((s) => s.kb);

    // Combine all KBs, avoiding duplicates
    const allKbIds = new Set<string>();
    const allKbs: Array<typeof knowledgeBases.$inferSelect & { isShared: boolean }> = [];

    // Add own KBs first (not shared)
    for (const kb of ownKbs) {
      allKbIds.add(kb.id);
      allKbs.push({ ...kb, isShared: false });
    }

    // Add global KBs (shared, unless already owned)
    for (const kb of globalKbs) {
      if (!allKbIds.has(kb.id)) {
        allKbIds.add(kb.id);
        allKbs.push({ ...kb, isShared: true });
      }
    }

    // Add specifically shared KBs (shared, unless already included)
    for (const kb of sharedKbs) {
      if (!allKbIds.has(kb.id)) {
        allKbIds.add(kb.id);
        allKbs.push({ ...kb, isShared: true });
      }
    }

    // Get source and chunk counts for all KBs
    const kbIds = Array.from(allKbIds);

    const sourceCounts = kbIds.length > 0 ? await tx
      .select({
        kbId: sources.kbId,
        count: sql<number>`count(*)::int`,
      })
      .from(sources)
      .where(and(
        inArray(sources.kbId, kbIds),
        isNull(sources.deletedAt)
      ))
      .groupBy(sources.kbId) : [];

    const chunkCounts = kbIds.length > 0 ? await tx
      .select({
        kbId: kbChunks.kbId,
        count: sql<number>`count(*)::int`,
      })
      .from(kbChunks)
      .where(and(
        inArray(kbChunks.kbId, kbIds),
        isNull(kbChunks.deletedAt)
      ))
      .groupBy(kbChunks.kbId) : [];

    const sourceCountMap = new Map(sourceCounts.map((s) => [s.kbId, s.count]));
    const chunkCountMap = new Map(chunkCounts.map((c) => [c.kbId, c.count]));

    return allKbs.map((kb) => ({
      ...kb,
      sourceCount: sourceCountMap.get(kb.id) || 0,
      chunkCount: chunkCountMap.get(kb.id) || 0,
    }));
  });

  return c.json({ knowledgeBases: result });
});

// ============================================================================
// Create Knowledge Base
// ============================================================================

kbRoutes.post(
  "/",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createKbSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const kb = await withRequestRLS(c, async (tx) => {
      // Check quota
      const quotas = await tx.query.tenantQuotas.findFirst({
        where: eq(tenantQuotas.tenantId, authContext.tenantId!),
      });

      const kbCount = await tx
        .select({ count: sql<number>`count(*)` })
        .from(knowledgeBases)
        .where(
          and(
            eq(knowledgeBases.tenantId, authContext.tenantId!),
            isNull(knowledgeBases.deletedAt)
          )
        );

      if (quotas && kbCount[0].count >= quotas.maxKbs) {
        throw new QuotaExceededError("knowledge bases");
      }

      // Get the embedding model - either specified or default
      const registry = getAIRegistry();
      let embeddingModel = null;

      if (body.embeddingModelId) {
        // User specified a model - verify it exists and is an embedding model
        const models = await registry.listModels("embedding");
        embeddingModel = models.find(m => m.id === body.embeddingModelId);
        if (!embeddingModel) {
          throw new Error("INVALID_MODEL");
        }
      } else {
        // Use default embedding model
        embeddingModel = await registry.getDefaultModel("embedding");
      }

      const [newKb] = await tx
        .insert(knowledgeBases)
        .values({
          tenantId: authContext.tenantId,
          name: body.name,
          description: body.description,
          createdBy: authContext.user.id,
          isGlobal: false,
          // Capture the embedding model settings at KB creation time
          embeddingModelId: embeddingModel?.id || null,
          embeddingDimensions: embeddingModel?.dimensions || 768,
        })
        .returning();

      return newKb;
    });

    return c.json({ knowledgeBase: kb }, 201);
  }
);

// ============================================================================
// Get Knowledge Base
// ============================================================================

kbRoutes.get("/:kbId", auth(), requireTenant(), async (c) => {
  const kbId = c.req.param("kbId");
  const authContext = c.get("auth");

  const kb = await withRequestRLS(c, async (tx) => {
    const result = await tx.query.knowledgeBases.findFirst({
      where: and(eq(knowledgeBases.id, kbId), isNull(knowledgeBases.deletedAt)),
    });

    if (!result) {
      throw new NotFoundError("Knowledge base");
    }

    // Check access
    if (result.tenantId !== authContext.tenantId && !result.isGlobal) {
      throw new ForbiddenError("Access denied");
    }

    return result;
  });

  return c.json({ knowledgeBase: kb });
});

// ============================================================================
// Update Knowledge Base
// ============================================================================

kbRoutes.patch(
  "/:kbId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateKbSchema),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const kb = await withRequestRLS(c, async (tx) => {
      const [result] = await tx
        .update(knowledgeBases)
        .set(body)
        .where(
          and(
            eq(knowledgeBases.id, kbId),
            eq(knowledgeBases.tenantId, authContext.tenantId!),
            isNull(knowledgeBases.deletedAt)
          )
        )
        .returning();

      if (!result) {
        throw new NotFoundError("Knowledge base");
      }

      return result;
    });

    return c.json({ knowledgeBase: kb });
  }
);

// ============================================================================
// Reindex Knowledge Base (change embedding model)
// ============================================================================

kbRoutes.post(
  "/:kbId/reindex",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", reindexKbSchema),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const result = await withRequestRLS(c, async (tx) => {
      // Get the KB
      const kb = await tx.query.knowledgeBases.findFirst({
        where: and(
          eq(knowledgeBases.id, kbId),
          eq(knowledgeBases.tenantId, authContext.tenantId!),
          isNull(knowledgeBases.deletedAt)
        ),
      });

      if (!kb) {
        throw new NotFoundError("Knowledge base");
      }

      // Check if reindex is already in progress
      if (kb.reindexStatus === "pending" || kb.reindexStatus === "in_progress") {
        throw new ConflictError("A reindex is already in progress for this knowledge base");
      }

      // Verify the new embedding model exists
      const registry = getAIRegistry();
      const models = await registry.listModels("embedding");
      const newModel = models.find(m => m.id === body.embeddingModelId);
      
      if (!newModel) {
        throw new NotFoundError("Embedding model");
      }

      if (!newModel.dimensions) {
        throw new Error("Embedding model does not have dimensions configured");
      }

      const newModelDimensions = newModel.dimensions;

      // Check if the model is the same as current
      if (kb.embeddingModelId === body.embeddingModelId) {
        throw new ConflictError("The knowledge base already uses this embedding model");
      }

      // Update KB to mark reindex as pending
      const [updatedKb] = await tx
        .update(knowledgeBases)
        .set({
          reindexStatus: "pending",
          reindexProgress: 0,
          reindexError: null,
          pendingEmbeddingModelId: body.embeddingModelId,
          pendingEmbeddingDimensions: newModelDimensions,
          reindexStartedAt: new Date(),
        })
        .where(eq(knowledgeBases.id, kbId))
        .returning();

      return { kb: updatedKb, newModelDimensions };
    });

    // Queue the reindex job
    await addKbReindexJob({
      tenantId: authContext.tenantId!,
      kbId,
      newEmbeddingModelId: body.embeddingModelId,
      newEmbeddingDimensions: result.newModelDimensions,
      requestId: c.get("requestId"),
      traceId: c.get("traceId"),
    });

    return c.json({
      message: "Reindex started",
      knowledgeBase: result.kb,
    });
  }
);

// ============================================================================
// Cancel Reindex
// ============================================================================

kbRoutes.post(
  "/:kbId/reindex/cancel",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");

    const kb = await withRequestRLS(c, async (tx) => {
      // Get the KB
      const existingKb = await tx.query.knowledgeBases.findFirst({
        where: and(
          eq(knowledgeBases.id, kbId),
          eq(knowledgeBases.tenantId, authContext.tenantId!),
          isNull(knowledgeBases.deletedAt)
        ),
      });

      if (!existingKb) {
        throw new NotFoundError("Knowledge base");
      }

      // Can only cancel if in pending or in_progress state
      if (!existingKb.reindexStatus) {
        throw new ConflictError("No reindex is in progress");
      }

      // Clear reindex state (the worker will check this and stop)
      const [updatedKb] = await tx
        .update(knowledgeBases)
        .set({
          reindexStatus: null,
          reindexProgress: null,
          reindexError: null,
          pendingEmbeddingModelId: null,
          pendingEmbeddingDimensions: null,
          reindexStartedAt: null,
        })
        .where(eq(knowledgeBases.id, kbId))
        .returning();

      return updatedKb;
    });

    return c.json({
      message: "Reindex cancelled",
      knowledgeBase: kb,
    });
  }
);

// ============================================================================
// Delete Knowledge Base
// ============================================================================

kbRoutes.delete(
  "/:kbId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");

    await withRequestRLS(c, async (tx) => {
      const [kb] = await tx
        .update(knowledgeBases)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(knowledgeBases.id, kbId),
            eq(knowledgeBases.tenantId, authContext.tenantId!),
            isNull(knowledgeBases.deletedAt)
          )
        )
        .returning();

      if (!kb) {
        throw new NotFoundError("Knowledge base");
      }
    });

    return c.json({ message: "Knowledge base scheduled for deletion" });
  }
);

// ============================================================================
// Global KB Routes (System Admin)
// ============================================================================

// List global KBs (published)
kbRoutes.get("/global", auth(), async (c) => {
  const globalKbs = await withRequestRLS(c, async (tx) => {
    return tx.query.knowledgeBases.findMany({
      where: and(
        eq(knowledgeBases.isGlobal, true),
        sql`${knowledgeBases.publishedAt} IS NOT NULL`,
        isNull(knowledgeBases.deletedAt)
      ),
    });
  });

  return c.json({ knowledgeBases: globalKbs });
});

// Create global KB (System Admin only)
kbRoutes.post(
  "/global",
  auth(),
  requireSystemAdmin(),
  zValidator("json", createKbSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const kb = await withRequestRLS(c, async (tx) => {
      const [result] = await tx
        .insert(knowledgeBases)
        .values({
          tenantId: null,
          name: body.name,
          description: body.description,
          createdBy: authContext.user.id,
          isGlobal: true,
        })
        .returning();
      return result;
    });

    return c.json({ knowledgeBase: kb }, 201);
  }
);

// Publish global KB
kbRoutes.post(
  "/:kbId/publish",
  auth(),
  requireSystemAdmin(),
  async (c) => {
    const kbId = c.req.param("kbId");

    const kb = await withRequestRLS(c, async (tx) => {
      const [result] = await tx
        .update(knowledgeBases)
        .set({ publishedAt: new Date() })
        .where(
          and(
            eq(knowledgeBases.id, kbId),
            eq(knowledgeBases.isGlobal, true),
            isNull(knowledgeBases.deletedAt)
          )
        )
        .returning();

      if (!result) {
        throw new NotFoundError("Global knowledge base");
      }

      return result;
    });

    return c.json({ knowledgeBase: kb });
  }
);

// Unpublish global KB
kbRoutes.post(
  "/:kbId/unpublish",
  auth(),
  requireSystemAdmin(),
  async (c) => {
    const kbId = c.req.param("kbId");

    const kb = await withRequestRLS(c, async (tx) => {
      const [result] = await tx
        .update(knowledgeBases)
        .set({ publishedAt: null })
        .where(
          and(
            eq(knowledgeBases.id, kbId),
            eq(knowledgeBases.isGlobal, true),
            isNull(knowledgeBases.deletedAt)
          )
        )
        .returning();

      if (!result) {
        throw new NotFoundError("Global knowledge base");
      }

      return result;
    });

    return c.json({ knowledgeBase: kb });
  }
);

// Subscribe to global KB
kbRoutes.post(
  "/:kbId/subscribe",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");

    const alreadySubscribed = await withRequestRLS(c, async (tx) => {
      // Verify it's a published global KB
      const kb = await tx.query.knowledgeBases.findFirst({
        where: and(
          eq(knowledgeBases.id, kbId),
          eq(knowledgeBases.isGlobal, true),
          sql`${knowledgeBases.publishedAt} IS NOT NULL`,
          isNull(knowledgeBases.deletedAt)
        ),
      });

      if (!kb) {
        throw new NotFoundError("Published global knowledge base");
      }

      // Check if already subscribed
      const existing = await tx.query.tenantKbSubscriptions.findFirst({
        where: and(
          eq(tenantKbSubscriptions.tenantId, authContext.tenantId!),
          eq(tenantKbSubscriptions.kbId, kbId),
          isNull(tenantKbSubscriptions.deletedAt)
        ),
      });

      if (existing) {
        return true;
      }

      await tx.insert(tenantKbSubscriptions).values({
        tenantId: authContext.tenantId!,
        kbId,
        createdBy: authContext.user.id,
      });

      return false;
    });

    if (alreadySubscribed) {
      return c.json({ message: "Already subscribed" });
    }

    return c.json({ message: "Subscribed to knowledge base" }, 201);
  }
);

// Unsubscribe from global KB
kbRoutes.post(
  "/:kbId/unsubscribe",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");

    await withRequestRLS(c, async (tx) => {
      await tx
        .update(tenantKbSubscriptions)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(tenantKbSubscriptions.tenantId, authContext.tenantId!),
            eq(tenantKbSubscriptions.kbId, kbId),
            isNull(tenantKbSubscriptions.deletedAt)
          )
        );
    });

    return c.json({ message: "Unsubscribed from knowledge base" });
  }
);
