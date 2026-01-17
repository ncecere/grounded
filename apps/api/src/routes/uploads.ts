import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import { uploads, sources, knowledgeBases, tenantQuotas, tenantUsage, sourceRuns } from "@grounded/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { addPageProcessJob } from "@grounded/queue";
import { generateId } from "@grounded/shared";
import { auth, requireRole, requireTenant, withRequestRLS } from "../middleware/auth";
import { NotFoundError, QuotaExceededError, BadRequestError } from "../middleware/error-handler";

// Document parsing libraries
import pdf from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { parse as csvParse } from "csv-parse/sync";

export const uploadRoutes = new Hono();

// ============================================================================
// Supported MIME Types
// ============================================================================

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  // Documents
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",

  // Spreadsheets
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",

  // Presentations
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",

  // Text formats
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
  "application/json": "json",
  "application/xml": "xml",
  "text/xml": "xml",
};

// File extension to MIME type mapping (for fallback detection)
const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".xml": "application/xml",
};

// ============================================================================
// List Uploads for KB
// ============================================================================

uploadRoutes.get("/kb/:kbId", auth(), requireTenant(), async (c) => {
  const kbId = c.req.param("kbId");
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

    const uploadsList = await tx.query.uploads.findMany({
      where: and(eq(uploads.kbId, kbId), isNull(uploads.deletedAt)),
    });

    return uploadsList;
  });

  return c.json({ uploads: result });
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
    extractedText = await extractText(content, mimeType, file.name);
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
    const [run] = await tx
      .insert(sourceRuns)
      .values({
        tenantId: authContext.tenantId!,
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

    // Update upload with source run reference
    await tx
      .update(uploads)
      .set({ sourceRunId: run.id })
      .where(eq(uploads.id, upload.id));

    return run;
  });

  // Queue for chunking and embedding (outside transaction)
  await addPageProcessJob({
    tenantId: authContext.tenantId!,
    runId: sourceRun.id,
    url: `upload://${upload.id}/${file.name}`,
    html: extractedText,
    title: file.name,
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
// Get Upload
// ============================================================================

uploadRoutes.get("/:uploadId", auth(), requireTenant(), async (c) => {
  const uploadId = c.req.param("uploadId");
  const authContext = c.get("auth");

  const upload = await withRequestRLS(c, async (tx) => {
    return tx.query.uploads.findFirst({
      where: and(
        eq(uploads.id, uploadId),
        eq(uploads.tenantId, authContext.tenantId!),
        isNull(uploads.deletedAt)
      ),
    });
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

    const upload = await withRequestRLS(c, async (tx) => {
      const [result] = await tx
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
      return result;
    });

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
  const buffer = Buffer.from(content);

  switch (mimeType) {
    // Plain text formats
    case "text/plain":
    case "text/markdown":
      return decoder.decode(content);

    // HTML
    case "text/html":
      return htmlToText(decoder.decode(content));

    // JSON - pretty print for readability
    case "application/json":
      try {
        const json = JSON.parse(decoder.decode(content));
        return JSON.stringify(json, null, 2);
      } catch {
        return decoder.decode(content);
      }

    // XML
    case "application/xml":
    case "text/xml":
      return xmlToText(decoder.decode(content));

    // PDF
    case "application/pdf":
      return await extractPdfText(buffer);

    // Word documents
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return await extractDocxText(buffer);

    case "application/msword":
      // .doc files are harder to parse - try as binary text or throw helpful error
      throw new Error("Legacy .doc format not fully supported. Please convert to .docx format.");

    // Excel spreadsheets
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
      return extractExcelText(buffer);

    // CSV
    case "text/csv":
      return extractCsvText(decoder.decode(content));

    // PowerPoint
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return extractPptxText(buffer);

    case "application/vnd.ms-powerpoint":
      throw new Error("Legacy .ppt format not fully supported. Please convert to .pptx format.");

    default:
      throw new Error(`Unsupported file type: ${mimeType}`);
  }
}

// ============================================================================
// Format-Specific Extractors
// ============================================================================

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const data = await pdf(buffer);
    return data.text || "";
  } catch (err) {
    throw new Error(`Failed to extract PDF text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (err) {
    throw new Error(`Failed to extract DOCX text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

function extractExcelText(buffer: Buffer): string {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const textParts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      textParts.push(`## Sheet: ${sheetName}\n`);

      // Convert to CSV for text representation
      const csv = XLSX.utils.sheet_to_csv(sheet);
      textParts.push(csv);
      textParts.push("\n");
    }

    return textParts.join("\n");
  } catch (err) {
    throw new Error(`Failed to extract Excel text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

function extractCsvText(content: string): string {
  try {
    // Parse CSV to get structured data
    const records = csvParse(content, {
      skip_empty_lines: true,
      relax_column_count: true,
    });

    // Convert back to formatted text
    if (records.length === 0) return content;

    // Assume first row is headers
    const headers = records[0] as string[];
    const rows = records.slice(1) as string[][];

    const textParts: string[] = [];
    textParts.push(`Columns: ${headers.join(", ")}\n`);
    textParts.push(`Total rows: ${rows.length}\n\n`);

    // Format each row as key-value pairs for better context
    for (let i = 0; i < Math.min(rows.length, 1000); i++) {
      const row = rows[i];
      const rowText = headers
        .map((h, j) => `${h}: ${row[j] || ""}`)
        .join(" | ");
      textParts.push(`Row ${i + 1}: ${rowText}`);
    }

    if (rows.length > 1000) {
      textParts.push(`\n... and ${rows.length - 1000} more rows`);
    }

    return textParts.join("\n");
  } catch {
    // If parsing fails, return raw content
    return content;
  }
}

function extractPptxText(buffer: Buffer): string {
  try {
    // XLSX can also read PPTX files to extract text content
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const textParts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      textParts.push(`## Slide: ${sheetName}\n`);

      // Extract text from cells
      const text = XLSX.utils.sheet_to_txt(sheet);
      if (text.trim()) {
        textParts.push(text);
      }
      textParts.push("\n");
    }

    return textParts.join("\n") || "No text content found in presentation.";
  } catch (err) {
    throw new Error(`Failed to extract PowerPoint text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function xmlToText(xml: string): string {
  // Extract text content from XML, preserving structure somewhat
  return xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}
