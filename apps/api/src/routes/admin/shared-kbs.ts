import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import { knowledgeBases, tenantKbSubscriptions, tenants, sources, kbChunks, users, sourceRuns, sourceRunPages, modelConfigurations } from "@grounded/db/schema";
import { eq, and, isNull, sql, inArray, desc } from "drizzle-orm";
import { sourceConfigSchema } from "@grounded/shared";
import { addSourceRunStartJob } from "@grounded/queue";
import { auth, requireSystemAdmin, withRequestRLS } from "../../middleware/auth";
import { NotFoundError, BadRequestError } from "../../middleware/error-handler";

export const adminSharedKbsRoutes = new Hono();

// All routes require system admin
adminSharedKbsRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// Validation Schemas
// ============================================================================

const createGlobalKbSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  embeddingModelId: z.string().uuid().optional(),
});

const updateGlobalKbSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const shareWithTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

const createSourceSchema = z.object({
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

const triggerRunSchema = z.object({
  forceReindex: z.boolean().optional().default(false),
});

// ============================================================================
// List All Shared/Global Knowledge Bases (Admin View)
// ============================================================================

adminSharedKbsRoutes.get("/", async (c) => {
  const { globalKbs, sourceCounts, chunkCounts, shareCounts, creators } = await withRequestRLS(c, async (tx) => {
    // Get ALL global KBs (both published and unpublished)
    const globalKbs = await tx.query.knowledgeBases.findMany({
      where: and(
        eq(knowledgeBases.isGlobal, true),
        isNull(knowledgeBases.deletedAt)
      ),
    });

    const kbIds = globalKbs.map((kb) => kb.id);

    // Get source counts
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

    // Get chunk counts
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

    // Get subscription counts (how many tenants each KB is shared with)
    const shareCounts = kbIds.length > 0 ? await tx
      .select({
        kbId: tenantKbSubscriptions.kbId,
        count: sql<number>`count(*)::int`,
      })
      .from(tenantKbSubscriptions)
      .where(and(
        inArray(tenantKbSubscriptions.kbId, kbIds),
        isNull(tenantKbSubscriptions.deletedAt)
      ))
      .groupBy(tenantKbSubscriptions.kbId) : [];

    // Get creator info
    const creatorIds = [...new Set(globalKbs.map((kb) => kb.createdBy))];
    const creators = creatorIds.length > 0 ? await tx
      .select({ id: users.id, email: users.primaryEmail })
      .from(users)
      .where(inArray(users.id, creatorIds)) : [];

    return { globalKbs, sourceCounts, chunkCounts, shareCounts, creators };
  });

  const sourceCountMap = new Map(sourceCounts.map((s) => [s.kbId, s.count]));
  const chunkCountMap = new Map(chunkCounts.map((c) => [c.kbId, c.count]));
  const shareCountMap = new Map(shareCounts.map((s) => [s.kbId, s.count]));
  const creatorMap = new Map(creators.map((u) => [u.id, u.email]));

  return c.json({
    knowledgeBases: globalKbs.map((kb) => ({
      ...kb,
      sourceCount: sourceCountMap.get(kb.id) || 0,
      chunkCount: chunkCountMap.get(kb.id) || 0,
      shareCount: shareCountMap.get(kb.id) || 0,
      isPublished: !!kb.publishedAt,
      creatorEmail: creatorMap.get(kb.createdBy),
    })),
  });
});

// ============================================================================
// Create Global Knowledge Base
// ============================================================================

adminSharedKbsRoutes.post(
  "/",
  zValidator("json", createGlobalKbSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const kb = await withRequestRLS(c, async (tx) => {
      // If embeddingModelId is provided, get the dimensions from the model
      let embeddingModelId = body.embeddingModelId;
      let embeddingDimensions = 768; // Default dimensions

      if (embeddingModelId) {
        const model = await tx.query.modelConfigurations.findFirst({
          where: and(
            eq(modelConfigurations.id, embeddingModelId),
            eq(modelConfigurations.modelType, "embedding"),
            eq(modelConfigurations.isEnabled, true)
          ),
        });

        if (model) {
          embeddingDimensions = model.dimensions || 768;
        } else {
          // Model not found or not enabled, use default
          embeddingModelId = undefined;
        }
      } else {
        // No model specified, try to get the default embedding model
        const defaultModel = await tx.query.modelConfigurations.findFirst({
          where: and(
            eq(modelConfigurations.modelType, "embedding"),
            eq(modelConfigurations.isDefault, true),
            eq(modelConfigurations.isEnabled, true)
          ),
        });

        if (defaultModel) {
          embeddingModelId = defaultModel.id;
          embeddingDimensions = defaultModel.dimensions || 768;
        }
      }

      const [kb] = await tx
        .insert(knowledgeBases)
        .values({
          tenantId: null, // Global KBs have no tenant
          name: body.name,
          description: body.description,
          createdBy: authContext.user.id,
          isGlobal: true,
          embeddingModelId,
          embeddingDimensions,
        })
        .returning();

      return kb;
    });

    return c.json({ knowledgeBase: kb }, 201);
  }
);

// ============================================================================
// Get Global Knowledge Base Details
// ============================================================================

adminSharedKbsRoutes.get("/:kbId", async (c) => {
  const kbId = c.req.param("kbId");

  const { kb, sourceCount, chunkCount, subscriptions, creator } = await withRequestRLS(c, async (tx) => {
    const kb = await tx.query.knowledgeBases.findFirst({
      where: and(
        eq(knowledgeBases.id, kbId),
        eq(knowledgeBases.isGlobal, true),
        isNull(knowledgeBases.deletedAt)
      ),
    });

    if (!kb) {
      return { kb: null, sourceCount: null, chunkCount: null, subscriptions: [], creator: null };
    }

    // Get source count
    const [sourceCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(sources)
      .where(and(
        eq(sources.kbId, kbId),
        isNull(sources.deletedAt)
      ));

    // Get chunk count
    const [chunkCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(kbChunks)
      .where(and(
        eq(kbChunks.kbId, kbId),
        isNull(kbChunks.deletedAt)
      ));

    // Get subscriptions (tenants this KB is shared with)
    const subscriptions = await tx
      .select({
        tenantId: tenantKbSubscriptions.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        sharedAt: tenantKbSubscriptions.createdAt,
      })
      .from(tenantKbSubscriptions)
      .innerJoin(tenants, eq(tenants.id, tenantKbSubscriptions.tenantId))
      .where(and(
        eq(tenantKbSubscriptions.kbId, kbId),
        isNull(tenantKbSubscriptions.deletedAt),
        isNull(tenants.deletedAt)
      ));

    // Get creator info
    const creator = await tx.query.users.findFirst({
      where: eq(users.id, kb.createdBy),
    });

    return { kb, sourceCount, chunkCount, subscriptions, creator };
  });

  if (!kb) {
    throw new NotFoundError("Global knowledge base");
  }

  return c.json({
    knowledgeBase: {
      ...kb,
      sourceCount: sourceCount?.count || 0,
      chunkCount: chunkCount?.count || 0,
      isPublished: !!kb.publishedAt,
      creatorEmail: creator?.primaryEmail,
      sharedWithTenants: subscriptions.map((s) => ({
        id: s.tenantId,
        name: s.tenantName,
        slug: s.tenantSlug,
        sharedAt: s.sharedAt,
      })),
    },
  });
});

// ============================================================================
// Update Global Knowledge Base
// ============================================================================

adminSharedKbsRoutes.patch(
  "/:kbId",
  zValidator("json", updateGlobalKbSchema),
  async (c) => {
    const kbId = c.req.param("kbId");
    const body = c.req.valid("json");

    const [kb] = await withRequestRLS(c, async (tx) => {
      return tx
        .update(knowledgeBases)
        .set(body)
        .where(
          and(
            eq(knowledgeBases.id, kbId),
            eq(knowledgeBases.isGlobal, true),
            isNull(knowledgeBases.deletedAt)
          )
        )
        .returning();
    });

    if (!kb) {
      throw new NotFoundError("Global knowledge base");
    }

    return c.json({ knowledgeBase: kb });
  }
);

// ============================================================================
// Delete Global Knowledge Base
// ============================================================================

adminSharedKbsRoutes.delete("/:kbId", async (c) => {
  const kbId = c.req.param("kbId");

  const kb = await withRequestRLS(c, async (tx) => {
    const [kb] = await tx
      .update(knowledgeBases)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(knowledgeBases.id, kbId),
          eq(knowledgeBases.isGlobal, true),
          isNull(knowledgeBases.deletedAt)
        )
      )
      .returning();

    if (kb) {
      // Also soft-delete all subscriptions
      await tx
        .update(tenantKbSubscriptions)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(tenantKbSubscriptions.kbId, kbId),
            isNull(tenantKbSubscriptions.deletedAt)
          )
        );
    }

    return kb;
  });

  if (!kb) {
    throw new NotFoundError("Global knowledge base");
  }

  return c.json({ message: "Global knowledge base deleted" });
});

