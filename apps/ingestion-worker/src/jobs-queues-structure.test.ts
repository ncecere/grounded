/**
 * Jobs and Queues Structure Tests
 *
 * Validates that the refactored job/queue structure maintains:
 * 1. All expected job handlers are exported from jobs/
 * 2. All expected queue workers are exported from queues/
 * 3. Job names and wiring remain unchanged from baseline
 * 4. Queue names match the QUEUE_NAMES constants
 */

import { describe, it, expect } from "bun:test";
import { QUEUE_NAMES } from "@grounded/shared";

describe("Jobs Index", () => {
  it("exports all expected job handlers", async () => {
    const jobs = await import("./jobs");

    // Source run handlers
    expect(jobs.processSourceRunStart).toBeDefined();
    expect(typeof jobs.processSourceRunStart).toBe("function");

    expect(jobs.processSourceDiscover).toBeDefined();
    expect(typeof jobs.processSourceDiscover).toBe("function");

    expect(jobs.processSourceFinalize).toBeDefined();
    expect(typeof jobs.processSourceFinalize).toBe("function");

    expect(jobs.processStageTransition).toBeDefined();
    expect(typeof jobs.processStageTransition).toBe("function");

    // Page processing handlers
    expect(jobs.processPageProcess).toBeDefined();
    expect(typeof jobs.processPageProcess).toBe("function");

    expect(jobs.processPageIndex).toBeDefined();
    expect(typeof jobs.processPageIndex).toBe("function");

    expect(jobs.processEmbedChunks).toBeDefined();
    expect(typeof jobs.processEmbedChunks).toBe("function");

    expect(jobs.processEnrichPage).toBeDefined();
    expect(typeof jobs.processEnrichPage).toBe("function");

    // Utility handlers
    expect(jobs.processHardDelete).toBeDefined();
    expect(typeof jobs.processHardDelete).toBe("function");

    expect(jobs.processKbReindex).toBeDefined();
    expect(typeof jobs.processKbReindex).toBe("function");
  });

  it("exports exactly 10 job handlers", async () => {
    const jobs = await import("./jobs");
    const exportedFunctions = Object.keys(jobs).filter(
      (key) => typeof (jobs as Record<string, unknown>)[key] === "function"
    );
    expect(exportedFunctions.length).toBe(10);
  });
});

describe("Queues Index", () => {
  it("exports all expected worker instances", async () => {
    const queues = await import("./queues");

    // Worker instances
    expect(queues.sourceRunWorker).toBeDefined();
    expect(queues.pageProcessWorker).toBeDefined();
    expect(queues.pageIndexWorker).toBeDefined();
    expect(queues.embedChunksWorker).toBeDefined();
    expect(queues.enrichPageWorker).toBeDefined();
    expect(queues.deletionWorker).toBeDefined();
    expect(queues.kbReindexWorker).toBeDefined();
  });

  it("exports factory functions for all workers", async () => {
    const queues = await import("./queues");

    // Factory functions
    expect(typeof queues.createSourceRunWorker).toBe("function");
    expect(typeof queues.createPageProcessWorker).toBe("function");
    expect(typeof queues.createPageIndexWorker).toBe("function");
    expect(typeof queues.createEmbedChunksWorker).toBe("function");
    expect(typeof queues.createEnrichPageWorker).toBe("function");
    expect(typeof queues.createDeletionWorker).toBe("function");
    expect(typeof queues.createKbReindexWorker).toBe("function");
  });

  it("exports allWorkers array with 7 workers", async () => {
    const queues = await import("./queues");

    expect(Array.isArray(queues.allWorkers)).toBe(true);
    expect(queues.allWorkers.length).toBe(7);
  });

  it("exports registerAllWorkers helper", async () => {
    const queues = await import("./queues");

    expect(typeof queues.registerAllWorkers).toBe("function");
  });

  it("exports closeAllWorkers helper", async () => {
    const queues = await import("./queues");

    expect(typeof queues.closeAllWorkers).toBe("function");
  });
});

