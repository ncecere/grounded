import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const apiStructurePath = join(
  import.meta.dir,
  "../../../tasks/phase-1-api-structure.md"
);

describe("phase 1 api structure plan", () => {
  it("defines module boundaries", async () => {
    const content = await readFile(apiStructurePath, "utf-8");

    expect(content).toContain("Domain Module Boundaries and Migration Order");
    expect(content).toContain("`auth`:");
    expect(content).toContain("`tenants`:");
    expect(content).toContain("`knowledge-bases`:");
    expect(content).toContain("`sources`:");
    expect(content).toContain("`agents`:");
    expect(content).toContain("`chat`:");
    expect(content).toContain("`widget`:");
  });

  it("documents migration order", async () => {
    const content = await readFile(apiStructurePath, "utf-8");

    expect(content).toContain("Migration Order");
    expect(content).toContain("auth");
    expect(content).toContain("knowledge-bases");
    expect(content).toContain("chat");
    expect(content).toContain("admin");
  });

  it("documents module boundary rules", async () => {
    const content = await readFile(apiStructurePath, "utf-8");

    expect(content).toContain("Module Boundary Rules and Import Directions");
    expect(content).toContain("Allowed Import Directions");
    expect(content).toContain("`routes.ts` imports");
    expect(content).toContain("Cross-Module Access Rules");
    expect(content).toContain("Cross-module reads/writes go through");
  });
});
