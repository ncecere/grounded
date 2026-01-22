import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const phase5DocPath = join(
  import.meta.dir,
  "../../../tasks/phase-5-shared-packages-docs.md"
);

describe("phase 5 shared packages documentation", () => {
  it("captures the shared type duplication audit", async () => {
    const content = await readFile(phase5DocPath, "utf-8");

    expect(content).toContain("## Shared Type Duplication Audit");
    expect(content).toContain("packages/shared/src/types/index.ts");
    expect(content).toContain("apps/web/src/lib/api/types/agents.ts");
  });

  it("calls out API and worker ownership notes", async () => {
    const content = await readFile(phase5DocPath, "utf-8");

    expect(content).toContain("apps/api/src/modules/agents/schema.ts");
    expect(content).toContain("apps/ingestion-worker");
    expect(content).toContain("apps/scraper-worker");
  });

  it("documents initial shared type submodules", async () => {
    const content = await readFile(phase5DocPath, "utf-8");

    expect(content).toContain("Type Submodules (Initial Pass)");
    expect(content).toContain("packages/shared/src/types/api.ts");
    expect(content).toContain("packages/shared/src/types/workers.ts");
    expect(content).toContain("packages/shared/src/types/queue.ts");
    expect(content).toContain("packages/shared/src/types/widget.ts");
    expect(content).toContain("packages/shared/src/types/analytics.ts");
    expect(content).toContain("packages/shared/src/types/admin.ts");
  });

  it("defines export boundaries and deprecation flow", async () => {
    const content = await readFile(phase5DocPath, "utf-8");

    expect(content).toContain("Export Boundaries and Deprecation Strategy");
    expect(content).toContain("packages/shared/src/types/index.ts");
    expect(content).toContain("Deprecation Flow for Moved Types");
    expect(content).toContain("@deprecated");
  });

  it("documents a deprecation timeline and removal criteria", async () => {
    const content = await readFile(phase5DocPath, "utf-8");

    expect(content).toContain("Deprecation Timeline and Removal Criteria");
    expect(content).toContain("T0 (type move release)");
    expect(content).toContain("Removal criteria");
    expect(content).toContain("docs/refactor/shared-packages.md");
  });
});