// ============================================================================
// Publish Global Knowledge Base
// ============================================================================

adminSharedKbsRoutes.post("/:kbId/publish", async (c) => {
  const kbId = c.req.param("kbId");

  const [kb] = await withRequestRLS(c, async (tx) => {
    return tx
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
  });

  if (!kb) {
    throw new NotFoundError("Global knowledge base");
  }

  return c.json({ knowledgeBase: kb, message: "Knowledge base published - now visible to all tenants" });
});

// ============================================================================
// Unpublish Global Knowledge Base
// ============================================================================

adminSharedKbsRoutes.post("/:kbId/unpublish", async (c) => {
  const kbId = c.req.param("kbId");

  const [kb] = await withRequestRLS(c, async (tx) => {
    return tx
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
  });

  if (!kb) {
    throw new NotFoundError("Global knowledge base");
  }

  return c.json({ knowledgeBase: kb, message: "Knowledge base unpublished - only visible to specifically shared tenants" });
});

// ============================================================================
// Share with Specific Tenant
// ============================================================================

adminSharedKbsRoutes.post(
  "/:kbId/shares",
  zValidator("json", shareWithTenantSchema),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");
    const { tenantId } = c.req.valid("json");

    const { kb, tenant, existing } = await withRequestRLS(c, async (tx) => {
      // Verify KB exists and is global
      const kb = await tx.query.knowledgeBases.findFirst({
        where: and(
          eq(knowledgeBases.id, kbId),
          eq(knowledgeBases.isGlobal, true),
          isNull(knowledgeBases.deletedAt)
        ),
      });

      // Verify tenant exists
      const tenant = await tx.query.tenants.findFirst({
        where: and(
          eq(tenants.id, tenantId),
          isNull(tenants.deletedAt)
        ),
      });

      // Check if already shared
      const existing = kb && tenant ? await tx.query.tenantKbSubscriptions.findFirst({
        where: and(
          eq(tenantKbSubscriptions.tenantId, tenantId),
          eq(tenantKbSubscriptions.kbId, kbId),
          isNull(tenantKbSubscriptions.deletedAt)
        ),
      }) : null;

      return { kb, tenant, existing };
    });

    if (!kb) {
      throw new NotFoundError("Global knowledge base");
    }

    if (!tenant) {
      throw new NotFoundError("Tenant");
    }

    if (existing) {
      throw new BadRequestError("Knowledge base is already shared with this tenant");
    }

    await withRequestRLS(c, async (tx) => {
      return tx.insert(tenantKbSubscriptions).values({
        tenantId,
        kbId,
        createdBy: authContext.user.id,
      });
    });

    return c.json({
      message: `Knowledge base shared with ${tenant.name}`,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    }, 201);
  }
);

