import { describe, it, expect } from "bun:test";

const appModuleUrl = new URL("../App.tsx", import.meta.url);
const mainModuleUrl = new URL("../main.tsx", import.meta.url);

describe("Auth/Tenant providers", () => {
  it("should wrap the app with auth and tenant providers", async () => {
    const source = await Bun.file(mainModuleUrl).text();

    expect(source).toContain("<AuthProvider>");
    expect(source).toContain("<TenantProvider>");
  });

  it("should consume auth and tenant state in App", async () => {
    const source = await Bun.file(appModuleUrl).text();

    expect(source).toContain("useAuth");
    expect(source).toContain("useTenant");
  });
});
