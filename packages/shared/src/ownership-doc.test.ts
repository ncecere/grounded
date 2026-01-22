import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const ownershipDocPath = join(
  import.meta.dir,
  "../../../docs/refactor/ownership.md"
);

describe("module ownership documentation", () => {
  it("defines ownership principles and escalation paths", async () => {
    const content = await readFile(ownershipDocPath, "utf-8");

    expect(content).toContain("## Ownership Principles");
    expect(content).toContain("## Escalation Paths");
    expect(content).toContain("refactor lead");
  });

  it("includes the module ownership map", async () => {
    const content = await readFile(ownershipDocPath, "utf-8");

    expect(content).toContain("## Module Ownership Map");
    expect(content).toContain("apps/api");
    expect(content).toContain("apps/ingestion-worker");
    expect(content).toContain("apps/scraper-worker");
    expect(content).toContain("apps/web");
    expect(content).toContain("packages/shared");
  });

  it("calls out shared package coordination rules", async () => {
    const content = await readFile(ownershipDocPath, "utf-8");

    expect(content).toContain("Change Coordination Rules");
    expect(content).toContain("docs/refactor/shared-packages.md");
    expect(content).toContain("docs/refactor/migration-log.md");
  });
});