describe("Queue Names Consistency", () => {
  it("uses correct queue names from QUEUE_NAMES", () => {
    // Verify QUEUE_NAMES constants exist
    expect(QUEUE_NAMES.SOURCE_RUN).toBe("source-run");
    expect(QUEUE_NAMES.PAGE_FETCH).toBe("page-fetch");
    expect(QUEUE_NAMES.PAGE_PROCESS).toBe("page-process");
    expect(QUEUE_NAMES.PAGE_INDEX).toBe("page-index");
    expect(QUEUE_NAMES.EMBED_CHUNKS).toBe("embed-chunks");
    expect(QUEUE_NAMES.ENRICH_PAGE).toBe("enrich-page");
    expect(QUEUE_NAMES.DELETION).toBe("deletion");
    expect(QUEUE_NAMES.KB_REINDEX).toBe("kb-reindex");
  });
});

describe("Job Handler Compatibility", () => {
  it("source-run handlers match expected job names", async () => {
    // Verify handler names match job name patterns used in queue dispatch
    const jobs = await import("./jobs");

    // These handlers should match the job names in sourceRunQueue:
    // - "start" -> processSourceRunStart
    // - "discover" -> processSourceDiscover
    // - "finalize" -> processSourceFinalize
    // - "stage-transition" -> processStageTransition
    expect(jobs.processSourceRunStart.name).toBe("processSourceRunStart");
    expect(jobs.processSourceDiscover.name).toBe("processSourceDiscover");
    expect(jobs.processSourceFinalize.name).toBe("processSourceFinalize");
    expect(jobs.processStageTransition.name).toBe("processStageTransition");
  });

  it("page handlers are exported with correct names", async () => {
    const jobs = await import("./jobs");

    expect(jobs.processPageProcess.name).toBe("processPageProcess");
    expect(jobs.processPageIndex.name).toBe("processPageIndex");
    expect(jobs.processEmbedChunks.name).toBe("processEmbedChunks");
    expect(jobs.processEnrichPage.name).toBe("processEnrichPage");
  });

  it("utility handlers are exported with correct names", async () => {
    const jobs = await import("./jobs");

    expect(jobs.processHardDelete.name).toBe("processHardDelete");
    expect(jobs.processKbReindex.name).toBe("processKbReindex");
  });
});

describe("Worker Instance Types", () => {
  it("all workers have a name property", async () => {
    const queues = await import("./queues");

    for (const worker of queues.allWorkers) {
      expect(worker.name).toBeDefined();
      expect(typeof worker.name).toBe("string");
    }
  });

  it("all workers have close method", async () => {
    const queues = await import("./queues");

    for (const worker of queues.allWorkers) {
      expect(typeof worker.close).toBe("function");
    }
  });
});

describe("Backward Compatibility", () => {
  it("processors/ exports still work (for migration period)", async () => {
    // Verify the old processor files still exist and export correctly
    const sourceRunStart = await import("./processors/source-run-start");
    const sourceDiscover = await import("./processors/source-discover");
    const sourceFinalize = await import("./processors/source-finalize");
    const stageTransition = await import("./processors/stage-transition");
    const pageProcess = await import("./processors/page-process");
    const pageIndex = await import("./processors/page-index");
    const embedChunks = await import("./processors/embed-chunks");
    const enrichPage = await import("./processors/enrich-page");
    const hardDelete = await import("./processors/hard-delete");
    const kbReindex = await import("./processors/kb-reindex");

    expect(sourceRunStart.processSourceRunStart).toBeDefined();
    expect(sourceDiscover.processSourceDiscover).toBeDefined();
    expect(sourceFinalize.processSourceFinalize).toBeDefined();
    expect(stageTransition.processStageTransition).toBeDefined();
    expect(pageProcess.processPageProcess).toBeDefined();
    expect(pageIndex.processPageIndex).toBeDefined();
    expect(embedChunks.processEmbedChunks).toBeDefined();
    expect(enrichPage.processEnrichPage).toBeDefined();
    expect(hardDelete.processHardDelete).toBeDefined();
    expect(kbReindex.processKbReindex).toBeDefined();
  });
});
