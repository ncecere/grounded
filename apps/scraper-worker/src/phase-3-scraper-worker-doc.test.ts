import { describe, expect, it } from "bun:test";
import { readFile, readdir, access } from "fs/promises";
import { join } from "path";

const phase3DocPath = join(
  import.meta.dir,
  "../../../tasks/phase-3-scraper-worker.md"
);

const scraperWorkerSrcPath = join(import.meta.dir);

describe("phase 3 scraper worker folder layout documentation", () => {
  it("defines folder layout section", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("## Folder Layout");
    expect(content).toContain("apps/scraper-worker/src/");
  });

  it("documents module folders and key files", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("bootstrap/");
    expect(content).toMatch(/bootstrap\/\s*\n.*index\.ts/);
    expect(content).toContain("settings.ts");
    expect(content).toContain("jobs/");
    expect(content).toContain("page-fetch.ts");
    expect(content).toContain("fetch/");
    expect(content).toContain("http.ts");
    expect(content).toContain("playwright.ts");
    expect(content).toContain("firecrawl.ts");
    expect(content).toContain("selection.ts");
    expect(content).toContain("browser/");
    expect(content).toContain("pool.ts");
    expect(content).toContain("services/");
    expect(content).toContain("content-validation.ts");
    expect(content).toContain("fairness-slots.ts");
  });

  it("includes file mapping from current to proposed", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### File Mapping from Current to Proposed");
    expect(content).toContain("| Current Location | Proposed Location |");
    expect(content).toContain("`index.ts`");
    expect(content).toContain("`bootstrap/settings.ts`");
    expect(content).toContain("`browser/pool.ts`");
    expect(content).toContain("`jobs/page-fetch.ts`");
    expect(content).toContain("`processors/page-fetch.ts`");
  });

  it("documents module responsibilities", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### Module Responsibilities");
    expect(content).toContain("**bootstrap/**");
    expect(content).toContain("**jobs/**");
    expect(content).toContain("**fetch/**");
    expect(content).toContain("**browser/**");
    expect(content).toContain("**services/**");
  });
});

describe("scraper worker current structure verification", () => {
  it("has index.ts entrypoint", async () => {
    const files = await readdir(scraperWorkerSrcPath);
    expect(files).toContain("index.ts");
  });

  it("has processors folder with page-fetch.ts", async () => {
    const files = await readdir(scraperWorkerSrcPath);
    expect(files).toContain("processors");

    const processorFiles = await readdir(join(scraperWorkerSrcPath, "processors"));
    expect(processorFiles).toContain("page-fetch.ts");
  });
});

describe("browser pool shutdown expectations documentation", () => {
  it("has browser pool shutdown expectations section", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("## Browser Pool Shutdown Expectations");
  });

  it("documents shutdown sequence", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### Shutdown Sequence");
    expect(content).toContain("Stop settings refresh");
    expect(content).toContain("Close BullMQ worker");
    expect(content).toContain("Shutdown browser pool");
    expect(content).toContain("Exit process");
  });

  it("documents in-flight page handling", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### In-Flight Page Handling");
    expect(content).toContain("Active jobs wait to complete");
    expect(content).toContain("Browser pool blocks new acquisitions");
    expect(content).toContain("Pages terminated with browser");
    expect(content).toContain("No orphaned browser processes");
  });

  it("documents fairness slot cleanup", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### Fairness Slot Cleanup");
    expect(content).toContain("Fairness slots are managed in Redis");
    expect(content).toContain("slots are released automatically");
  });

  it("documents timeout behavior", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### Timeout Behavior");
    expect(content).toContain("Graceful shutdown timeout");
    expect(content).toContain("BullMQ close timeout");
    expect(content).toContain("Recommendation");
  });

  it("documents error handling during shutdown", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### Error Handling During Shutdown");
    expect(content).toContain("Browser close errors are caught and logged");
    expect(content).toContain("Multiple shutdown calls are idempotent");
  });

  it("mentions SIGTERM and SIGINT signals", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("SIGTERM");
    expect(content).toContain("SIGINT");
  });

  it("mentions worker.close() behavior", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("worker.close()");
    expect(content).toContain("Waits for currently active job handlers to complete");
  });

  it("mentions shutdownBrowserPool() behavior", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("shutdownBrowserPool()");
    expect(content).toContain("blocks new `getBrowser()` calls");
  });

  it("documents BullMQ retry behavior for forceful termination", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("SIGKILL");
    expect(content).toContain("BullMQ handles retries");
  });
});

