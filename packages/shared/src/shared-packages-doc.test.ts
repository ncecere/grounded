import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const sharedPackagesDocPath = join(
  import.meta.dir,
  "../../../docs/refactor/shared-packages.md"
);

describe("shared package conventions documentation", () => {
  it("defines export conventions for shared types", async () => {
    const content = await readFile(sharedPackagesDocPath, "utf-8");

    expect(content).toContain("## Export Conventions");
    expect(content).toContain("packages/shared/src/index.ts");
    expect(content).toContain("packages/shared/src/types/");
    expect(content).toContain("@grounded/shared/types/api");
  });

  it("documents import rules and deprecation guidance", async () => {
    const content = await readFile(sharedPackagesDocPath, "utf-8");

    expect(content).toContain("## Import Rules");
    expect(content).toContain("Avoid cross-domain imports");
    expect(content).toContain("@deprecated");
    expect(content).toContain("docs/refactor/migration-log.md");
  });

  it("links validation checks and references", async () => {
    const content = await readFile(sharedPackagesDocPath, "utf-8");

    expect(content).toContain("## Validation Checklist");
    expect(content).toContain("packages/shared/src/exports-map.test.ts");
    expect(content).toContain("apps/web/src/lib/api/types/types-imports.test.ts");
    expect(content).toContain("docs/refactor/ownership.md");
  });
});
