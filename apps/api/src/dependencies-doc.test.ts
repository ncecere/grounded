import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const dependenciesDocPath = join(
  import.meta.dir,
  "../../../docs/refactor/dependencies.md"
);

describe("refactor dependency map doc", () => {
  it("covers workspace package dependencies", async () => {
    const content = await readFile(dependenciesDocPath, "utf-8");

    expect(content).toContain("Package dependency map");
    expect(content).toContain("apps/api");
    expect(content).toContain("@grounded/db");
    expect(content).toContain("@grounded/queue");
    expect(content).toContain("@grounded/shared");
  });

  it("lists external service dependencies", async () => {
    const content = await readFile(dependenciesDocPath, "utf-8");

    expect(content).toContain("External service dependencies");
    expect(content).toContain("PostgreSQL 16");
    expect(content).toContain("Redis 7");
    expect(content).toContain("AI model providers");
    expect(content).toContain("Firecrawl API");
  });
});
