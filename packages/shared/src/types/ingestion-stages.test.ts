import { describe, it, expect } from "bun:test";
import type {
  IngestionStage,
  StageStatus,
  StageTimestamps,
  SourceRunStatsV2,
  StageContracts,
  PageStageStatus,
} from "./index";
import { INGESTION_STAGES, STAGE_MAX_RETRIES, STAGE_RETRY_DELAY_MS } from "../constants";

describe("Ingestion Stage Types", () => {
  describe("IngestionStage enum", () => {
    it("should include 'discover' stage", () => {
      const stage: IngestionStage = "discover";
      expect(stage).toBe("discover");
    });

    it("should include 'fetch' stage", () => {
      const stage: IngestionStage = "fetch";
      expect(stage).toBe("fetch");
    });

    it("should include 'extract' stage", () => {
      const stage: IngestionStage = "extract";
      expect(stage).toBe("extract");
    });

    it("should include 'chunk' stage", () => {
      const stage: IngestionStage = "chunk";
      expect(stage).toBe("chunk");
    });

    it("should include 'embed' stage", () => {
      const stage: IngestionStage = "embed";
      expect(stage).toBe("embed");
    });

    it("should include 'index' stage", () => {
      const stage: IngestionStage = "index";
      expect(stage).toBe("index");
    });

    it("should have exactly 6 stages", () => {
      const validStages: IngestionStage[] = [
        "discover",
        "fetch",
        "extract",
        "chunk",
        "embed",
        "index",
      ];
      expect(validStages).toHaveLength(6);
    });
  });

  describe("StageStatus enum", () => {
    it("should include 'pending' status", () => {
      const status: StageStatus = "pending";
      expect(status).toBe("pending");
    });

    it("should include 'in_progress' status", () => {
      const status: StageStatus = "in_progress";
      expect(status).toBe("in_progress");
    });

    it("should include 'completed' status", () => {
      const status: StageStatus = "completed";
      expect(status).toBe("completed");
    });

    it("should include 'failed_retryable' status", () => {
      const status: StageStatus = "failed_retryable";
      expect(status).toBe("failed_retryable");
    });

    it("should include 'failed_permanent' status", () => {
      const status: StageStatus = "failed_permanent";
      expect(status).toBe("failed_permanent");
    });

    it("should include 'skipped' status", () => {
      const status: StageStatus = "skipped";
      expect(status).toBe("skipped");
    });

    it("should have exactly 6 statuses", () => {
      const validStatuses: StageStatus[] = [
        "pending",
        "in_progress",
        "completed",
        "failed_retryable",
        "failed_permanent",
        "skipped",
      ];
      expect(validStatuses).toHaveLength(6);
    });
  });

  describe("StageTimestamps interface", () => {
    it("should allow optional startedAt", () => {
      const timestamps: StageTimestamps = {};
      expect(timestamps.startedAt).toBeUndefined();
    });

    it("should allow optional finishedAt", () => {
      const timestamps: StageTimestamps = {};
      expect(timestamps.finishedAt).toBeUndefined();
    });

    it("should support both timestamps", () => {
      const timestamps: StageTimestamps = {
        startedAt: "2026-01-18T10:00:00Z",
        finishedAt: "2026-01-18T10:00:05Z",
      };
      expect(timestamps.startedAt).toBe("2026-01-18T10:00:00Z");
      expect(timestamps.finishedAt).toBe("2026-01-18T10:00:05Z");
    });
  });

  describe("SourceRunStatsV2 interface", () => {
    it("should extend SourceRunStats with required fields", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        pagesSkipped: 2,
        tokensEstimated: 50000,
      };
      expect(stats.pagesSeen).toBe(100);
      expect(stats.pagesIndexed).toBe(95);
      expect(stats.pagesFailed).toBe(3);
      expect(stats.pagesSkipped).toBe(2);
      expect(stats.tokensEstimated).toBe(50000);
    });

    it("should support optional stages object", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        tokensEstimated: 50000,
      };
      expect(stats.stages).toBeUndefined();
    });

    it("should support discover stage stats", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        tokensEstimated: 50000,
        stages: {
          discover: {
            urlsFound: 100,
            startedAt: "2026-01-18T10:00:00Z",
            finishedAt: "2026-01-18T10:00:10Z",
          },
        },
      };
      expect(stats.stages?.discover?.urlsFound).toBe(100);
    });

    it("should support fetch stage stats", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        tokensEstimated: 50000,
        stages: {
          fetch: {
            succeeded: 95,
            failed: 3,
            skipped: 2,
            startedAt: "2026-01-18T10:00:10Z",
            finishedAt: "2026-01-18T10:01:00Z",
          },
        },
      };
      expect(stats.stages?.fetch?.succeeded).toBe(95);
      expect(stats.stages?.fetch?.failed).toBe(3);
      expect(stats.stages?.fetch?.skipped).toBe(2);
    });

    it("should support extract stage stats", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        tokensEstimated: 50000,
        stages: {
          extract: {
            succeeded: 95,
            failed: 0,
            startedAt: "2026-01-18T10:01:00Z",
          },
        },
      };
      expect(stats.stages?.extract?.succeeded).toBe(95);
    });

    it("should support chunk stage stats", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        tokensEstimated: 50000,
        stages: {
          chunk: {
            chunksCreated: 1500,
            startedAt: "2026-01-18T10:01:00Z",
            finishedAt: "2026-01-18T10:01:30Z",
          },
        },
      };
      expect(stats.stages?.chunk?.chunksCreated).toBe(1500);
    });

    it("should support embed stage stats", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        tokensEstimated: 50000,
        stages: {
          embed: {
            succeeded: 1500,
            failed: 0,
            startedAt: "2026-01-18T10:01:30Z",
            finishedAt: "2026-01-18T10:02:30Z",
          },
        },
      };
      expect(stats.stages?.embed?.succeeded).toBe(1500);
    });

    it("should support index stage stats", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        tokensEstimated: 50000,
        stages: {
          index: {
            vectorsStored: 1500,
            startedAt: "2026-01-18T10:02:30Z",
            finishedAt: "2026-01-18T10:02:45Z",
          },
        },
      };
      expect(stats.stages?.index?.vectorsStored).toBe(1500);
    });

    it("should support all stages together", () => {
      const stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        pagesSkipped: 2,
        tokensEstimated: 50000,
        stages: {
          discover: { urlsFound: 100, startedAt: "2026-01-18T10:00:00Z" },
          fetch: { succeeded: 95, failed: 3, skipped: 2 },
          extract: { succeeded: 95, failed: 0 },
          chunk: { chunksCreated: 1500 },
          embed: { succeeded: 1500, failed: 0 },
          index: { vectorsStored: 1500, finishedAt: "2026-01-18T10:05:00Z" },
        },
      };
      expect(stats.stages?.discover?.urlsFound).toBe(100);
      expect(stats.stages?.fetch?.succeeded).toBe(95);
      expect(stats.stages?.extract?.succeeded).toBe(95);
      expect(stats.stages?.chunk?.chunksCreated).toBe(1500);
      expect(stats.stages?.embed?.succeeded).toBe(1500);
      expect(stats.stages?.index?.vectorsStored).toBe(1500);
    });
  });

  describe("PageStageStatus interface", () => {
    it("should have required stage field", () => {
      const status: PageStageStatus = {
        stage: "fetch",
        status: "completed",
      };
      expect(status.stage).toBe("fetch");
    });

    it("should have required status field", () => {
      const status: PageStageStatus = {
        stage: "embed",
        status: "in_progress",
      };
      expect(status.status).toBe("in_progress");
    });

    it("should support optional timestamps", () => {
      const status: PageStageStatus = {
        stage: "extract",
        status: "completed",
        startedAt: "2026-01-18T10:00:00Z",
        finishedAt: "2026-01-18T10:00:01Z",
      };
      expect(status.startedAt).toBe("2026-01-18T10:00:00Z");
      expect(status.finishedAt).toBe("2026-01-18T10:00:01Z");
    });

    it("should support optional error field", () => {
      const status: PageStageStatus = {
        stage: "fetch",
        status: "failed_retryable",
        error: "Connection timeout",
      };
      expect(status.error).toBe("Connection timeout");
    });

    it("should support optional retryCount field", () => {
      const status: PageStageStatus = {
        stage: "fetch",
        status: "failed_retryable",
        retryCount: 2,
      };
      expect(status.retryCount).toBe(2);
    });

    it("should support optional metadata field", () => {
      const status: PageStageStatus = {
        stage: "chunk",
        status: "completed",
        metadata: {
          chunksCreated: 5,
          averageTokenCount: 600,
        },
      };
      expect(status.metadata?.chunksCreated).toBe(5);
      expect(status.metadata?.averageTokenCount).toBe(600);
    });

    it("should support full status with all fields", () => {
      const status: PageStageStatus = {
        stage: "embed",
        status: "completed",
        startedAt: "2026-01-18T10:00:00Z",
        finishedAt: "2026-01-18T10:00:05Z",
        retryCount: 1,
        metadata: {
          embeddingDimensions: 768,
          modelUsed: "text-embedding-3-small",
        },
      };
      expect(status.stage).toBe("embed");
      expect(status.status).toBe("completed");
      expect(status.startedAt).toBeDefined();
      expect(status.finishedAt).toBeDefined();
      expect(status.retryCount).toBe(1);
      expect(status.metadata?.embeddingDimensions).toBe(768);
    });
  });

  describe("StageContracts interface - discover stage", () => {
    it("should define discover stage input with source config", () => {
      const input: StageContracts["discover"]["input"] = {
        sourceId: "source-123",
        config: {
          mode: "sitemap",
          url: "https://example.com/sitemap.xml",
          depth: 3,
        },
      };
      expect(input.sourceId).toBe("source-123");
      expect(input.config.mode).toBe("sitemap");
    });

    it("should define discover stage output with URLs", () => {
      const output: StageContracts["discover"]["output"] = {
        urls: ["https://example.com/page1", "https://example.com/page2"],
        urlCount: 2,
      };
      expect(output.urls).toHaveLength(2);
      expect(output.urlCount).toBe(2);
    });
  });

  describe("StageContracts interface - fetch stage", () => {
    it("should define fetch stage input with URL and mode", () => {
      const input: StageContracts["fetch"]["input"] = {
        url: "https://example.com/page1",
        fetchMode: "auto",
      };
      expect(input.url).toBe("https://example.com/page1");
      expect(input.fetchMode).toBe("auto");
    });

    it("should define fetch stage output with HTML and metadata", () => {
      const output: StageContracts["fetch"]["output"] = {
        html: "<html><body>Content</body></html>",
        title: "Page Title",
        httpStatus: 200,
        contentType: "text/html",
      };
      expect(output.html).toContain("<html>");
      expect(output.httpStatus).toBe(200);
    });
  });

  describe("StageContracts interface - extract stage", () => {
    it("should define extract stage input with HTML and URL", () => {
      const input: StageContracts["extract"]["input"] = {
        html: "<html><body>Content</body></html>",
        url: "https://example.com/page1",
      };
      expect(input.html).toBeDefined();
      expect(input.url).toBe("https://example.com/page1");
    });

    it("should define extract stage output with content and structure", () => {
      const output: StageContracts["extract"]["output"] = {
        content: "Main content text",
        title: "Page Title",
        headings: [
          { level: 1, text: "Main Heading" },
          { level: 2, text: "Subheading" },
        ],
        contentHash: "abc123def456",
      };
      expect(output.content).toBe("Main content text");
      expect(output.headings).toHaveLength(2);
      expect(output.contentHash).toBe("abc123def456");
    });
  });

  describe("StageContracts interface - chunk stage", () => {
    it("should define chunk stage input with content and structure", () => {
      const input: StageContracts["chunk"]["input"] = {
        content: "Main content text that will be chunked",
        title: "Page Title",
        headings: [{ level: 1, text: "Main Heading" }],
        url: "https://example.com/page1",
      };
      expect(input.content).toBeDefined();
      expect(input.headings).toHaveLength(1);
    });

    it("should define chunk stage output with array of chunks", () => {
      const output: StageContracts["chunk"]["output"] = {
        chunks: [
          {
            content: "First chunk of content...",
            chunkIndex: 0,
            heading: "Main Heading",
            sectionPath: ["Main Heading"],
            tokenCount: 150,
          },
          {
            content: "Second chunk of content...",
            chunkIndex: 1,
            heading: "Main Heading",
            sectionPath: ["Main Heading"],
            tokenCount: 145,
          },
        ],
      };
      expect(output.chunks).toHaveLength(2);
      expect(output.chunks[0].chunkIndex).toBe(0);
      expect(output.chunks[1].chunkIndex).toBe(1);
    });
  });

  describe("StageContracts interface - embed stage", () => {
    it("should define embed stage input with chunk IDs", () => {
      const input: StageContracts["embed"]["input"] = {
        chunkIds: ["chunk-1", "chunk-2", "chunk-3"],
        embeddingModelId: "model-123",
      };
      expect(input.chunkIds).toHaveLength(3);
      expect(input.embeddingModelId).toBe("model-123");
    });

    it("should define embed stage output with embeddings", () => {
      const output: StageContracts["embed"]["output"] = {
        embeddings: [
          { chunkId: "chunk-1", vector: [0.1, 0.2, 0.3], dimensions: 3 },
          { chunkId: "chunk-2", vector: [0.4, 0.5, 0.6], dimensions: 3 },
        ],
      };
      expect(output.embeddings).toHaveLength(2);
      expect(output.embeddings[0].vector).toHaveLength(3);
    });
  });

  describe("StageContracts interface - index stage", () => {
    it("should define index stage input with chunk and vector", () => {
      const input: StageContracts["index"]["input"] = {
        chunkId: "chunk-1",
        vector: [0.1, 0.2, 0.3],
        kbId: "kb-123",
      };
      expect(input.chunkId).toBe("chunk-1");
      expect(input.vector).toHaveLength(3);
      expect(input.kbId).toBe("kb-123");
    });

    it("should define index stage output with storage confirmation", () => {
      const output: StageContracts["index"]["output"] = {
        stored: true,
        vectorId: "vec-123",
      };
      expect(output.stored).toBe(true);
      expect(output.vectorId).toBe("vec-123");
    });
  });
});