describe("browser pool shutdown implementation verification", () => {
  it("browser pool exports shutdownBrowserPool function", async () => {
    const poolPath = join(scraperWorkerSrcPath, "browser/pool.ts");
    const content = await readFile(poolPath, "utf-8");

    expect(content).toContain("export async function shutdownBrowserPool");
  });

  it("browser pool sets isShuttingDown flag on shutdown", async () => {
    const poolPath = join(scraperWorkerSrcPath, "browser/pool.ts");
    const content = await readFile(poolPath, "utf-8");

    expect(content).toContain("isShuttingDown = true");
  });

  it("browser pool blocks getBrowser when shutting down", async () => {
    const poolPath = join(scraperWorkerSrcPath, "browser/pool.ts");
    const content = await readFile(poolPath, "utf-8");

    expect(content).toContain('if (isShuttingDown)');
    expect(content).toContain("Browser pool is shutting down");
  });

  it("browser pool handles browser close errors gracefully", async () => {
    const poolPath = join(scraperWorkerSrcPath, "browser/pool.ts");
    const content = await readFile(poolPath, "utf-8");

    // Should have try-catch around browser.close()
    expect(content).toMatch(/try\s*\{[\s\S]*await browser\.close\(\)[\s\S]*\}\s*catch/);
    expect(content).toContain("Error closing browser");
  });

  it("browser pool supports multiple shutdown calls (idempotent)", async () => {
    const poolPath = join(scraperWorkerSrcPath, "browser/pool.ts");
    const content = await readFile(poolPath, "utf-8");

    // Early return if already shutting down
    expect(content).toContain('if (isShuttingDown)');
    expect(content).toContain("Browser pool shutdown already in progress");
  });

  it("scraper worker index calls worker.close before shutdownBrowserPool", async () => {
    const indexPath = join(scraperWorkerSrcPath, "index.ts");
    const content = await readFile(indexPath, "utf-8");

    // Find positions of both calls to verify order
    const workerClosePos = content.indexOf("await pageFetchWorker.close()");
    const shutdownPoolPos = content.indexOf("await shutdownBrowserPool()");

    expect(workerClosePos).toBeGreaterThan(-1);
    expect(shutdownPoolPos).toBeGreaterThan(-1);
    expect(workerClosePos).toBeLessThan(shutdownPoolPos);
  });

  it("scraper worker index handles SIGTERM and SIGINT", async () => {
    const indexPath = join(scraperWorkerSrcPath, "index.ts");
    const content = await readFile(indexPath, "utf-8");

    expect(content).toContain('process.on("SIGTERM", shutdown)');
    expect(content).toContain('process.on("SIGINT", shutdown)');
  });

  it("scraper worker stops settings refresh on shutdown", async () => {
    const indexPath = join(scraperWorkerSrcPath, "index.ts");
    const content = await readFile(indexPath, "utf-8");

    // After bootstrap refactor, index.ts calls stopSettingsRefresh() from bootstrap
    expect(content).toContain("stopSettingsRefresh()");
    expect(content).toContain('from "./bootstrap"');
  });

  it("bootstrap settings module stops periodic refresh", async () => {
    const settingsPath = join(scraperWorkerSrcPath, "bootstrap/settings.ts");
    const content = await readFile(settingsPath, "utf-8");

    // The actual stopPeriodicRefresh call is now in the bootstrap module
    expect(content).toContain("settingsClient.stopPeriodicRefresh()");
  });
});
