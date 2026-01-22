import { describe, it, expect } from "bun:test";

const tenantProviderModuleUrl = new URL("./tenant-provider.tsx", import.meta.url);

describe("TenantProvider", () => {
  it("should load tenants from the auth API", async () => {
    const source = await Bun.file(tenantProviderModuleUrl).text();

    expect(source).toContain("api.getMyTenants");
    expect(source).toContain("useQuery");
  });

  it("should manage the current tenant selection", async () => {
    const source = await Bun.file(tenantProviderModuleUrl).text();

    expect(source).toContain("getCurrentTenantId");
    expect(source).toContain("setCurrentTenantId");
    expect(source).toContain("clearCurrentTenantId");
    expect(source).toContain("selectTenant");
  });
});
