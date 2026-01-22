import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const architectureDocPath = join(
  import.meta.dir,
  "../../../docs/refactor/architecture.md"
);

describe("refactor architecture documentation", () => {
  it("captures module boundary highlights", async () => {
    const content = await readFile(architectureDocPath, "utf-8");

    expect(content).toContain("## Module Boundaries");
    expect(content).toContain("apps/api/src/app.ts");
    expect(content).toContain("apps/ingestion-worker");
    expect(content).toContain("apps/scraper-worker");
    expect(content).toContain("apps/web/src/app/page-registry.ts");
  });

  it("records shared package placement", async () => {
    const content = await readFile(architectureDocPath, "utf-8");

    expect(content).toContain("packages/shared/src/types/index.ts");
    expect(content).toContain("packages/shared/src/types/");
  });

  it("links to contract touchpoints", async () => {
    const content = await readFile(architectureDocPath, "utf-8");

    expect(content).toContain("docs/refactor/api-modules.md");
    expect(content).toContain("docs/refactor/ingestion-jobs.md");
    expect(content).toContain("docs/refactor/scraper-fetch.md");
    expect(content).toContain("docs/refactor/web-navigation.md");
  });

  it("states refactor constraints", async () => {
    const content = await readFile(architectureDocPath, "utf-8");

    expect(content).toContain("## Refactor Constraints");
    expect(content).toContain("No API response");
    expect(content).toContain("No database schema");
  });
});
