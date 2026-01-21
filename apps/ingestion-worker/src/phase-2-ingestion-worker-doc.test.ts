import { describe, expect, it } from "bun:test";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

const phase2DocPath = join(
  import.meta.dir,
  "../../../tasks/phase-2-ingestion-worker.md"
);

const ingestionWorkerSrcPath = join(import.meta.dir);

describe("phase 2 ingestion worker folder layout documentation", () => {
  it("defines folder layout section", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("## Folder Layout");
    expect(content).toContain("apps/ingestion-worker/src/");
  });

  it("documents bootstrap folder structure", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("bootstrap/");
    // Check files are listed (using tree format with special chars)
    expect(content).toMatch(/bootstrap\/\s*\n.*index\.ts/);
    expect(content).toContain("settings.ts");
    expect(content).toContain("vector-store.ts");
    expect(content).toContain("shutdown.ts");
  });

  it("documents queues folder structure", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("queues/");
    expect(content).toContain("source-run.ts");
    expect(content).toContain("page-process.ts");
    expect(content).toContain("page-index.ts");
    expect(content).toContain("embed-chunks.ts");
    expect(content).toContain("enrich-page.ts");
    expect(content).toContain("deletion.ts");
    expect(content).toContain("kb-reindex.ts");
  });

  it("documents jobs folder structure", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("jobs/");
    expect(content).toContain("source-run-start.ts");
    expect(content).toContain("source-discover.ts");
    expect(content).toContain("source-finalize.ts");
    expect(content).toContain("stage-transition.ts");
    // Jobs folder should have processing jobs
    expect(content).toMatch(/jobs\/.*page-process\.ts/s);
    expect(content).toMatch(/jobs\/.*embed-chunks\.ts/s);
    expect(content).toContain("hard-delete.ts");
  });

  it("documents stage folder structure", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("stage/");
    expect(content).toContain("config.ts");
    expect(content).toContain("progress.ts");
    expect(content).toContain("transitions.ts");
    expect(content).toContain("cleanup.ts");
    expect(content).toContain("priority.ts");
    expect(content).toContain("queue-scraping.ts");
    expect(content).toContain("queue-processing.ts");
    expect(content).toContain("queue-indexing.ts");
    expect(content).toContain("queue-embedding.ts");
  });

  it("documents services folder structure", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("services/");
    expect(content).toContain("robots.ts");
    expect(content).toContain("extraction.ts");
  });

  it("includes file mapping from current to proposed structure", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("### File Mapping from Current to Proposed");
    expect(content).toContain("| Current Location | Proposed Location |");
    // Check some key mappings
    expect(content).toContain("`processors/source-run-start.ts`");
    expect(content).toContain("`jobs/source-run-start.ts`");
    expect(content).toContain("`stage-manager.ts`");
    expect(content).toContain("`stage-job-queuer.ts`");
  });

  it("documents module responsibilities for bootstrap", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("### Module Responsibilities");
    expect(content).toContain("**bootstrap/**");
    expect(content).toContain("`settings.ts`:");
    expect(content).toContain("onSettingsUpdate");
    expect(content).toContain("`vector-store.ts`:");
    expect(content).toContain("initializeVectorStore");
    expect(content).toContain("`shutdown.ts`:");
  });

  it("documents module responsibilities for queues", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("**queues/**");
    expect(content).toContain("Worker");
    expect(content).toContain("Concurrency values");
  });

  it("documents module responsibilities for jobs", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("**jobs/**");
    expect(content).toContain("Pure handler functions");
    expect(content).toContain("No BullMQ Worker creation");
  });

  it("documents module responsibilities for stage", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("**stage/**");
    expect(content).toContain("StageManagerConfig");
    expect(content).toContain("StageProgress");
    expect(content).toContain("STAGE_ORDER");
    expect(content).toContain("queueJobsForStage");
  });

  it("documents module responsibilities for services", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("**services/**");
    expect(content).toContain("fetchRobotsTxt");
    expect(content).toContain("extractContent");
  });

  it("provides slim entrypoint example", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("### Slim Entrypoint");
    expect(content).toContain("initBootstrap");
    expect(content).toContain("registerAllWorkers");
    expect(content).toContain("SIGTERM");
    expect(content).toContain("SIGINT");
  });

  it("maps all existing processors to jobs folder", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    // Verify all current processors are mapped
    const currentProcessors = [
      "source-run-start",
      "source-discover",
      "source-finalize",
      "stage-transition",
      "page-process",
      "page-index",
      "embed-chunks",
      "enrich-page",
      "hard-delete",
      "kb-reindex",
    ];

    for (const processor of currentProcessors) {
      expect(content).toContain(`processors/${processor}.ts`);
      expect(content).toContain(`jobs/${processor}.ts`);
    }
  });

  it("maps stage-manager.ts sections to stage modules", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    // Verify stage-manager sections are mapped
    expect(content).toContain("`stage-manager.ts` (config section)");
    expect(content).toContain("`stage/config.ts`");
    expect(content).toContain("`stage-manager.ts` (progress section)");
    expect(content).toContain("`stage/progress.ts`");
    expect(content).toContain("`stage-manager.ts` (transitions section)");
    expect(content).toContain("`stage/transitions.ts`");
    expect(content).toContain("`stage-manager.ts` (cleanup section)");
    expect(content).toContain("`stage/cleanup.ts`");
    expect(content).toContain("`stage-manager.ts` (priority section)");
    expect(content).toContain("`stage/priority.ts`");
  });

  it("maps stage-job-queuer.ts functions to stage queue modules", async () => {
    const content = await readFile(phase2DocPath, "utf-8");

    expect(content).toContain("`stage-job-queuer.ts` (queueScrapingJobs)");
    expect(content).toContain("`stage/queue-scraping.ts`");
    expect(content).toContain("`stage-job-queuer.ts` (queueProcessingJobs)");
    expect(content).toContain("`stage/queue-processing.ts`");
    expect(content).toContain("`stage-job-queuer.ts` (queueIndexingJobs)");
    expect(content).toContain("`stage/queue-indexing.ts`");
    expect(content).toContain("`stage-job-queuer.ts` (queueEmbeddingJobs)");
    expect(content).toContain("`stage/queue-embedding.ts`");
  });
});

describe("ingestion worker current structure verification", () => {
  it("has index.ts entrypoint", async () => {
    const files = await readdir(ingestionWorkerSrcPath);
    expect(files).toContain("index.ts");
  });

  it("has stage-manager.ts", async () => {
    const files = await readdir(ingestionWorkerSrcPath);
    expect(files).toContain("stage-manager.ts");
  });

  it("has stage-job-queuer.ts", async () => {
    const files = await readdir(ingestionWorkerSrcPath);
    expect(files).toContain("stage-job-queuer.ts");
  });

  it("has processors folder with expected files", async () => {
    const files = await readdir(ingestionWorkerSrcPath);
    expect(files).toContain("processors");

    const processorFiles = await readdir(join(ingestionWorkerSrcPath, "processors"));
    
    const expectedProcessors = [
      "source-run-start.ts",
      "source-discover.ts",
      "source-finalize.ts",
      "stage-transition.ts",
      "page-process.ts",
      "page-index.ts",
      "embed-chunks.ts",
      "enrich-page.ts",
      "hard-delete.ts",
      "kb-reindex.ts",
    ];

    for (const processor of expectedProcessors) {
      expect(processorFiles).toContain(processor);
    }
  });
});