// ============================================================================
// Remove Share from Tenant
// ============================================================================

adminSharedKbsRoutes.delete("/:kbId/shares/:tenantId", async (c) => {
  const kbId = c.req.param("kbId");
  const tenantId = c.req.param("tenantId");

  const { kb, result } = await withRequestRLS(c, async (tx) => {
    // Verify KB exists and is global
    const kb = await tx.query.knowledgeBases.findFirst({
      where: and(
        eq(knowledgeBases.id, kbId),
        eq(knowledgeBases.isGlobal, true),
        isNull(knowledgeBases.deletedAt)
      ),
    });

    if (!kb) {
      return { kb: null, result: [] };
    }

    const result = await tx
      .update(tenantKbSubscriptions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(tenantKbSubscriptions.tenantId, tenantId),
          eq(tenantKbSubscriptions.kbId, kbId),
          isNull(tenantKbSubscriptions.deletedAt)
        )
      )
      .returning();

    return { kb, result };
  });

  if (!kb) {
    throw new NotFoundError("Global knowledge base");
  }

  if (result.length === 0) {
    throw new NotFoundError("Share");
  }

  return c.json({ message: "Share removed" });
});

// ============================================================================
// List All Tenants (for sharing dropdown)
// ============================================================================

adminSharedKbsRoutes.get("/:kbId/available-tenants", async (c) => {
  const kbId = c.req.param("kbId");

  const { allTenants, sharedTenants } = await withRequestRLS(c, async (tx) => {
    // Get all tenants
    const allTenants = await tx.query.tenants.findMany({
      where: isNull(tenants.deletedAt),
    });

    // Get already shared tenant IDs
    const sharedTenants = await tx
      .select({ tenantId: tenantKbSubscriptions.tenantId })
      .from(tenantKbSubscriptions)
      .where(and(
        eq(tenantKbSubscriptions.kbId, kbId),
        isNull(tenantKbSubscriptions.deletedAt)
      ));

    return { allTenants, sharedTenants };
  });

  const sharedSet = new Set(sharedTenants.map((s) => s.tenantId));

  return c.json({
    tenants: allTenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      isShared: sharedSet.has(t.id),
    })),
  });
});

