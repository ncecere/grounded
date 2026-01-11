import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@kcb/db";
import {
  knowledgeBases,
  tenantKbSubscriptions,
  tenantQuotas,
  sources,
  kbChunks,
} from "@kcb/db/schema";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { auth, requireRole, requireTenant, requireSystemAdmin } from "../middleware/auth";
import { NotFoundError, QuotaExceededError, ForbiddenError } from "../middleware/error-handler";
import { getAIRegistry } from "@kcb/ai-providers";

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

// ============================================================================
// List Knowledge Bases
// ============================================================================

kbRoutes.get("/", auth(), requireTenant(), async (c) => {
  const authContext = c.get("auth");

  // Get tenant's own KBs
  const ownKbs = await db.query.knowledgeBases.findMany({
    where: and(
      eq(knowledgeBases.tenantId, authContext.tenantId!),
      isNull(knowledgeBases.deletedAt)
    ),
  });

  // Get source and chunk counts for each KB
  const kbIds = ownKbs.map((kb) => kb.id);

  // Get source counts
  const sourceCounts = kbIds.length > 0 ? await db
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

  // Get chunk counts
  const chunkCounts = kbIds.length > 0 ? await db
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

  // Get subscribed global KBs
  const subscriptions = await db
    .select({
      kb: knowledgeBases,
    })
    .from(tenantKbSubscriptions)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, tenantKbSubscriptions.kbId))
    .where(
      and(
        eq(tenantKbSubscriptions.tenantId, authContext.tenantId!),
        isNull(tenantKbSubscriptions.deletedAt),
        eq(knowledgeBases.isGlobal, true),
        sql`${knowledgeBases.publishedAt} IS NOT NULL`
      )
    );

  const subscribedKbs = subscriptions.map((s) => ({
    ...s.kb,
    isSubscribed: true,
    sourceCount: 0,
    chunkCount: 0,
  }));

  return c.json({
    knowledgeBases: [
      ...ownKbs.map((kb) => ({
        ...kb,
        isSubscribed: false,
        sourceCount: sourceCountMap.get(kb.id) || 0,
        chunkCount: chunkCountMap.get(kb.id) || 0,
      })),
      ...subscribedKbs,
    ],
  });
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

    // Check quota
    const quotas = await db.query.tenantQuotas.findFirst({
      where: eq(tenantQuotas.tenantId, authContext.tenantId!),
    });

    const kbCount = await db
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
        return c.json({
          error: "INVALID_MODEL",
          message: "Specified embedding model not found or not an embedding model"
        }, 400);
      }
    } else {
      // Use default embedding model
      embeddingModel = await registry.getDefaultModel("embedding");
    }

    const [kb] = await db
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

    return c.json({ knowledgeBase: kb }, 201);
  }
);

// ============================================================================
// Get Knowledge Base
// ============================================================================

kbRoutes.get("/:kbId", auth(), requireTenant(), async (c) => {
  const kbId = c.req.param("kbId");
  const authContext = c.get("auth");

  const kb = await db.query.knowledgeBases.findFirst({
    where: and(eq(knowledgeBases.id, kbId), isNull(knowledgeBases.deletedAt)),
  });

  if (!kb) {
    throw new NotFoundError("Knowledge base");
  }

  // Check access
  if (kb.tenantId !== authContext.tenantId && !kb.isGlobal) {
    throw new ForbiddenError("Access denied");
  }

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

    const [kb] = await db
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

    if (!kb) {
      throw new NotFoundError("Knowledge base");
    }

    return c.json({ knowledgeBase: kb });
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

    const [kb] = await db
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

    return c.json({ message: "Knowledge base scheduled for deletion" });
  }
);

// ============================================================================
// Global KB Routes (System Admin)
// ============================================================================

// List global KBs (published)
kbRoutes.get("/global", auth(), async (c) => {
  const globalKbs = await db.query.knowledgeBases.findMany({
    where: and(
      eq(knowledgeBases.isGlobal, true),
      sql`${knowledgeBases.publishedAt} IS NOT NULL`,
      isNull(knowledgeBases.deletedAt)
    ),
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

    const [kb] = await db
      .insert(knowledgeBases)
      .values({
        tenantId: null,
        name: body.name,
        description: body.description,
        createdBy: authContext.user.id,
        isGlobal: true,
      })
      .returning();

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

    const [kb] = await db
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

    if (!kb) {
      throw new NotFoundError("Global knowledge base");
    }

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

    const [kb] = await db
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

    if (!kb) {
      throw new NotFoundError("Global knowledge base");
    }

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

    // Verify it's a published global KB
    const kb = await db.query.knowledgeBases.findFirst({
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
    const existing = await db.query.tenantKbSubscriptions.findFirst({
      where: and(
        eq(tenantKbSubscriptions.tenantId, authContext.tenantId!),
        eq(tenantKbSubscriptions.kbId, kbId),
        isNull(tenantKbSubscriptions.deletedAt)
      ),
    });

    if (existing) {
      return c.json({ message: "Already subscribed" });
    }

    await db.insert(tenantKbSubscriptions).values({
      tenantId: authContext.tenantId!,
      kbId,
      createdBy: authContext.user.id,
    });

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

    await db
      .update(tenantKbSubscriptions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(tenantKbSubscriptions.tenantId, authContext.tenantId!),
          eq(tenantKbSubscriptions.kbId, kbId),
          isNull(tenantKbSubscriptions.deletedAt)
        )
      );

    return c.json({ message: "Unsubscribed from knowledge base" });
  }
);