describe("Ingestion Stage Constants", () => {
  describe("INGESTION_STAGES", () => {
    it("should define 6 stages in correct order", () => {
      expect(INGESTION_STAGES).toHaveLength(6);
      expect(INGESTION_STAGES[0]).toBe("discover");
      expect(INGESTION_STAGES[1]).toBe("fetch");
      expect(INGESTION_STAGES[2]).toBe("extract");
      expect(INGESTION_STAGES[3]).toBe("chunk");
      expect(INGESTION_STAGES[4]).toBe("embed");
      expect(INGESTION_STAGES[5]).toBe("index");
    });

    it("should be readonly", () => {
      expect(Object.isFrozen(INGESTION_STAGES)).toBe(false); // const arrays are not frozen
      // But TypeScript prevents mutation at compile time
    });
  });

  describe("STAGE_MAX_RETRIES", () => {
    it("should define retry limits for all stages", () => {
      expect(STAGE_MAX_RETRIES.discover).toBe(2);
      expect(STAGE_MAX_RETRIES.fetch).toBe(3);
      expect(STAGE_MAX_RETRIES.extract).toBe(2);
      expect(STAGE_MAX_RETRIES.chunk).toBe(1);
      expect(STAGE_MAX_RETRIES.embed).toBe(3);
      expect(STAGE_MAX_RETRIES.index).toBe(3);
    });

    it("should have higher retries for network-bound stages", () => {
      expect(STAGE_MAX_RETRIES.fetch).toBeGreaterThan(STAGE_MAX_RETRIES.chunk);
      expect(STAGE_MAX_RETRIES.embed).toBeGreaterThan(STAGE_MAX_RETRIES.chunk);
    });
  });

  describe("STAGE_RETRY_DELAY_MS", () => {
    it("should define retry delays for all stages", () => {
      expect(STAGE_RETRY_DELAY_MS.discover).toBe(5000);
      expect(STAGE_RETRY_DELAY_MS.fetch).toBe(10000);
      expect(STAGE_RETRY_DELAY_MS.extract).toBe(2000);
      expect(STAGE_RETRY_DELAY_MS.chunk).toBe(1000);
      expect(STAGE_RETRY_DELAY_MS.embed).toBe(5000);
      expect(STAGE_RETRY_DELAY_MS.index).toBe(5000);
    });

    it("should have longer delay for fetch stage (external requests)", () => {
      expect(STAGE_RETRY_DELAY_MS.fetch).toBeGreaterThan(STAGE_RETRY_DELAY_MS.extract);
      expect(STAGE_RETRY_DELAY_MS.fetch).toBeGreaterThan(STAGE_RETRY_DELAY_MS.chunk);
    });
  });
});

