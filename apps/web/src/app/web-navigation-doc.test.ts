import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const webNavigationDocPath = join(
  import.meta.dir,
  "../../../../docs/refactor/web-navigation.md"
);

describe("web navigation documentation", () => {
  it("documents provider boundaries", async () => {
    const content = await readFile(webNavigationDocPath, "utf-8");

    expect(content).toContain("## Provider Boundaries");
    expect(content).toContain("AuthProvider");
    expect(content).toContain("TenantProvider");
    expect(content).toContain("AppStateProvider");
  });

  it("documents the page registry", async () => {
    const content = await readFile(webNavigationDocPath, "utf-8");

    expect(content).toContain("## Page Registry");
    expect(content).toContain("apps/web/src/app/page-registry.ts");
    expect(content).toContain("authGate");
    expect(content).toContain("order");
  });

  it("notes key provider responsibilities", async () => {
    const content = await readFile(webNavigationDocPath, "utf-8");

    expect(content).toContain("api.getMe");
    expect(content).toContain("api.getMyTenants");
    expect(content).toContain("knowledge bases");
    expect(content).toContain("current page");
  });

  it("records provider order", async () => {
    const content = await readFile(webNavigationDocPath, "utf-8");

    expect(content).toContain("### Provider Order");
    expect(content).toContain("AuthProvider");
    expect(content).toContain("TenantProvider");
    expect(content).toContain("AppStateProvider");
  });

  it("captures page access gates", async () => {
    const content = await readFile(webNavigationDocPath, "utf-8");

    expect(content).toContain("## Page Access Gates");
    expect(content).toContain("canAccessPage");
    expect(content).toContain("tenant-admin");
    expect(content).toContain("system-admin");
  });
});
