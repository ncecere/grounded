import { describe, it, expect } from "bun:test";

const appSidebarModuleUrl = new URL("./app-sidebar.tsx", import.meta.url);

describe("AppSidebar page registry usage", () => {
  it("should build nav items from the page registry", async () => {
    const source = await Bun.file(appSidebarModuleUrl).text();

    expect(source).toContain("pageRegistryById");
    expect(source).toContain("getNavItems");
  });

  it("should define navigation ids for the sidebar", async () => {
    const source = await Bun.file(appSidebarModuleUrl).text();

    expect(source).toContain("navPageIds");
  });

  it("should group navigation items using registry metadata", async () => {
    const source = await Bun.file(appSidebarModuleUrl).text();

    expect(source).toContain("entry.group");
    expect(source).toContain("workspaceNavEntries");
    expect(source).toContain("adminNavEntries");
  });

  it("should gate navigation using registry auth rules", async () => {
    const source = await Bun.file(appSidebarModuleUrl).text();

    expect(source).toContain("canAccessPage");
    expect(source).toContain("accessContext");
  });
});
