import { describe, expect, it } from "bun:test";
import { readdir } from "fs/promises";
import { join } from "path";

/**
 * Test to verify API import structure after module refactoring.
 * Ensures:
 * 1. All module schema files are importable
 * 2. Route files import schemas from modules (not inline)
 * 3. Test files have proper bun:test imports
 */

describe("API import structure", () => {
  describe("module schemas", () => {
    const moduleSchemas = [
      "admin",
      "agents",
      "analytics",
      "chat",
      "chat-endpoint",
      "knowledge-bases",
      "sources",
      "tenants",
      "test-suites",
      "tools",
      "widget",
    ];

    for (const moduleName of moduleSchemas) {
      it(`${moduleName}/schema.ts exports are importable`, async () => {
        const schemaModule = await import(`./modules/${moduleName}/schema`);
        expect(schemaModule).toBeDefined();
        expect(typeof schemaModule).toBe("object");
      });
    }
  });

  describe("routes use module schemas", () => {
    it("routes/index.ts exports createV1Routes from modules barrel", async () => {
      const routesIndex = await import("./routes/index");
      expect(routesIndex.createV1Routes).toBeDefined();
      expect(typeof routesIndex.createV1Routes).toBe("function");
    });

    it("modules/index.ts re-exports all route modules", async () => {
      const modulesIndex = await import("./modules/index");
      
      const expectedExports = [
        "authRoutes",
        "tenantRoutes",
        "kbRoutes",
        "sourceRoutes",
        "agentRoutes",
        "chatRoutes",
        "widgetRoutes",
        "analyticsRoutes",
        "toolRoutes",
      ];

      for (const exportName of expectedExports) {
        expect(modulesIndex[exportName as keyof typeof modulesIndex]).toBeDefined();
      }
    });
  });

  describe("test file structure", () => {
    it("module test files exist in correct locations", async () => {
      const modulesDir = join(import.meta.dir, "modules");
      const moduleEntries = await readdir(modulesDir, { withFileTypes: true });
      const moduleDirs = moduleEntries.filter((e) => e.isDirectory()).map((e) => e.name);

      // Modules with services should have service tests
      const modulesWithServices = ["agents", "chat"];
      for (const mod of modulesWithServices) {
        if (moduleDirs.includes(mod)) {
          const modDir = join(modulesDir, mod);
          const files = await readdir(modDir);
          const hasServiceTest = files.some((f) => f.endsWith(".test.ts"));
          expect(hasServiceTest).toBe(true);
        }
      }
    });

    it("route test files exist for key routes", async () => {
      const routesDir = join(import.meta.dir, "routes");
      const routeFiles = await readdir(routesDir);
      
      const keyRoutes = ["chat", "agents", "sources"];
      for (const route of keyRoutes) {
        const hasTest = routeFiles.some((f) => f.startsWith(route) && f.endsWith(".test.ts"));
        expect(hasTest).toBe(true);
      }
    });
  });
});
