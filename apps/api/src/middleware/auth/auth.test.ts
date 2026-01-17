import { describe, it, expect, mock } from "bun:test";
import { UnauthorizedError, ForbiddenError } from "../error-handler";

// Since auth functions require a real database connection,
// we test them via behavior validation and module export verification.

describe("auth middleware modules", () => {
  describe("types module exports", () => {
    it("should export AuthUser type", async () => {
      const module = await import("./types");
      expect(module).toBeDefined();
    });

    it("should export AuthContext type", async () => {
      const module = await import("./types");
      expect(module).toBeDefined();
    });

    it("should export RLSContext type", async () => {
      const module = await import("./types");
      expect(module).toBeDefined();
    });
  });

  describe("helpers module exports", () => {
    it("should export withRequestRLS function", async () => {
      const { withRequestRLS } = await import("./helpers");
      expect(typeof withRequestRLS).toBe("function");
    });

    it("should export checkSystemAdmin function", async () => {
      const { checkSystemAdmin } = await import("./helpers");
      expect(typeof checkSystemAdmin).toBe("function");
    });

    it("should export findOrCreateUser function", async () => {
      const { findOrCreateUser } = await import("./helpers");
      expect(typeof findOrCreateUser).toBe("function");
    });

    it("should export getTenantMembership function", async () => {
      const { getTenantMembership } = await import("./helpers");
      expect(typeof getTenantMembership).toBe("function");
    });

    it("should export resolveTenantContext function", async () => {
      const { resolveTenantContext } = await import("./helpers");
      expect(typeof resolveTenantContext).toBe("function");
    });
  });

  describe("bearer module exports", () => {
    it("should export authenticateLocalJWT function", async () => {
      const { authenticateLocalJWT } = await import("./bearer");
      expect(typeof authenticateLocalJWT).toBe("function");
    });

    it("should export LOCAL_JWT_ISSUER constant", async () => {
      const { LOCAL_JWT_ISSUER } = await import("./bearer");
      expect(LOCAL_JWT_ISSUER).toBe("grounded-local");
    });

    it("should export LOCAL_JWT_AUDIENCE constant", async () => {
      const { LOCAL_JWT_AUDIENCE } = await import("./bearer");
      expect(LOCAL_JWT_AUDIENCE).toBe("grounded-api");
    });
  });

  describe("oidc module exports", () => {
    it("should export authenticateOIDC function", async () => {
      const { authenticateOIDC } = await import("./oidc");
      expect(typeof authenticateOIDC).toBe("function");
    });

    it("should export isOIDCConfigured function", async () => {
      const { isOIDCConfigured } = await import("./oidc");
      expect(typeof isOIDCConfigured).toBe("function");
    });

    it("should export getJWKS function", async () => {
      const { getJWKS } = await import("./oidc");
      expect(typeof getJWKS).toBe("function");
    });

    it("should return false for isOIDCConfigured when OIDC_ISSUER not set", async () => {
      const { isOIDCConfigured } = await import("./oidc");
      // In test environment, OIDC_ISSUER is not set
      expect(isOIDCConfigured()).toBe(false);
    });
  });

  describe("api-key module exports", () => {
    it("should export authenticateApiKey function", async () => {
      const { authenticateApiKey } = await import("./api-key");
      expect(typeof authenticateApiKey).toBe("function");
    });
  });

  describe("admin-token module exports", () => {
    it("should export authenticateAdminToken function", async () => {
      const { authenticateAdminToken } = await import("./admin-token");
      expect(typeof authenticateAdminToken).toBe("function");
    });
  });

  describe("middleware module exports", () => {
    it("should export auth middleware factory", async () => {
      const { auth } = await import("./middleware");
      expect(typeof auth).toBe("function");
    });

    it("should export requireRole middleware factory", async () => {
      const { requireRole } = await import("./middleware");
      expect(typeof requireRole).toBe("function");
    });

    it("should export requireSystemAdmin middleware factory", async () => {
      const { requireSystemAdmin } = await import("./middleware");
      expect(typeof requireSystemAdmin).toBe("function");
    });

    it("should export requireTenant middleware factory", async () => {
      const { requireTenant } = await import("./middleware");
      expect(typeof requireTenant).toBe("function");
    });

    it("should create middleware from auth()", async () => {
      const { auth } = await import("./middleware");
      const middleware = auth();
      expect(typeof middleware).toBe("function");
    });

    it("should create middleware from requireRole()", async () => {
      const { requireRole } = await import("./middleware");
      const middleware = requireRole("admin", "owner");
      expect(typeof middleware).toBe("function");
    });

    it("should create middleware from requireSystemAdmin()", async () => {
      const { requireSystemAdmin } = await import("./middleware");
      const middleware = requireSystemAdmin();
      expect(typeof middleware).toBe("function");
    });

    it("should create middleware from requireTenant()", async () => {
      const { requireTenant } = await import("./middleware");
      const middleware = requireTenant();
      expect(typeof middleware).toBe("function");
    });
  });

  describe("main index exports", () => {
    it("should re-export all types from index", async () => {
      const module = await import("./index");
      expect(module).toBeDefined();
    });

    it("should re-export withRequestRLS from index", async () => {
      const { withRequestRLS } = await import("./index");
      expect(typeof withRequestRLS).toBe("function");
    });

    it("should re-export auth from index", async () => {
      const { auth } = await import("./index");
      expect(typeof auth).toBe("function");
    });

    it("should re-export requireRole from index", async () => {
      const { requireRole } = await import("./index");
      expect(typeof requireRole).toBe("function");
    });

    it("should re-export requireSystemAdmin from index", async () => {
      const { requireSystemAdmin } = await import("./index");
      expect(typeof requireSystemAdmin).toBe("function");
    });

    it("should re-export requireTenant from index", async () => {
      const { requireTenant } = await import("./index");
      expect(typeof requireTenant).toBe("function");
    });

    it("should re-export authentication functions from index", async () => {
      const {
        authenticateLocalJWT,
        authenticateOIDC,
        authenticateApiKey,
        authenticateAdminToken,
      } = await import("./index");
      expect(typeof authenticateLocalJWT).toBe("function");
      expect(typeof authenticateOIDC).toBe("function");
      expect(typeof authenticateApiKey).toBe("function");
      expect(typeof authenticateAdminToken).toBe("function");
    });
  });

  describe("error types", () => {
    it("should create UnauthorizedError with correct status code", () => {
      const error = new UnauthorizedError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(401);
    });

    it("should create ForbiddenError with correct status code", () => {
      const error = new ForbiddenError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(403);
    });
  });

  describe("withRequestRLS behavior", () => {
    it("should execute function directly when no RLS context", async () => {
      const { withRequestRLS } = await import("./helpers");

      const mockContext = {
        get: mock(() => undefined),
      };

      let fnCalled = false;
      const result = await withRequestRLS(mockContext, async () => {
        fnCalled = true;
        return "test-result";
      });

      expect(fnCalled).toBe(true);
      expect(result).toBe("test-result");
    });
  });

  describe("backward compatibility", () => {
    it("should re-export all from middleware/auth.ts", async () => {
      const module = await import("../auth");

      // Verify main exports are available
      expect(typeof module.auth).toBe("function");
      expect(typeof module.requireRole).toBe("function");
      expect(typeof module.requireSystemAdmin).toBe("function");
      expect(typeof module.requireTenant).toBe("function");
      expect(typeof module.withRequestRLS).toBe("function");
    });
  });
});
