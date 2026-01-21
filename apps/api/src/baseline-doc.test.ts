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

  it("captures ingestion pipeline flow and queue ownership", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Ingestion Pipeline Flow");
    expect(content).toContain("DISCOVERING → SCRAPING → PROCESSING → INDEXING → EMBEDDING → COMPLETED");
    expect(content).toContain("source-run");
    expect(content).toContain("stage-transition");
    expect(content).toContain("page-fetch");
    expect(content).toContain("page-process");
    expect(content).toContain("page-index");
    expect(content).toContain("embed-chunks");
    expect(content).toContain("apps/scraper-worker/src/processors/page-fetch.ts");
  });

  it("documents queue payloads and processors", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Queue Names, Payloads, and Processors");
    expect(content).toContain("SourceRunStartJob");
    expect(content).toContain("PageFetchJob");
    expect(content).toContain("HardDeleteObjectJob");
    expect(content).toContain("apps/ingestion-worker/src/processors/kb-reindex.ts");
  });

  it("captures API and SSE contract baselines", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Contract Baselines (API, SSE, Queue Payloads)");
    expect(content).toContain("token_type");
    expect(content).toContain("Widget config");
    expect(content).toContain("Simple RAG stream event types");
    expect(content).toContain("reasoning");
    expect(content).toContain("conversationId");
  });

  it("captures observability log fields and error codes", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Observability Baseline");
    expect(content).toContain("requestId");
    expect(content).toContain("traceId");
    expect(content).toContain("durationMs");
    expect(content).toContain("NETWORK_TIMEOUT");
    expect(content).toContain("CONTENT_UNSUPPORTED_TYPE");
  });

  it("inventories API routes by method and owner", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("API Route Inventory");
    expect(content).toContain("POST `/api/v1/auth/register`");
    expect(content).toContain("GET `/api/v1/agents/:agentId`");
    expect(content).toContain("GET `/api/v1/admin/settings`");
    expect(content).toContain("GET `/api/v1/internal/workers/settings`");
  });

  it("inventories web pages and navigation flows", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Web App Page Inventory and Navigation Flows");
    expect(content).toContain("Knowledge Bases");
    expect(content).toContain("apps/web/src/pages/KnowledgeBases.tsx");
    expect(content).toContain("apps/web/src/pages/Agents.tsx");
    expect(content).toContain("Shared KBs");
    expect(content).toContain("apps/web/src/pages/AdminSharedKBs.tsx");
    expect(content).toContain("Agents -> Chat");
  });
});
