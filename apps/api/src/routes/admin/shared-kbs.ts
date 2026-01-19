import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  knowledgeBases,
  tenantKbSubscriptions,
  tenants,
  sources,
  users,
  sourceRuns,
  modelConfigurations,
  uploads,
  tenantUsage,
} from "@grounded/db/schema";
import { eq, and, isNull, inArray, desc, or, lt, sql } from "drizzle-orm";
import { addPageProcessJob, removeAllJobsForRun, unregisterRun } from "@grounded/queue";
import { log } from "@grounded/logger";
import { auth, requireSystemAdmin, withRequestRLS } from "../../middleware/auth";
import { NotFoundError, BadRequestError } from "../../middleware/error-handler";
import {
  createSourceBaseSchema,
  updateSourceSchema,
  triggerRunSchema,
  buildSourceUpdateData,
  calculateSourceStats,
  cascadeSoftDeleteSourceChunks,
  findRunningRun,
  createSourceRun,
  queueSourceRunJob,
} from "../../services/source-helpers";
import {
  SUPPORTED_MIME_TYPES,
  EXTENSION_TO_MIME,
  extractTextFromUpload,
} from "../../services/upload-helpers";
import {
  getKbCountMapsWithShares,
  getKbAggregatedCounts,
} from "../../services/kb-aggregation-helpers";

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

// ============================================================================
// List All Shared/Global Knowledge Bases (Admin View)
// ============================================================================

