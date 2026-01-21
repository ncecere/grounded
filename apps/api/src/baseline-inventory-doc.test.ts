import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const baselineInventoryPath = join(
  import.meta.dir,
  "../../../docs/refactor/baseline.md"
);

describe("refactor baseline inventory note", () => {
  it("links to baseline source and supporting docs", async () => {
    const content = await readFile(baselineInventoryPath, "utf-8");

    expect(content).toContain("tasks/phase-0-baseline.md");
    expect(content).toContain("docs/refactor/dependencies.md");
    expect(content).toContain("docs/refactor/test-matrix.md");
  });

  it("covers required inventory sections", async () => {
    const content = await readFile(baselineInventoryPath, "utf-8");

    expect(content).toContain("Runtime Entrypoints and Startup Sequence");
    expect(content).toContain("Environment Variables and Settings Precedence");
    expect(content).toContain("Startup Environment/Config Dependencies");
    expect(content).toContain("External Service Dependencies");
    expect(content).toContain("Ingestion Pipeline Flow");
    expect(content).toContain("Queue Names, Payloads, and Processors");
    expect(content).toContain("Contract Baselines (API, SSE, Queue Payloads)");
    expect(content).toContain("API Route Inventory");
    expect(content).toContain("Web App Page Inventory and Navigation Flows");
    expect(content).toContain("Largest Files and Repeated Patterns");
    expect(content).toContain("Cross-Cutting Helpers");
    expect(content).toContain("Shared Packages and Consumers");
    expect(content).toContain("Tenant Boundary and RLS Enforcement Touchpoints");
    expect(content).toContain("Observability Baseline");
    expect(content).toContain("Baseline Throughput and Performance Snapshot");
    expect(content).toContain("Critical Workflow Checklist");
    expect(content).toContain("Existing Tests and Smoke Checks");
    expect(content).toContain("Refactor Constraints");
    expect(content).toContain("Phase Dependencies and Potential Blockers");
  });
});
