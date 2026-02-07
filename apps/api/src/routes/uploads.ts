import { Hono } from "hono";
import { db } from "@grounded/db";
import { uploads, sources, knowledgeBases, tenantQuotas, tenantUsage, sourceRuns, kbChunks } from "@grounded/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { addPageProcessJob, initializeStageProgress } from "@grounded/queue";
import { SourceRunStage } from "@grounded/shared";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { NotFoundError, QuotaExceededError, BadRequestError } from "../middleware/error-handler";
import { SUPPORTED_MIME_TYPES, EXTENSION_TO_MIME, extractTextFromUpload } from "../services/upload-helpers";

export const uploadRoutes = new Hono();

// ============================================================================
// List Uploads for KB
// ============================================================================

uploadRoutes.get("/kb/:kbId", auth(), requireTenant(), async (c) => {
  const kbId = c.req.param("kbId");
  const sourceId = c.req.query("sourceId");
  const authContext = c.get("auth");

  const result = await withRequestRLS(c, async (tx) => {
    // Verify KB access
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

    const conditions = [eq(uploads.kbId, kbId), isNull(uploads.deletedAt)];
    if (sourceId) {
      conditions.push(eq(uploads.sourceId, sourceId));
    }

    const uploadsList = await tx.query.uploads.findMany({
      where: and(...conditions),
    });

    return uploadsList;
  });

  return c.json({ uploads: result });
});

// ============================================================================
// File Stats (chunk counts per file)
// ============================================================================

uploadRoutes.get("/kb/:kbId/file-stats", auth(), requireTenant(), async (c) => {
  const kbId = c.req.param("kbId");
  const sourceId = c.req.query("sourceId");
  const authContext = c.get("auth");

  if (!sourceId) {
    throw new BadRequestError("sourceId query parameter is required");
  }

  const result = await withRequestRLS(c, async (tx) => {
    // Verify KB access
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

    // Group chunks by normalizedUrl to get per-file counts
    const rows = await tx
      .select({
        normalizedUrl: kbChunks.normalizedUrl,
        count: sql<number>`count(*)::int`,
      })
      .from(kbChunks)
      .where(
        and(
          eq(kbChunks.sourceId, sourceId),
          isNull(kbChunks.deletedAt),
          sql`${kbChunks.normalizedUrl} LIKE 'upload://%'`
        )
      )
      .groupBy(kbChunks.normalizedUrl);

    const stats: Record<string, number> = {};
    for (const row of rows) {
      if (row.normalizedUrl) {
        stats[row.normalizedUrl] = row.count;
      }
    }

    return stats;
  });

  return c.json({ stats: result });
});

// ============================================================================
// Upload Document
// ============================================================================

