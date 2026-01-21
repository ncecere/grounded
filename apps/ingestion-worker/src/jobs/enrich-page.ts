import { db } from "@grounded/db";
import { kbChunks } from "@grounded/db/schema";
import { eq, inArray, isNull, and } from "drizzle-orm";
import { generateEnrichment } from "@grounded/llm";
import { log } from "@grounded/logger";
import type { EnrichPageJob } from "@grounded/shared";

export async function processEnrichPage(data: EnrichPageJob): Promise<void> {
  const { tenantId, kbId, chunkIds, requestId, traceId } = data;

  log.info("ingestion-worker", "Enriching chunks for KB", { chunkCount: chunkIds.length, kbId, requestId, traceId });

  // Get chunks
  const chunks = await db.query.kbChunks.findMany({
    where: and(
      inArray(kbChunks.id, chunkIds),
      isNull(kbChunks.deletedAt)
    ),
  });

  if (chunks.length === 0) {
    log.debug("ingestion-worker", "No chunks found to enrich");
    return;
  }

  // Group chunks by URL to enrich at page level
  const chunksByUrl = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    const url = chunk.normalizedUrl || "unknown";
    if (!chunksByUrl.has(url)) {
      chunksByUrl.set(url, []);
    }
    chunksByUrl.get(url)!.push(chunk);
  }

  // Enrich each page
  for (const [url, pageChunks] of chunksByUrl) {
    // Combine chunk content for enrichment
    const combinedContent = pageChunks
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((c) => c.content)
      .join("\n\n");

    const title = pageChunks[0]?.title || undefined;

    try {
      const enrichment = await generateEnrichment(combinedContent, title);

      // Update all chunks with enrichment data
      for (const chunk of pageChunks) {
        await db
          .update(kbChunks)
          .set({
            summary: enrichment.summary,
            keywords: enrichment.keywords,
            tags: enrichment.tags,
            entities: enrichment.entities,
          })
          .where(eq(kbChunks.id, chunk.id));
      }

      log.info("ingestion-worker", "Enriched page", { url, chunkCount: pageChunks.length });
    } catch (error) {
      log.error("ingestion-worker", "Error enriching page", { url, error: error instanceof Error ? error.message : String(error) });
      // Continue with other pages
    }
  }
}
