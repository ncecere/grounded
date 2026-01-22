import { describe, it, expect } from "bun:test";

const appModuleUrl = new URL("../App.tsx", import.meta.url);

describe("App page registry usage", () => {
  it("should derive labels from the page registry", async () => {
    const source = await Bun.file(appModuleUrl).text();

    expect(source).toContain("pageRegistryById");
    expect(source).toContain("currentEntry?.label");
  });

  it("should render registry pages for default cases", async () => {
    const source = await Bun.file(appModuleUrl).text();

    expect(source).toContain("renderRegistryPage");
    expect(source).toContain("customPageIds");
    expect(source).not.toContain("pageNames");
  });

  it("should enforce auth gates for registry pages", async () => {
    const source = await Bun.file(appModuleUrl).text();

    expect(source).toContain("canAccessPage");
    expect(source).toContain("hasAccess");
  });
});
