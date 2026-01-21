/**
 * Stage Queue Module Structure Tests
 *
 * Validates the split queue helpers are available and re-exported.
 */

import { describe, it, expect } from "bun:test";

describe("Stage queue modules", () => {
  it("exports queue helper entrypoints", async () => {
    const scraping = await import("./stage/queue-scraping");
    const processing = await import("./stage/queue-processing");
    const indexing = await import("./stage/queue-indexing");
    const embedding = await import("./stage/queue-embedding");

    expect(typeof scraping.queueScrapingJobs).toBe("function");
    expect(typeof processing.queueProcessingJobs).toBe("function");
    expect(typeof indexing.queueIndexingJobs).toBe("function");
    expect(typeof embedding.queueEmbeddingJobs).toBe("function");
    expect(embedding.EMBED_BATCH_SIZE).toBe(50);
  });

  it("stage-job-queuer re-exports queue helpers", async () => {
    const stageQueuer = await import("./stage-job-queuer");
    const scraping = await import("./stage/queue-scraping");
    const processing = await import("./stage/queue-processing");
    const indexing = await import("./stage/queue-indexing");
    const embedding = await import("./stage/queue-embedding");

    expect(stageQueuer.queueScrapingJobs).toBe(scraping.queueScrapingJobs);
    expect(stageQueuer.queueProcessingJobs).toBe(processing.queueProcessingJobs);
    expect(stageQueuer.queueIndexingJobs).toBe(indexing.queueIndexingJobs);
    expect(stageQueuer.queueEmbeddingJobs).toBe(embedding.queueEmbeddingJobs);
    expect(stageQueuer.EMBED_BATCH_SIZE).toBe(embedding.EMBED_BATCH_SIZE);
  });
});
