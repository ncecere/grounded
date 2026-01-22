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
});
