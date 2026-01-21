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

  it("records startup environment and config dependencies", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Startup Environment/Config Dependencies");
    expect(content).toContain("migrations/");
    expect(content).toContain("published-chat.js");
    expect(content).toContain("apps/web/index.html");
    expect(content).toContain("REDIS_URL");
  });

  it("records external service dependencies", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("External Service Dependencies");
    expect(content).toContain("OpenAI");
    expect(content).toContain("Anthropic");
    expect(content).toContain("VECTOR_DB_URL");
    expect(content).toContain("SMTP");
    expect(content).toContain("FIRECRAWL_API_KEY");
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

  it("records baseline throughput and performance metrics", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Baseline Throughput and Performance Snapshot (Queues)");
    expect(content).toContain("JOBS_PER_SECOND_PER_RUN");
    expect(content).toContain("EMBED_WORKER_CONCURRENCY");
    expect(content).toContain("page-fetch");
    expect(content).toContain("FAIRNESS_*");
  });

  it("defines the critical workflow checklist", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Critical Workflow Checklist");
    expect(content).toContain("Auth and Tenant Access");
    expect(content).toContain("Chat SSE");
    expect(content).toContain("Ingestion Run");
    expect(content).toContain("Scrape Page Fetch");
    expect(content).toContain("conversationId");
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

  it("documents largest files and repeated patterns", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Largest Files and Repeated Patterns");
    expect(content).toContain("apps/api/src/services/advanced-rag.test.ts");
    expect(content).toContain("apps/web/src/pages/SourcesManager.tsx");
    expect(content).toContain("apps/ingestion-worker/src/processors/source-discover.ts");
    expect(content).toContain("apps/scraper-worker/src/processors/page-fetch.ts");
  });

  it("captures cross-cutting helpers", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Cross-Cutting Helpers");
    expect(content).toContain("apps/api/src/middleware/auth/middleware.ts");
    expect(content).toContain("apps/api/src/services/audit.ts");
    expect(content).toContain("packages/db/src/client.ts");
    expect(content).toContain("packages/logger/src/logger.ts");
    expect(content).toContain("packages/shared/src/settings/index.ts");
  });

  it("inventories shared packages and consumers", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Shared Packages and Consumers");
    expect(content).toContain("@grounded/shared");
    expect(content).toContain("@grounded/queue");
    expect(content).toContain("@grounded/logger");
    expect(content).toContain("@grounded/db");
    expect(content).toContain("apps/ingestion-worker");
    expect(content).toContain("apps/scraper-worker");
  });

  it("maps tenant boundary and RLS touchpoints", async () => {
    const content = await readFile(baselineDocPath, "utf-8");

    expect(content).toContain("Tenant Boundary and RLS Enforcement Touchpoints");
    expect(content).toContain("migrations/0002_rls_policies.sql");
    expect(content).toContain("migrations/0024_fix_global_kb_rls_policies.sql");
    expect(content).toContain("withRequestRLS");
    expect(content).toContain("X-Tenant-ID");
  });
});
