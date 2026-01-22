import { describe, it, expect } from "bun:test";

const appSidebarModuleUrl = new URL("./app-sidebar.tsx", import.meta.url);

describe("AppSidebar page registry usage", () => {
  it("should build nav items from the page registry", async () => {
    const source = await Bun.file(appSidebarModuleUrl).text();

    expect(source).toContain("pageRegistryById");
    expect(source).toContain("getNavItems");
  });

  it("should define workspace and admin navigation ids", async () => {
    const source = await Bun.file(appSidebarModuleUrl).text();

    expect(source).toContain("workspaceNavPageIds");
    expect(source).toContain("adminNavPageIds");
  });
});
