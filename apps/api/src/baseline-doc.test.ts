import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const baselineDocPath = join(import.meta.dir, "../../../tasks/phase-0-baseline.md");

describe("phase-0 baseline runtime entrypoints", () => {
  it("documents entrypoints for core apps and workers", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Runtime Entrypoints and Startup Sequence");
    expect(content).toContain("API (apps/api)");
    expect(content).toContain("Web App (apps/web)");
    expect(content).toContain("Ingestion Worker (apps/ingestion-worker)");
    expect(content).toContain("Scraper Worker (apps/scraper-worker)");
  });

  it("captures key startup actions", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Run database migrations");
    expect(content).toContain("Initialize the vector store");
    expect(content).toContain("Fetch worker settings from the API");
    expect(content).toContain("Create the React Query `QueryClient`");
  });

  it("documents environment variables and precedence", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Environment Variables and Settings Precedence");
    expect(content).toContain("SESSION_SECRET");
    expect(content).toContain("WORKER_CONCURRENCY");
    expect(content).toContain("SETTINGS_REFRESH_INTERVAL_MS");
    expect(content).toContain("INTERNAL_API_KEY");
  });
});