adminSharedKbsRoutes.get("/", async (c) => {
  const { globalKbs, sourceCountMap, chunkCountMap, shareCountMap, creatorMap } = await withRequestRLS(c, async (tx) => {
    const globalKbs = await tx.query.knowledgeBases.findMany({
      where: and(
        eq(knowledgeBases.isGlobal, true),
        isNull(knowledgeBases.deletedAt)
      ),
    });

    const kbIds = globalKbs.map((kb) => kb.id);

    const { sourceCountMap, chunkCountMap, shareCountMap } =
      await getKbCountMapsWithShares(tx, kbIds);

    const creatorIds = [...new Set(globalKbs.map((kb) => kb.createdBy))];
    const creators = creatorIds.length > 0 ? await tx
      .select({ id: users.id, email: users.primaryEmail })
      .from(users)
      .where(inArray(users.id, creatorIds)) : [];

    const creatorMap = new Map(creators.map((u) => [u.id, u.email]));

    return { globalKbs, sourceCountMap, chunkCountMap, shareCountMap, creatorMap };
  });

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
      let embeddingModelId = body.embeddingModelId;
      let embeddingDimensions = 768;

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
          embeddingModelId = undefined;
        }
      } else {
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
          tenantId: null,
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

  const { kb, counts, subscriptions, creator } = await withRequestRLS(c, async (tx) => {
    const kb = await tx.query.knowledgeBases.findFirst({
      where: and(
        eq(knowledgeBases.id, kbId),
        eq(knowledgeBases.isGlobal, true),
        isNull(knowledgeBases.deletedAt)
      ),
    });

    if (!kb) {
      return { kb: null, counts: null, subscriptions: [], creator: null };
    }

    const counts = await getKbAggregatedCounts(tx, kbId);

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

    const creator = await tx.query.users.findFirst({
      where: eq(users.id, kb.createdBy),
    });

    return { kb, counts, subscriptions, creator };
  });

  if (!kb) {
    throw new NotFoundError("Global knowledge base");
  }

  return c.json({
    knowledgeBase: {
      ...kb,
      sourceCount: counts?.sourceCount || 0,
      chunkCount: counts?.chunkCount || 0,
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
      const kb = await tx.query.knowledgeBases.findFirst({
        where: and(
          eq(knowledgeBases.id, kbId),
          eq(knowledgeBases.isGlobal, true),
          isNull(knowledgeBases.deletedAt)
        ),
      });

      const tenant = await tx.query.tenants.findFirst({
        where: and(
          eq(tenants.id, tenantId),
          isNull(tenants.deletedAt)
        ),
      });

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
    const allTenants = await tx.query.tenants.findMany({
      where: isNull(tenants.deletedAt),
    });

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
        lastRunStatus: lastRun?.status || null,
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
  zValidator("json", createSourceBaseSchema),
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    await verifyGlobalKb(c, kbId);

    const [source] = await withRequestRLS(c, async (tx) => {
      return tx
        .insert(sources)
        .values({
          tenantId: null,
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
// Upload Document to Global KB
// ============================================================================

adminSharedKbsRoutes.post(
  "/:kbId/uploads",
  async (c) => {
    const kbId = c.req.param("kbId");
    const authContext = c.get("auth");

    await verifyGlobalKb(c, kbId);

    const formData = await c.req.parseBody();
    const file = formData["file"];

    if (!file || typeof file === "string") {
      throw new BadRequestError("No file uploaded");
    }

    let mimeType = file.type;
    if (!SUPPORTED_MIME_TYPES[mimeType]) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (ext && EXTENSION_TO_MIME[ext]) {
        mimeType = EXTENSION_TO_MIME[ext];
      }
    }

    if (!SUPPORTED_MIME_TYPES[mimeType]) {
      const supportedExtensions = Object.keys(EXTENSION_TO_MIME).join(", ");
      throw new BadRequestError(
        `Unsupported file type. Supported formats: ${supportedExtensions}`
      );
    }

    const sourceName = formData["sourceName"];
    const sourceNameStr = typeof sourceName === "string" && sourceName.trim()
      ? sourceName.trim()
      : file.name;

    const existingSourceId = formData["sourceId"];

    const arrayBuffer = await file.arrayBuffer();
    const content = new Uint8Array(arrayBuffer);
    const sizeBytes = content.length;

    const { upload, uploadSource } = await withRequestRLS(c, async (tx) => {
      let source;
      if (typeof existingSourceId === "string" && existingSourceId.trim()) {
        source = await tx.query.sources.findFirst({
          where: and(
            eq(sources.id, existingSourceId),
            eq(sources.kbId, kbId),
            eq(sources.type, "upload"),
            isNull(sources.deletedAt)
          ),
        });

        if (!source) {
          throw new BadRequestError("Source not found");
        }
      } else {
        [source] = await tx
          .insert(sources)
          .values({
            tenantId: null,
            kbId,
            type: "upload",
            name: sourceNameStr,
            config: {
              mode: "single",
              depth: 1,
              includePatterns: [],
              excludePatterns: [],
              includeSubdomains: false,
              schedule: null,
              firecrawlEnabled: false,
              respectRobotsTxt: true,
            },
            enrichmentEnabled: false,
            createdBy: authContext.user.id,
          })
          .returning();
      }

      const [uploadRecord] = await tx
        .insert(uploads)
        .values({
          tenantId: null,
          kbId,
          sourceId: source.id,
          filename: file.name,
          mimeType,
          sizeBytes,
          status: "pending",
          createdBy: authContext.user.id,
        })
        .returning();

      return { upload: uploadRecord, uploadSource: source };
    });

    let extractedText: string;
    try {
      extractedText = await extractTextFromUpload(content, mimeType, file.name);
    } catch (err) {
      await withRequestRLS(c, async (tx) => {
        await tx
          .update(uploads)
          .set({
            status: "failed",
            error: err instanceof Error ? err.message : "Text extraction failed",
          })
          .where(eq(uploads.id, upload.id));
      });

      throw new BadRequestError("Failed to extract text from document");
    }

    const sourceRun = await withRequestRLS(c, async (tx) => {
      await tx
        .update(uploads)
        .set({
          extractedText,
          status: "processing",
        })
        .where(eq(uploads.id, upload.id));

      const [run] = await tx
        .insert(sourceRuns)
        .values({
          tenantId: null,
          sourceId: uploadSource.id,
          status: "running",
          trigger: "manual",
          forceReindex: false,
          startedAt: new Date(),
          stats: {
            pagesSeen: 1,
            pagesIndexed: 0,
            pagesFailed: 0,
            tokensEstimated: 0,
          },
        })
        .returning();

      await tx
        .update(uploads)
        .set({ sourceRunId: run.id })
        .where(eq(uploads.id, upload.id));

      return run;
    });

      await addPageProcessJob({
        tenantId: null,
        runId: sourceRun.id,
        url: `upload://${upload.id}/${file.name}`,
        html: extractedText,
        title: file.name,
        sourceType: "upload",
        uploadMetadata: {
          uploadId: upload.id,
          filename: upload.filename,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
        },
      });


    return c.json(
      {
        upload: {
          id: upload.id,
          sourceId: uploadSource.id,
          filename: upload.filename,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          status: "processing",
        },
      },
      201
    );
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

    const updateData = buildSourceUpdateData(existingSource.config, body);

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
      await cascadeSoftDeleteSourceChunks(tx, sourceId);
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

    const result = await withRequestRLS(c, async (tx) => {
      const source = await tx.query.sources.findFirst({
        where: and(
          eq(sources.id, sourceId),
          eq(sources.kbId, kbId),
          isNull(sources.deletedAt)
        ),
      });

      if (!source) {
        return { source: null as null };
      }

      const runningRun = await findRunningRun(tx, sourceId);

      if (runningRun) {
        return { source, error: "A run is already in progress" as const };
      }

      const run = await createSourceRun(tx, {
        tenantId: null,
        sourceId,
        forceReindex,
      });

      return { source, run };
    });

    if (!result.source) {
      throw new NotFoundError("Source");
    }

    if ("error" in result) {
      return c.json({ error: result.error }, 409);
    }

    await queueSourceRunJob({
      tenantId: null,
      sourceId,
      runId: result.run!.id,
      requestId: c.get("requestId"),
      traceId: c.get("traceId"),
    });

    return c.json({ run: result.run }, 201);
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
// Cancel Source Run
// ============================================================================

adminSharedKbsRoutes.post(
  "/:kbId/sources/:sourceId/runs/:runId/cancel",
  async (c) => {
    const kbId = c.req.param("kbId");
    const sourceId = c.req.param("sourceId");
    const runId = c.req.param("runId");

    await verifyGlobalKb(c, kbId);

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
            eq(sourceRuns.sourceId, sourceId),
            inArray(sourceRuns.status, ["running", "pending"])
          )
        )
        .returning();

      return run;
    });

    if (!run) {
      throw new NotFoundError("Cancelable source run");
    }

    // Clean up pending jobs for this run to prevent queue blockage
    // Also unregister from fairness scheduler to free up slots
    Promise.all([
      removeAllJobsForRun(runId),
      unregisterRun(runId),
    ]).then(([removed]) => {
      if (removed.total > 0) {
        log.info("api", "Cleaned up pending jobs for canceled run", {
          runId,
          removedJobs: removed,
        });
      }
    }).catch((error) => {
      log.error("api", "Failed to clean up jobs for canceled run", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return c.json({ run });
  }
);

// ============================================================================
// Get Source Stats
// ============================================================================

adminSharedKbsRoutes.get("/:kbId/sources/:sourceId/stats", async (c) => {
  const kbId = c.req.param("kbId");
  const sourceId = c.req.param("sourceId");

  await verifyGlobalKb(c, kbId);

  const result = await withRequestRLS(c, async (tx) => {
    const source = await tx.query.sources.findFirst({
      where: and(
        eq(sources.id, sourceId),
        eq(sources.kbId, kbId),
        isNull(sources.deletedAt)
      ),
    });

    if (!source) {
      return { source: null as null };
    }

    const stats = await calculateSourceStats(tx, sourceId);
    return { source, stats };
  });

  if (!result.source) {
    throw new NotFoundError("Source");
  }

  return c.json({ stats: result.stats });
});
