import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const migrationLogPath = join(
  import.meta.dir,
  "../../../docs/refactor/migration-log.md"
);

describe("refactor migration log template", () => {
  it("includes the required sections", async () => {
    const content = await readFile(migrationLogPath, "utf-8");

    expect(content).toContain("Migration Log Template");
    expect(content).toContain("## Entries");
    expect(content).toContain("#### Moves");
    expect(content).toContain("#### Decisions");
    expect(content).toContain("#### Owners");
  });

  it("provides an entry template", async () => {
    const content = await readFile(migrationLogPath, "utf-8");

    expect(content).toContain("## Entry Template");
    expect(content).toContain("### YYYY-MM-DD");
    expect(content).toContain("from/path");
    expect(content).toContain("Decision summary");
    expect(content).toContain("domain/module");
  });
});
