import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const ingestionJobsDocPath = join(
  import.meta.dir,
  "../../../docs/refactor/ingestion-jobs.md"
);

describe("ingestion jobs documentation", () => {
  it("includes the job/queue map section", async () => {
    const content = await readFile(ingestionJobsDocPath, "utf-8");

    expect(content).toContain("## Job/Queue Map");
    expect(content).toContain("Queue");
    expect(content).toContain("Job Name");
    expect(content).toContain("Owner");
  });

  it("documents source-run queue jobs", async () => {
    const content = await readFile(ingestionJobsDocPath, "utf-8");

    expect(content).toContain("`source-run`");
    expect(content).toContain("`start`");
    expect(content).toContain("`discover`");
    expect(content).toContain("`finalize`");
    expect(content).toContain("`stage-transition`");
    expect(content).toContain("jobs/source-run-start.ts");
    expect(content).toContain("queues/source-run.ts");
  });

  it("documents page processing jobs", async () => {
    const content = await readFile(ingestionJobsDocPath, "utf-8");

    expect(content).toContain("`page-process`");
    expect(content).toContain("`process`");
    expect(content).toContain("jobs/page-process.ts");
    expect(content).toContain("queues/page-process.ts");

    expect(content).toContain("`page-index`");
    expect(content).toContain("`index`");
    expect(content).toContain("jobs/page-index.ts");
    expect(content).toContain("queues/page-index.ts");

    expect(content).toContain("`embed-chunks`");
    expect(content).toContain("`embed`");
    expect(content).toContain("jobs/embed-chunks.ts");
    expect(content).toContain("queues/embed-chunks.ts");

    expect(content).toContain("`enrich-page`");
    expect(content).toContain("`enrich`");
    expect(content).toContain("jobs/enrich-page.ts");
    expect(content).toContain("queues/enrich-page.ts");
  });

  it("documents deletion and reindexing jobs", async () => {
    const content = await readFile(ingestionJobsDocPath, "utf-8");

    expect(content).toContain("`deletion`");
    expect(content).toContain("`hard-delete`");
    expect(content).toContain("jobs/hard-delete.ts");
    expect(content).toContain("queues/deletion.ts");

    expect(content).toContain("`kb-reindex`");
    expect(content).toContain("`reindex`");
    expect(content).toContain("jobs/kb-reindex.ts");
    expect(content).toContain("queues/kb-reindex.ts");
  });

  it("labels ingestion worker ownership", async () => {
    const content = await readFile(ingestionJobsDocPath, "utf-8");

    expect(content).toContain("ingestion-worker");
  });

  it("documents payload invariants", async () => {
    const content = await readFile(ingestionJobsDocPath, "utf-8");

    expect(content).toContain("## Payload Invariants");
    expect(content).toContain("requestId");
    expect(content).toContain("traceId");
    expect(content).toContain("PageProcessJob");
    expect(content).toContain("upload://");
    expect(content).toContain("SourceRunStage");
    expect(content).toContain("chunkIds");
  });

  it("documents retry and idempotency rules", async () => {
    const content = await readFile(ingestionJobsDocPath, "utf-8");

    expect(content).toContain("## Retry and Idempotency Rules");
    expect(content).toContain("JOB_RETRY_ATTEMPTS=3");
    expect(content).toContain("JOB_BACKOFF_TYPE=exponential");
    expect(content).toContain("kb-reindex");
    expect(content).toContain("source-run-start-");
    expect(content).toContain("page-process-");
    expect(content).toContain("enrich-");
  });
});