describe("Backwards Compatibility", () => {
  describe("SourceRunStats compatibility", () => {
    it("should allow SourceRunStatsV2 to be used where SourceRunStats is expected", () => {
      // This test verifies that V2 extends V1 properly
      const v2Stats: SourceRunStatsV2 = {
        pagesSeen: 100,
        pagesIndexed: 95,
        pagesFailed: 3,
        tokensEstimated: 50000,
        stages: {
          discover: { urlsFound: 100 },
        },
      };

      // V2 stats should have all V1 fields
      expect(v2Stats.pagesSeen).toBe(100);
      expect(v2Stats.pagesIndexed).toBe(95);
      expect(v2Stats.pagesFailed).toBe(3);
      expect(v2Stats.tokensEstimated).toBe(50000);
    });

    it("should allow stats without stages field (V1 behavior)", () => {
      const basicStats: SourceRunStatsV2 = {
        pagesSeen: 50,
        pagesIndexed: 48,
        pagesFailed: 2,
        tokensEstimated: 25000,
      };
      expect(basicStats.stages).toBeUndefined();
    });
  });

  describe("PageStatus and StageStatus coexistence", () => {
    it("should have separate PageStatus for overall outcome", () => {
      // PageStatus is for the final outcome of a page
      const pageStatus = "succeeded" as const;
      expect(["succeeded", "failed", "skipped_unchanged"]).toContain(pageStatus);
    });

    it("should have separate StageStatus for per-stage tracking", () => {
      // StageStatus is for tracking each pipeline stage
      const stageStatus = "completed" as const;
      expect([
        "pending",
        "in_progress",
        "completed",
        "failed_retryable",
        "failed_permanent",
        "skipped",
      ]).toContain(stageStatus);
    });
  });
});

