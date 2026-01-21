import { describe, it, expect, beforeEach, mock } from "bun:test";
import { SourceRunStage } from "@grounded/shared";

const log = {
  info: mock(() => undefined),
  debug: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
  trace: mock(() => undefined),
  fatal: mock(() => undefined),
};

const sourceRunsFindFirst = mock<(...args: any[]) => Promise<any>>(async () => null);
const sourcesFindFirst = mock<(...args: any[]) => Promise<any>>(async () => null);
const sourceRunPagesFindMany = mock<(...args: any[]) => Promise<Array<{ id: string }>>>(async () => []);
const sourceRunPageContentsFindMany =
  mock<(...args: any[]) => Promise<Array<{ id: string; sourceRunPageId: string }>>>(async () => []);
const kbChunksFindMany = mock<(...args: any[]) => Promise<Array<{ id: string }>>>(async () => []);
const updateWhereMock = mock(() => undefined);
const updateSetMock = mock(() => ({ where: updateWhereMock }));
const updateMock = mock(() => ({ set: updateSetMock }));

const dbMock = {
  query: {
    sourceRuns: { findFirst: sourceRunsFindFirst },
    sources: { findFirst: sourcesFindFirst },
    sourceRunPages: { findMany: sourceRunPagesFindMany },
    sourceRunPageContents: { findMany: sourceRunPageContentsFindMany },
    kbChunks: { findMany: kbChunksFindMany },
  },
  update: updateMock,
};

const addPageFetchJob = mock<(...args: any[]) => Promise<void>>(async () => undefined);
const registerRun = mock<(...args: any[]) => Promise<void>>(async () => undefined);
const initializeStageProgress = mock<(...args: any[]) => Promise<void>>(async () => undefined);
const getFetchedHtmlUrls = mock<(...args: any[]) => Promise<string[]>>(async () => []);
const getFetchedHtml = mock<(...args: any[]) => Promise<null | { title: string }>>(async () => null);
const addPageProcessJob = mock<(...args: any[]) => Promise<void>>(async () => undefined);
const addPageIndexJob = mock<(...args: any[]) => Promise<void>>(async () => undefined);
const initializeChunkEmbedStatuses = mock<(...args: any[]) => Promise<void>>(async () => undefined);
const addEmbedChunksBatchJob = mock<(...args: any[]) => Promise<void>>(async () => undefined);

let getQueuedUrlsMock = mock<(...args: any[]) => Promise<string[]>>(async () => []);
const createCrawlState = mock(() => ({
  getQueuedUrls: (...args: Parameters<typeof getQueuedUrlsMock>) => getQueuedUrlsMock(...args),
}));

mock.module("@grounded/logger", () => ({ log }));
mock.module("@grounded/db", () => ({ db: dbMock }));
mock.module("@grounded/queue", () => ({
  addPageFetchJob,
  registerRun,
  initializeStageProgress,
  getFetchedHtmlUrls,
  getFetchedHtml,
  addPageProcessJob,
  addPageIndexJob,
  initializeChunkEmbedStatuses,
  addEmbedChunksBatchJob,
  redis: {},
}));
mock.module("@grounded/crawl-state", () => ({
  createCrawlState: (...args: Parameters<typeof createCrawlState>) => createCrawlState(...args),
}));

beforeEach(async () => {
  sourceRunsFindFirst.mockClear();
  sourcesFindFirst.mockClear();
  sourceRunPagesFindMany.mockClear();
  sourceRunPageContentsFindMany.mockClear();
  kbChunksFindMany.mockClear();
  updateWhereMock.mockClear();
  updateSetMock.mockClear();
  updateMock.mockClear();
  addPageFetchJob.mockClear();
  registerRun.mockClear();
  initializeStageProgress.mockClear();
  getFetchedHtmlUrls.mockClear();
  getFetchedHtml.mockClear();
  addPageProcessJob.mockClear();
  addPageIndexJob.mockClear();
  initializeChunkEmbedStatuses.mockClear();
  addEmbedChunksBatchJob.mockClear();
  createCrawlState.mockClear();
  log.info.mockClear();
  log.debug.mockClear();
  log.warn.mockClear();
  log.error.mockClear();
  log.trace.mockClear();
  log.fatal.mockClear();

  getQueuedUrlsMock = mock(async () => [] as string[]);

  const { setStageManagerConfig } = await import("./stage/config");
  setStageManagerConfig({ batchSize: 2, jobsPerSecondPerRun: 10 });
});

describe("stage transition helpers", () => {
  it("returns next stage and total stages", async () => {
    const { getNextStage, getStageIndex, getTotalStages } = await import("./stage/transitions");

    expect(getNextStage(SourceRunStage.SCRAPING)).toBe(SourceRunStage.PROCESSING);
    expect(getNextStage(SourceRunStage.COMPLETED)).toBeNull();
    expect(getStageIndex(SourceRunStage.DISCOVERING)).toBe(1);
    expect(getStageIndex(SourceRunStage.EMBEDDING)).toBe(5);
    expect(getTotalStages()).toBe(5);
  });

  it("initializes the next stage when items exist", async () => {
    const runId = "run-123";
    sourceRunsFindFirst.mockResolvedValueOnce({
      id: runId,
      stage: SourceRunStage.SCRAPING,
      stageFailed: 0,
    });
    getFetchedHtmlUrls.mockResolvedValueOnce(["url-1", "url-2", "url-3"]);

    const { transitionToNextStage } = await import("./stage/transitions");

    const result = await transitionToNextStage(runId);

    expect(result).toEqual({ nextStage: SourceRunStage.PROCESSING, itemCount: 3 });
    expect(getFetchedHtmlUrls).toHaveBeenCalledWith(runId);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      stage: SourceRunStage.PROCESSING,
      stageTotal: 3,
    }));
  });
});

