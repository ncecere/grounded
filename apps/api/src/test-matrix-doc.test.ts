import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const testMatrixDocPath = join(
  import.meta.dir,
  "../../../docs/refactor/test-matrix.md"
);

describe("refactor test matrix doc", () => {
  it("documents automated check coverage", async () => {
    const content = await readFile(testMatrixDocPath, "utf-8");

    expect(content).toContain("Automated checks by app");
    expect(content).toContain("bun run --filter @grounded/api test");
    expect(content).toContain("bun run --filter @grounded/web test");
    expect(content).toContain("bun run --filter @grounded/ingestion-worker typecheck");
    expect(content).toContain("bun run --filter @grounded/scraper-worker typecheck");
  });

  it("lists workflow validation expectations", async () => {
    const content = await readFile(testMatrixDocPath, "utf-8");

    expect(content).toContain("Workflow validation matrix");
    expect(content).toContain("Auth + tenant access");
    expect(content).toContain("Chat SSE (widget/chat endpoint)");
    expect(content).toContain("Ingestion run (discover -> embed)");
    expect(content).toContain("Scrape page fetch");
  });
});