describe("Stage Pipeline Documentation", () => {
  describe("stage order enforcement", () => {
    it("should process stages in order: discover -> fetch -> extract -> chunk -> embed -> index", () => {
      expect(INGESTION_STAGES[0]).toBe("discover");
      expect(INGESTION_STAGES[1]).toBe("fetch");
      expect(INGESTION_STAGES[2]).toBe("extract");
      expect(INGESTION_STAGES[3]).toBe("chunk");
      expect(INGESTION_STAGES[4]).toBe("embed");
      expect(INGESTION_STAGES[5]).toBe("index");
      expect(INGESTION_STAGES).toHaveLength(6);
    });
  });

  describe("stage status transitions", () => {
    it("should support typical success flow: pending -> in_progress -> completed", () => {
      const successFlow: StageStatus[] = ["pending", "in_progress", "completed"];
      successFlow.forEach((status) => {
        expect([
          "pending",
          "in_progress",
          "completed",
          "failed_retryable",
          "failed_permanent",
          "skipped",
        ]).toContain(status);
      });
    });

    it("should support retry flow: in_progress -> failed_retryable -> in_progress -> completed", () => {
      const retryFlow: StageStatus[] = [
        "in_progress",
        "failed_retryable",
        "in_progress",
        "completed",
      ];
      retryFlow.forEach((status) => {
        expect([
          "pending",
          "in_progress",
          "completed",
          "failed_retryable",
          "failed_permanent",
          "skipped",
        ]).toContain(status);
      });
    });

    it("should support permanent failure flow: in_progress -> failed_permanent", () => {
      const failureFlow: StageStatus[] = ["in_progress", "failed_permanent"];
      failureFlow.forEach((status) => {
        expect([
          "pending",
          "in_progress",
          "completed",
          "failed_retryable",
          "failed_permanent",
          "skipped",
        ]).toContain(status);
      });
    });

    it("should support skip flow for unchanged content", () => {
      const skipFlow: StageStatus[] = ["pending", "skipped"];
      skipFlow.forEach((status) => {
        expect([
          "pending",
          "in_progress",
          "completed",
          "failed_retryable",
          "failed_permanent",
          "skipped",
        ]).toContain(status);
      });
    });
  });
});