describe("queueing helpers", () => {
  it("queues scraping jobs in batches", async () => {
    const runId = "run-1";
    const tenantId = "tenant-1";
    sourceRunsFindFirst.mockResolvedValueOnce({ id: runId, sourceId: "source-1" });
    sourcesFindFirst.mockResolvedValueOnce({
      id: "source-1",
      config: { firecrawlEnabled: true },
    });
    getQueuedUrlsMock.mockResolvedValueOnce(["https://a.com", "https://b.com", "https://c.com"]);

    const { queueScrapingJobs } = await import("./stage/queue-scraping");
    const queued = await queueScrapingJobs(runId, tenantId, "req-1", "trace-1");

    expect(queued).toBe(3);
    expect(registerRun).toHaveBeenCalledWith(runId);
    expect(initializeStageProgress).toHaveBeenCalledWith(runId, 3);
    expect(addPageFetchJob).toHaveBeenCalledTimes(3);
    const [fetchPayload, fetchOptions] = addPageFetchJob.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(fetchPayload).toMatchObject({
      runId,
      tenantId,
      url: "https://a.com",
      fetchMode: "firecrawl",
    });
    expect(fetchOptions).toEqual({ priority: 3 });
  });

  it("throws when scraping run is missing", async () => {
    const { queueScrapingJobs } = await import("./stage/queue-scraping");

    await expect(queueScrapingJobs("run-missing", null)).rejects.toThrow("Run run-missing not found");
  });

  it("queues processing jobs and skips missing HTML", async () => {
    getFetchedHtmlUrls.mockResolvedValueOnce(["url-1", "url-2", "url-3"]);
    getFetchedHtml.mockImplementation(async (_runId: string, url: string) => {
      if (url === "url-2") {
        return null;
      }
      return { title: `Title ${url}` };
    });

    const { queueProcessingJobs } = await import("./stage/queue-processing");
    const queued = await queueProcessingJobs("run-2", "tenant-2");

    expect(queued).toBe(2);
    expect(initializeStageProgress).toHaveBeenCalledWith("run-2", 3);
    expect(addPageProcessJob).toHaveBeenCalledTimes(2);
    const [processPayload] = addPageProcessJob.mock.calls[0] as [Record<string, unknown>];
    expect(processPayload).toMatchObject({
      url: "url-1",
      title: "Title url-1",
      html: "",
    });
  });

  it("queues indexing jobs for processed pages", async () => {
    sourceRunPagesFindMany.mockResolvedValueOnce([{ id: "page-1" }, { id: "page-2" }]);
    sourceRunPageContentsFindMany.mockResolvedValueOnce([
      { id: "content-1", sourceRunPageId: "page-1" },
      { id: "content-2", sourceRunPageId: "page-2" },
    ]);

    const { queueIndexingJobs } = await import("./stage/queue-indexing");
    const queued = await queueIndexingJobs("run-3", "tenant-3");

    expect(queued).toBe(2);
    expect(initializeStageProgress).toHaveBeenCalledWith("run-3", 2);
    expect(addPageIndexJob).toHaveBeenCalledTimes(2);
    const [indexPayload] = addPageIndexJob.mock.calls[0] as [Record<string, unknown>];
    expect(indexPayload).toMatchObject({
      runId: "run-3",
      pageId: "page-1",
      contentId: "content-1",
    });
  });

  it("queues embedding jobs in batches", async () => {
    sourceRunsFindFirst.mockResolvedValueOnce({ id: "run-4", sourceId: "source-4" });
    sourcesFindFirst.mockResolvedValueOnce({ id: "source-4", kbId: "kb-4" });
    kbChunksFindMany.mockResolvedValueOnce([
      { id: "chunk-1" },
      { id: "chunk-2" },
      { id: "chunk-3" },
    ]);

    const { queueEmbeddingJobs } = await import("./stage/queue-embedding");
    const queued = await queueEmbeddingJobs("run-4", "tenant-4");

    expect(queued).toBe(1);
    expect(initializeStageProgress).toHaveBeenCalledWith("run-4", 1);
    expect(initializeChunkEmbedStatuses).toHaveBeenCalledWith("run-4", "kb-4", [
      "chunk-1",
      "chunk-2",
      "chunk-3",
    ]);
    expect(addEmbedChunksBatchJob).toHaveBeenCalledTimes(1);
    const [embedPayload] = addEmbedChunksBatchJob.mock.calls[0] as [Record<string, unknown>];
    expect(embedPayload).toMatchObject({
      kbId: "kb-4",
      chunkIds: ["chunk-1", "chunk-2", "chunk-3"],
    });
  });
});