uploadRoutes.post("/kb/:kbId", auth(), requireTenant(), requireRole("owner", "admin"), async (c) => {
  const kbId = c.req.param("kbId");
  const authContext = c.get("auth");

  // Parse multipart form OUTSIDE the transaction
  const formData = await c.req.parseBody();
  const file = formData["file"];

  if (!file || typeof file === "string") {
    throw new BadRequestError("No file uploaded");
  }

  // Determine MIME type - use file type or fallback to extension
  let mimeType = file.type;
  if (!SUPPORTED_MIME_TYPES[mimeType]) {
    // Try to detect by extension
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

  // Get source name from form data, or use filename
  const sourceName = formData["sourceName"];
  const sourceNameStr = typeof sourceName === "string" && sourceName.trim()
    ? sourceName.trim()
    : file.name;

  // Check if sourceId was provided (to add to existing source)
  const existingSourceId = formData["sourceId"];

  // Read file content OUTSIDE the transaction
  const arrayBuffer = await file.arrayBuffer();
  const content = new Uint8Array(arrayBuffer);
  const sizeBytes = content.length;

  // First transaction: verify KB, check quota, create/get source, create upload
  const { upload, uploadSource, usage } = await withRequestRLS(c, async (tx) => {
    // Verify KB belongs to tenant
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

    // Check quota
    const quotas = await tx.query.tenantQuotas.findFirst({
      where: eq(tenantQuotas.tenantId, authContext.tenantId!),
    });

    const currentMonth = new Date().toISOString().slice(0, 7);
    let usageRecord = await tx.query.tenantUsage.findFirst({
      where: and(
        eq(tenantUsage.tenantId, authContext.tenantId!),
        eq(tenantUsage.month, currentMonth)
      ),
    });

    if (!usageRecord) {
      [usageRecord] = await tx
        .insert(tenantUsage)
        .values({
          tenantId: authContext.tenantId!,
          month: currentMonth,
        })
        .returning();
    }

    if (quotas && usageRecord.uploadedDocs >= quotas.maxUploadedDocsPerMonth) {
      throw new QuotaExceededError("monthly document uploads");
    }

    let source;
    if (typeof existingSourceId === "string" && existingSourceId.trim()) {
      // Use existing source
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
      // Create a new source for this upload
      [source] = await tx
        .insert(sources)
        .values({
          tenantId: authContext.tenantId!,
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

    // Create upload record
    const [uploadRecord] = await tx
      .insert(uploads)
      .values({
        tenantId: authContext.tenantId!,
        kbId,
        sourceId: source.id,
        filename: file.name,
        mimeType,
        sizeBytes,
        status: "pending",
        createdBy: authContext.user.id,
      })
      .returning();

    // Update usage
    await tx
      .update(tenantUsage)
      .set({
        uploadedDocs: sql`${tenantUsage.uploadedDocs} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(tenantUsage.id, usageRecord.id));

    return { upload: uploadRecord, uploadSource: source, usage: usageRecord };
  });

  // Extract text OUTSIDE the transaction (CPU-intensive)
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

  // Second transaction: update upload with extracted text and create source run
  const sourceRun = await withRequestRLS(c, async (tx) => {
    // Update upload with extracted text
    await tx
      .update(uploads)
      .set({
        extractedText,
        status: "processing",
      })
      .where(eq(uploads.id, upload.id));

    // Create a source run for this upload
    // Uploads skip DISCOVERING and SCRAPING, starting directly at PROCESSING
    const [run] = await tx
      .insert(sourceRuns)
      .values({
        tenantId: authContext.tenantId!,
        sourceId: uploadSource.id,
        status: "running",
        stage: SourceRunStage.PROCESSING,
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

    // Update upload with source run reference
    await tx
      .update(uploads)
      .set({ sourceRunId: run.id })
      .where(eq(uploads.id, upload.id));

    return run;
  });

  // Initialize stage progress in Redis (1 document for PROCESSING stage)
  await initializeStageProgress(sourceRun.id, 1);

  // Queue for chunking and embedding (outside transaction)
  // Uploads pass HTML directly in the job since there's no SCRAPING stage
  await addPageProcessJob({
    tenantId: authContext.tenantId!,
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
});

// ============================================================================
// Delete Upload (soft-delete upload + chunks)
// ============================================================================

uploadRoutes.delete("/:uploadId", auth(), requireTenant(), requireRole("owner", "admin"), async (c) => {
  const uploadId = c.req.param("uploadId");
  const authContext = c.get("auth");

  await withRequestRLS(c, async (tx) => {
    // Verify upload exists and belongs to tenant
    const upload = await tx.query.uploads.findFirst({
      where: and(
        eq(uploads.id, uploadId),
        eq(uploads.tenantId, authContext.tenantId!),
        isNull(uploads.deletedAt)
      ),
    });

    if (!upload) {
      throw new NotFoundError("Upload");
    }

    const now = new Date();

    // Soft-delete the upload record
    await tx
      .update(uploads)
      .set({ deletedAt: now })
      .where(eq(uploads.id, uploadId));

    // Soft-delete associated chunks by normalizedUrl pattern
    // Upload chunks have normalizedUrl like "upload://{uploadId}/{filename}"
    await tx
      .update(kbChunks)
      .set({ deletedAt: now })
      .where(
        and(
          eq(kbChunks.sourceId, upload.sourceId),
          isNull(kbChunks.deletedAt),
          sql`${kbChunks.normalizedUrl} LIKE ${'upload://' + uploadId + '/%'}`
        )
      );
  });

  return c.json({ message: "Upload deleted" });
});
