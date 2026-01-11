import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@kcb/db";
import { uploads, sources, knowledgeBases, tenantQuotas, tenantUsage } from "@kcb/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { addPageProcessJob } from "@kcb/queue";
import { generateId } from "@kcb/shared";
import { auth, requireRole, requireTenant } from "../middleware/auth";
import { NotFoundError, QuotaExceededError, BadRequestError } from "../middleware/error-handler";

export const uploadRoutes = new Hono();

// ============================================================================
// Supported MIME Types
// ============================================================================

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
};

// ============================================================================
// List Uploads for KB
// ============================================================================

uploadRoutes.get("/kb/:kbId", auth(), requireTenant(), async (c) => {
  const kbId = c.req.param("kbId");
  const authContext = c.get("auth");

  // Verify KB access
  const kb = await db.query.knowledgeBases.findFirst({
    where: and(
      eq(knowledgeBases.id, kbId),
      eq(knowledgeBases.tenantId, authContext.tenantId!),
      isNull(knowledgeBases.deletedAt)
    ),
  });

  if (!kb) {
    throw new NotFoundError("Knowledge base");
  }

  const uploadsList = await db.query.uploads.findMany({
    where: and(eq(uploads.kbId, kbId), isNull(uploads.deletedAt)),
  });

  return c.json({ uploads: uploadsList });
});

// ============================================================================
// Upload Document
// ============================================================================

uploadRoutes.post("/kb/:kbId", auth(), requireTenant(), requireRole("owner", "admin"), async (c) => {
  const kbId = c.req.param("kbId");
  const authContext = c.get("auth");

  // Verify KB belongs to tenant
  const kb = await db.query.knowledgeBases.findFirst({
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
  const quotas = await db.query.tenantQuotas.findFirst({
    where: eq(tenantQuotas.tenantId, authContext.tenantId!),
  });

  const currentMonth = new Date().toISOString().slice(0, 7);
  let usage = await db.query.tenantUsage.findFirst({
    where: and(
      eq(tenantUsage.tenantId, authContext.tenantId!),
      eq(tenantUsage.month, currentMonth)
    ),
  });

  if (!usage) {
    [usage] = await db
      .insert(tenantUsage)
      .values({
        tenantId: authContext.tenantId!,
        month: currentMonth,
      })
      .returning();
  }

  if (quotas && usage.uploadedDocs >= quotas.maxUploadedDocsPerMonth) {
    throw new QuotaExceededError("monthly document uploads");
  }

  // Parse multipart form
  const formData = await c.req.parseBody();
  const file = formData["file"];

  if (!file || typeof file === "string") {
    throw new BadRequestError("No file uploaded");
  }

  const mimeType = file.type;
  if (!SUPPORTED_MIME_TYPES[mimeType]) {
    throw new BadRequestError(
      `Unsupported file type: ${mimeType}. Supported: ${Object.keys(SUPPORTED_MIME_TYPES).join(", ")}`
    );
  }

  // Get or create upload source for this KB
  let uploadSource = await db.query.sources.findFirst({
    where: and(
      eq(sources.kbId, kbId),
      eq(sources.type, "upload"),
      isNull(sources.deletedAt)
    ),
  });

  if (!uploadSource) {
    [uploadSource] = await db
      .insert(sources)
      .values({
        tenantId: authContext.tenantId!,
        kbId,
        type: "upload",
        name: "Document Uploads",
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

  // Read file content
  const arrayBuffer = await file.arrayBuffer();
  const content = new Uint8Array(arrayBuffer);
  const sizeBytes = content.length;

  // Create upload record
  const [upload] = await db
    .insert(uploads)
    .values({
      tenantId: authContext.tenantId!,
      kbId,
      sourceId: uploadSource.id,
      filename: file.name,
      mimeType,
      sizeBytes,
      status: "pending",
      createdBy: authContext.user.id,
    })
    .returning();

  // Update usage
  await db
    .update(tenantUsage)
    .set({
      uploadedDocs: sql`${tenantUsage.uploadedDocs} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(tenantUsage.id, usage.id));

  // Extract text based on file type
  let extractedText: string;
  try {
    extractedText = await extractText(content, mimeType, file.name);
  } catch (err) {
    await db
      .update(uploads)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : "Text extraction failed",
      })
      .where(eq(uploads.id, upload.id));

    throw new BadRequestError("Failed to extract text from document");
  }

  // Update upload with extracted text
  await db
    .update(uploads)
    .set({
      extractedText,
      status: "processing",
    })
    .where(eq(uploads.id, upload.id));

  // Queue for chunking and embedding
  await addPageProcessJob({
    tenantId: authContext.tenantId!,
    runId: upload.id, // Use upload ID as run ID
    url: `upload://${upload.id}/${file.name}`,
    html: extractedText,
    title: file.name,
  });

  return c.json(
    {
      upload: {
        id: upload.id,
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
// Get Upload
// ============================================================================

uploadRoutes.get("/:uploadId", auth(), requireTenant(), async (c) => {
  const uploadId = c.req.param("uploadId");
  const authContext = c.get("auth");

  const upload = await db.query.uploads.findFirst({
    where: and(
      eq(uploads.id, uploadId),
      eq(uploads.tenantId, authContext.tenantId!),
      isNull(uploads.deletedAt)
    ),
  });

  if (!upload) {
    throw new NotFoundError("Upload");
  }

  return c.json({ upload });
});

// ============================================================================
// Delete Upload
// ============================================================================

uploadRoutes.delete(
  "/:uploadId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const uploadId = c.req.param("uploadId");
    const authContext = c.get("auth");

    const [upload] = await db
      .update(uploads)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(uploads.id, uploadId),
          eq(uploads.tenantId, authContext.tenantId!),
          isNull(uploads.deletedAt)
        )
      )
      .returning();

    if (!upload) {
      throw new NotFoundError("Upload");
    }

    return c.json({ message: "Upload scheduled for deletion" });
  }
);

// ============================================================================
// Text Extraction Functions
// ============================================================================

async function extractText(
  content: Uint8Array,
  mimeType: string,
  filename: string
): Promise<string> {
  const decoder = new TextDecoder("utf-8");

  switch (mimeType) {
    case "text/plain":
    case "text/markdown":
      return decoder.decode(content);

    case "text/html":
      // Simple HTML to text - in production use a proper library
      const html = decoder.decode(content);
      return htmlToText(html);

    case "application/pdf":
      // PDF extraction requires pdf-parse library
      // For now, return a placeholder - implement with actual library
      throw new Error("PDF extraction not yet implemented - install pdf-parse");

    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      // DOCX extraction requires mammoth library
      throw new Error("DOCX extraction not yet implemented - install mammoth");

    default:
      throw new Error(`Unsupported file type: ${mimeType}`);
  }
}

function htmlToText(html: string): string {
  // Simple HTML to text conversion
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