// ============================================================================
// SOURCE MANAGEMENT FOR GLOBAL KBs
// ============================================================================

// Helper to verify global KB exists
async function verifyGlobalKb(c: any, kbId: string) {
  const kb = await withRequestRLS(c, async (tx) => {
    return tx.query.knowledgeBases.findFirst({
      where: and(
        eq(knowledgeBases.id, kbId),
        eq(knowledgeBases.isGlobal, true),
        isNull(knowledgeBases.deletedAt)
      ),
    });
  });
  if (!kb) {
    throw new NotFoundError("Global knowledge base");
  }
  return kb;
}

// ============================================================================
// List Sources for Global KB
// ============================================================================

adminSharedKbsRoutes.get("/:kbId/sources", async (c) => {
  const kbId = c.req.param("kbId");
  await verifyGlobalKb(c, kbId);

  const { sourcesResult, lastRuns } = await withRequestRLS(c, async (tx) => {
    const sourcesResult = await tx.query.sources.findMany({
      where: and(eq(sources.kbId, kbId), isNull(sources.deletedAt)),
      orderBy: [desc(sources.createdAt)],
    });

    // Get last run info for each source
    const sourceIds = sourcesResult.map((s) => s.id);
    const lastRuns = sourceIds.length > 0 ? await tx
      .select({
        sourceId: sourceRuns.sourceId,
        status: sourceRuns.status,
        createdAt: sourceRuns.createdAt,
      })
      .from(sourceRuns)
      .where(inArray(sourceRuns.sourceId, sourceIds))
      .orderBy(desc(sourceRuns.createdAt)) : [];

    return { sourcesResult, lastRuns };
  });

  // Create map of latest run per source
  const lastRunMap = new Map<string, { status: string; createdAt: Date }>();
  for (const run of lastRuns) {
    if (!lastRunMap.has(run.sourceId)) {
      lastRunMap.set(run.sourceId, { status: run.status, createdAt: run.createdAt });
    }
  }

  return c.json({
    sources: sourcesResult.map((source) => {
      const lastRun = lastRunMap.get(source.id);
      return {
        ...source,
        status: lastRun?.status || "new",
        lastRunAt: lastRun?.createdAt || null,
      };
    }),
  });
});

