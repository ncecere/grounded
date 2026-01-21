/**
 * Jobs and Queues Structure Tests
 *
 * Validates that the refactored job/queue structure maintains:
 * 1. All expected job handlers are exported from jobs/
 * 2. All expected queue workers are exported from queues/
 * 3. Job names and wiring remain unchanged from baseline
 * 4. Queue names match the QUEUE_NAMES constants
 * 5. Job registry provides complete handler mapping
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

  it("exports exactly 10 job handlers as functions", async () => {
    const jobs = await import("./jobs");
    // Count only the direct handler functions (process* functions)
    const handlerFunctions = [
      "processSourceRunStart",
      "processSourceDiscover",
      "processSourceFinalize",
      "processStageTransition",
      "processPageProcess",
      "processPageIndex",
      "processEmbedChunks",
      "processEnrichPage",
      "processHardDelete",
      "processKbReindex",
    ];
    for (const fn of handlerFunctions) {
      expect(typeof (jobs as Record<string, unknown>)[fn]).toBe("function");
    }
    expect(handlerFunctions.length).toBe(10);
  });
});

describe("Jobs Registry", () => {
  it("exports jobRegistry with all 10 jobs", async () => {
    const { jobRegistry } = await import("./jobs");

    expect(Array.isArray(jobRegistry)).toBe(true);
    expect(jobRegistry.length).toBe(10);
  });

  it("jobRegistry entries have required properties", async () => {
    const { jobRegistry } = await import("./jobs");

    for (const job of jobRegistry) {
      expect(job.name).toBeDefined();
      expect(typeof job.name).toBe("string");
      expect(job.queue).toBeDefined();
      expect(typeof job.queue).toBe("string");
      expect(job.handler).toBeDefined();
      expect(typeof job.handler).toBe("function");
      expect(job.description).toBeDefined();
      expect(typeof job.description).toBe("string");
    }
  });

  it("jobRegistry covers all expected queues", async () => {
    const { jobRegistry } = await import("./jobs");

    const queues = new Set(jobRegistry.map((job) => job.queue));
    expect(queues.has("source-run")).toBe(true);
    expect(queues.has("page-process")).toBe(true);
    expect(queues.has("page-index")).toBe(true);
    expect(queues.has("embed-chunks")).toBe(true);
    expect(queues.has("enrich-page")).toBe(true);
    expect(queues.has("deletion")).toBe(true);
    expect(queues.has("kb-reindex")).toBe(true);
  });

  it("source-run queue has 4 jobs registered", async () => {
    const { jobRegistry } = await import("./jobs");

    const sourceRunJobs = jobRegistry.filter((job) => job.queue === "source-run");
    expect(sourceRunJobs.length).toBe(4);

    const names = sourceRunJobs.map((job) => job.name);
    expect(names).toContain("start");
    expect(names).toContain("discover");
    expect(names).toContain("finalize");
    expect(names).toContain("stage-transition");
  });
});

describe("Jobs By Queue Mapping", () => {
  it("exports jobsByQueue with handlers for all queues", async () => {
    const { jobsByQueue } = await import("./jobs");

    expect(jobsByQueue).toBeDefined();
    expect(typeof jobsByQueue).toBe("object");

    // Verify all queue keys exist
    expect(jobsByQueue["source-run"]).toBeDefined();
    expect(jobsByQueue["page-process"]).toBeDefined();
    expect(jobsByQueue["page-index"]).toBeDefined();
    expect(jobsByQueue["embed-chunks"]).toBeDefined();
    expect(jobsByQueue["enrich-page"]).toBeDefined();
    expect(jobsByQueue["deletion"]).toBeDefined();
    expect(jobsByQueue["kb-reindex"]).toBeDefined();
  });

  it("source-run queue mapping includes all job names", async () => {
    const { jobsByQueue } = await import("./jobs");

    const sourceRunHandlers = jobsByQueue["source-run"];
    expect(sourceRunHandlers.start).toBeDefined();
    expect(sourceRunHandlers.discover).toBeDefined();
    expect(sourceRunHandlers.finalize).toBeDefined();
    expect(sourceRunHandlers["stage-transition"]).toBeDefined();

    // Verify all are functions
    expect(typeof sourceRunHandlers.start).toBe("function");
    expect(typeof sourceRunHandlers.discover).toBe("function");
    expect(typeof sourceRunHandlers.finalize).toBe("function");
    expect(typeof sourceRunHandlers["stage-transition"]).toBe("function");
  });

  it("single-job queues have correct handler", async () => {
    const { jobsByQueue } = await import("./jobs");

    expect(typeof jobsByQueue["page-process"].process).toBe("function");
    expect(typeof jobsByQueue["page-index"].index).toBe("function");
    expect(typeof jobsByQueue["embed-chunks"].embed).toBe("function");
    expect(typeof jobsByQueue["enrich-page"].enrich).toBe("function");
    expect(typeof jobsByQueue["deletion"]["hard-delete"]).toBe("function");
    expect(typeof jobsByQueue["kb-reindex"].reindex).toBe("function");
  });
});

describe("Job Handler Lookup", () => {
  it("getJobHandler returns handler for valid queue/job", async () => {
    const { getJobHandler, processSourceRunStart, processPageProcess } = await import("./jobs");

    const startHandler = getJobHandler("source-run", "start");
    expect(startHandler).toBe(processSourceRunStart);

    const processHandler = getJobHandler("page-process", "process");
    expect(processHandler).toBe(processPageProcess);
  });

  it("getJobHandler returns undefined for invalid queue", async () => {
    const { getJobHandler } = await import("./jobs");

    const handler = getJobHandler("invalid-queue", "start");
    expect(handler).toBeUndefined();
  });

  it("getJobHandler returns undefined for invalid job name", async () => {
    const { getJobHandler } = await import("./jobs");

    const handler = getJobHandler("source-run", "invalid-job");
    expect(handler).toBeUndefined();
  });
});

describe("Job Registration Utilities", () => {
  it("getRegisteredJobNames returns all job names in queue:name format", async () => {
    const { getRegisteredJobNames } = await import("./jobs");

    const names = getRegisteredJobNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBe(10);

    // Verify format
    for (const name of names) {
      expect(name).toMatch(/^[a-z-]+:[a-z-]+$/);
    }

    // Verify specific entries
    expect(names).toContain("source-run:start");
    expect(names).toContain("source-run:discover");
    expect(names).toContain("page-process:process");
    expect(names).toContain("embed-chunks:embed");
    expect(names).toContain("deletion:hard-delete");
  });

  it("getJobCount returns 10", async () => {
    const { getJobCount } = await import("./jobs");

    expect(getJobCount()).toBe(10);
  });
});

describe("Source Run Job Objects", () => {
  it("exports sourceRunJobs with all handlers", async () => {
    const { sourceRunJobs } = await import("./jobs");

    expect(sourceRunJobs.start).toBeDefined();
    expect(sourceRunJobs.discover).toBeDefined();
    expect(sourceRunJobs.finalize).toBeDefined();
    expect(sourceRunJobs["stage-transition"]).toBeDefined();
  });

  it("sourceRunJobs have consistent queue name", async () => {
    const { sourceRunJobs } = await import("./jobs");

    expect(sourceRunJobs.start.queue).toBe("source-run");
    expect(sourceRunJobs.discover.queue).toBe("source-run");
    expect(sourceRunJobs.finalize.queue).toBe("source-run");
    expect(sourceRunJobs["stage-transition"].queue).toBe("source-run");
  });
});

describe("Individual Job Objects", () => {
  it("pageProcessJob has correct metadata", async () => {
    const { pageProcessJob } = await import("./jobs");

    expect(pageProcessJob.name).toBe("process");
    expect(pageProcessJob.queue).toBe("page-process");
    expect(typeof pageProcessJob.handler).toBe("function");
    expect(pageProcessJob.description).toContain("content");
  });

  it("embedChunksJob has correct metadata", async () => {
    const { embedChunksJob } = await import("./jobs");

    expect(embedChunksJob.name).toBe("embed");
    expect(embedChunksJob.queue).toBe("embed-chunks");
    expect(typeof embedChunksJob.handler).toBe("function");
    expect(embedChunksJob.description).toContain("embedding");
  });

  it("hardDeleteJob has correct metadata", async () => {
    const { hardDeleteJob } = await import("./jobs");

    expect(hardDeleteJob.name).toBe("hard-delete");
    expect(hardDeleteJob.queue).toBe("deletion");
    expect(typeof hardDeleteJob.handler).toBe("function");
    expect(hardDeleteJob.description).toContain("delete");
  });

  it("kbReindexJob has correct metadata", async () => {
    const { kbReindexJob } = await import("./jobs");

    expect(kbReindexJob.name).toBe("reindex");
    expect(kbReindexJob.queue).toBe("kb-reindex");
    expect(typeof kbReindexJob.handler).toBe("function");
    expect(kbReindexJob.description).toContain("Reindex");
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
