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
    expect(content).toContain("Service/Repo Transaction Patterns");
    expect(content).toContain("Repos should accept an optional transaction client");
  });

  it("defines the module template", async () => {
    const content = await readFile(apiStructurePath, "utf-8");

    expect(content).toContain("Module Template");
    expect(content).toContain("apps/api/src/modules/<domain>");
    expect(content).toContain("routes.ts");
    expect(content).toContain("schema.ts");
    expect(content).toContain("service.ts");
    expect(content).toContain("repo.ts");
    expect(content).toContain("types.ts");
  });

  it("documents required exports and optional layers", async () => {
    const content = await readFile(apiStructurePath, "utf-8");

    expect(content).toContain("Required Exports and Optional Layers");
    expect(content).toContain("Required exports");
    expect(content).toContain("`routes`");
    expect(content).toContain("`service`");
    expect(content).toContain("Optional layers");
    expect(content).toContain("`repo.ts` can be omitted");
  });

  it("documents middleware order and route mounts", async () => {
    const content = await readFile(apiStructurePath, "utf-8");

    expect(content).toContain("Middleware Order and Route Mount Map");
    expect(content).toContain("Global Middleware Order");
    expect(content).toContain("requestId()");
    expect(content).toContain("wideEventMiddleware()");
    expect(content).toContain("V1 Route Mount Map");
    expect(content).toContain("/api/v1/auth");
    expect(content).toContain("/api/v1/admin");
    expect(content).toContain("/api/v1/internal/workers");
  });

  it("documents route aliases and shared routers", async () => {
    const content = await readFile(apiStructurePath, "utf-8");

    expect(content).toContain("Route Aliases and Shared Routers");
    expect(content).toContain("/api/v1/global-knowledge-bases");
    expect(content).toContain("/api/v1/agents");
    expect(content).toContain("/chat/:token");
    expect(content).toContain("/api/v1/c/:token");
  });

  it("captures observability parity guidance", async () => {
    const content = await readFile(apiStructurePath, "utf-8");

    expect(content).toContain("Observability Parity");
    expect(content).toContain("wideEventMiddleware");
    expect(content).toContain("error.code");
    expect(content).toContain("tasks/phase-0-baseline.md");
    expect(content).toContain("docs/refactor/migration-log.md");
  });
});