// ============================================================================
// Create Source for Global KB
// ============================================================================

adminSharedKbsRoutes.post(
  "/:kbId/sources",
  zValidator("json", createSourceSchema),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    await verifyGlobalKb(c, kbId);

    const [source] = await withRequestRLS(c, async (tx) => {
      return tx
        .insert(sources)
        .values({
          tenantId: null, // Global KB sources have no tenant
          kbId,
          name: body.name,
          type: body.type,
          config: body.config,
          enrichmentEnabled: body.enrichmentEnabled,
          createdBy: authContext.user.id,
        })
        .returning();
    });

    return c.json({ source }, 201);
  }
);

// ============================================================================
// Get Source
// ============================================================================

adminSharedKbsRoutes.get("/:kbId/sources/:sourceId", async (c) => {
  const kbId = c.req.param("kbId");
  const sourceId = c.req.param("sourceId");

  await verifyGlobalKb(c, kbId);

  const source = await withRequestRLS(c, async (tx) => {
    return tx.query.sources.findFirst({
      where: and(
        eq(sources.id, sourceId),
        eq(sources.kbId, kbId),
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

adminSharedKbsRoutes.patch(
  "/:kbId/sources/:sourceId",
  zValidator("json", updateSourceSchema),
  async (c) => {
    const kbId = c.req.param("kbId");
    const sourceId = c.req.param("sourceId");
    const body = c.req.valid("json");

    await verifyGlobalKb(c, kbId);

    const existingSource = await withRequestRLS(c, async (tx) => {
      return tx.query.sources.findFirst({
        where: and(
          eq(sources.id, sourceId),
          eq(sources.kbId, kbId),
          isNull(sources.deletedAt)
        ),
      });
    });

    if (!existingSource) {
      throw new NotFoundError("Source");
    }

    const updateData: Record<string, unknown> = {};
    if (body.name) updateData.name = body.name;
    if (body.enrichmentEnabled !== undefined)
      updateData.enrichmentEnabled = body.enrichmentEnabled;
    if (body.config) {
      updateData.config = { ...existingSource.config, ...body.config };
    }

    const [source] = await withRequestRLS(c, async (tx) => {
      return tx
        .update(sources)
        .set(updateData)
        .where(eq(sources.id, sourceId))
        .returning();
    });

    return c.json({ source });
  }
);

// ============================================================================
// Delete Source
// ============================================================================

adminSharedKbsRoutes.delete("/:kbId/sources/:sourceId", async (c) => {
  const kbId = c.req.param("kbId");
  const sourceId = c.req.param("sourceId");

  await verifyGlobalKb(c, kbId);

  const source = await withRequestRLS(c, async (tx) => {
    const [source] = await tx
      .update(sources)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(sources.id, sourceId),
          eq(sources.kbId, kbId),
          isNull(sources.deletedAt)
        )
      )
      .returning();

    if (source) {
      // Also soft-delete all chunks from this source
      await tx
        .update(kbChunks)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(kbChunks.sourceId, sourceId),
            isNull(kbChunks.deletedAt)
          )
        );
    }

    return source;
  });

  if (!source) {
    throw new NotFoundError("Source");
  }

  return c.json({ message: "Source scheduled for deletion" });
});

// ============================================================================
// Trigger Source Run
// ============================================================================

adminSharedKbsRoutes.post(
  "/:kbId/sources/:sourceId/runs",
  zValidator("json", triggerRunSchema.optional()),
  async (c) => {
    const kbId = c.req.param("kbId");
    const sourceId = c.req.param("sourceId");
    const body = c.req.valid("json") || { forceReindex: false };
    const forceReindex = body.forceReindex ?? false;

    await verifyGlobalKb(c, kbId);

    const { source, runningRun } = await withRequestRLS(c, async (tx) => {
      const source = await tx.query.sources.findFirst({
        where: and(
          eq(sources.id, sourceId),
          eq(sources.kbId, kbId),
          isNull(sources.deletedAt)
        ),
      });

      // Check for running runs
      const runningRun = source ? await tx.query.sourceRuns.findFirst({
        where: and(
          eq(sourceRuns.sourceId, sourceId),
          eq(sourceRuns.status, "running")
        ),
      }) : null;

      return { source, runningRun };
    });

    if (!source) {
      throw new NotFoundError("Source");
    }

    if (runningRun) {
      return c.json({ error: "A run is already in progress" }, 409);
    }

    // Create new run (tenantId null for global KB)
    const [run] = await withRequestRLS(c, async (tx) => {
      return tx
        .insert(sourceRuns)
        .values({
          tenantId: null,
          sourceId,
          trigger: "manual",
          status: "pending",
          forceReindex,
        })
        .returning();
    });

    // Queue the run (pass null for tenantId)
    await addSourceRunStartJob({
      tenantId: null as any, // Global KB run
      sourceId,
      runId: run.id,
      requestId: c.get("requestId"),
      traceId: c.get("traceId"),
    });

    return c.json({ run }, 201);
  }
);

// ============================================================================
// List Source Runs
// ============================================================================

adminSharedKbsRoutes.get("/:kbId/sources/:sourceId/runs", async (c) => {
  const kbId = c.req.param("kbId");
  const sourceId = c.req.param("sourceId");
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");

  await verifyGlobalKb(c, kbId);

  const { source, runs } = await withRequestRLS(c, async (tx) => {
    const source = await tx.query.sources.findFirst({
      where: and(
        eq(sources.id, sourceId),
        eq(sources.kbId, kbId),
        isNull(sources.deletedAt)
      ),
    });

    const runs = source ? await tx.query.sourceRuns.findMany({
      where: eq(sourceRuns.sourceId, sourceId),
      orderBy: [desc(sourceRuns.createdAt)],
      limit,
      offset,
    }) : [];

    return { source, runs };
  });

  if (!source) {
    throw new NotFoundError("Source");
  }

  return c.json({ runs });
});

// ============================================================================
// Get Source Stats
// ============================================================================

adminSharedKbsRoutes.get("/:kbId/sources/:sourceId/stats", async (c) => {
  const kbId = c.req.param("kbId");
  const sourceId = c.req.param("sourceId");

  await verifyGlobalKb(c, kbId);

  const { source, pageCount, chunkCount } = await withRequestRLS(c, async (tx) => {
    const source = await tx.query.sources.findFirst({
      where: and(
        eq(sources.id, sourceId),
        eq(sources.kbId, kbId),
        isNull(sources.deletedAt)
      ),
    });

    if (!source) {
      return { source: null, pageCount: 0, chunkCount: 0 };
    }

    // Get total unique page count across all runs for this source
    const pageResult = await tx.execute(sql`
      SELECT COUNT(DISTINCT srp.normalized_url)::int as count
      FROM source_run_pages srp
      JOIN source_runs sr ON sr.id = srp.source_run_id
      WHERE sr.source_id = ${sourceId}
        AND srp.status = 'succeeded'
    `);
    const pageRows = Array.isArray(pageResult) ? pageResult : (pageResult as any).rows || [];
    const pageCount = (pageRows[0] as any)?.count || 0;

    // Get chunk count for this source
    const chunkResult = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(kbChunks)
      .where(and(
        eq(kbChunks.sourceId, sourceId),
        isNull(kbChunks.deletedAt)
      ));
    const chunkCount = chunkResult[0]?.count || 0;

    return { source, pageCount, chunkCount };
  });

  if (!source) {
    throw new NotFoundError("Source");
  }

  return c.json({
    stats: {
      pageCount,
      chunkCount,
    }
  });
});
