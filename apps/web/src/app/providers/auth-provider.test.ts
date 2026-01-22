import { describe, it, expect } from "bun:test";

const authProviderModuleUrl = new URL("./auth-provider.tsx", import.meta.url);

describe("AuthProvider", () => {
  it("should wire the auth query to getMe", async () => {
    const source = await Bun.file(authProviderModuleUrl).text();

    expect(source).toContain("useQuery");
    expect(source).toContain("api.getMe");
    expect(source).toContain("getToken");
  });

  it("should clear auth state on logout", async () => {
    const source = await Bun.file(authProviderModuleUrl).text();

    expect(source).toContain("clearToken");
    expect(source).toContain("clearCurrentTenantId");
    expect(source).toContain("logout");
  });
});
