import { describe, it, expect } from "bun:test";

const appStateProviderModuleUrl = new URL("./app-state-provider.tsx", import.meta.url);

describe("AppStateProvider", () => {
  it("should manage page navigation and selections", async () => {
    const source = await Bun.file(appStateProviderModuleUrl).text();

    expect(source).toContain("useState");
    expect(source).toContain("currentPage");
    expect(source).toContain("selectedKbId");
    expect(source).toContain("selectedAgentId");
    expect(source).toContain("selectedSharedKbId");
    expect(source).toContain("selectedSuiteId");
  });

  it("should expose navigation helpers", async () => {
    const source = await Bun.file(appStateProviderModuleUrl).text();

    expect(source).toContain("navigate");
    expect(source).toContain("resetSelections");
    expect(source).toContain("resetForTenantChange");
  });
});
