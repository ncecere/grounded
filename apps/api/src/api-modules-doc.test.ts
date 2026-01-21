import { describe, expect, it } from "bun:test";
import { readFile, access } from "fs/promises";
import { join } from "path";

const apiModulesDocPath = join(
  import.meta.dir,
  "../../../docs/refactor/api-modules.md"
);

const modulesIndexPath = join(import.meta.dir, "./modules/index.ts");
const appPath = join(import.meta.dir, "./app.ts");
const routesIndexPath = join(import.meta.dir, "./routes/index.ts");
const startupIndexPath = join(import.meta.dir, "./startup/index.ts");

describe("api modules doc", () => {
  it("exists at the expected path", async () => {
    // access() resolves to undefined/null on success, throws on failure
    const result = await access(apiModulesDocPath);
    expect(result === undefined || result === null).toBe(true);
  });

  it("has the required structure sections", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    expect(content).toContain("# API Module Map");
    expect(content).toContain("## Purpose");
    expect(content).toContain("## Module Structure Overview");
    expect(content).toContain("## Domain Modules");
    expect(content).toContain("## Import Rules");
    expect(content).toContain("## App Assembly");
    expect(content).toContain("## Middleware Order");
    expect(content).toContain("## Route Mount Map");
    expect(content).toContain("## Module Exports");
    expect(content).toContain("## Related Documentation");
  });

  it("documents all domain modules", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    // Core modules
    expect(content).toContain("| `auth`");
    expect(content).toContain("| `tenants`");
    expect(content).toContain("| `knowledge-bases`");
    expect(content).toContain("| `sources`");
    expect(content).toContain("| `agents`");
    expect(content).toContain("| `chat`");
    expect(content).toContain("| `widget`");
    expect(content).toContain("| `analytics`");
    expect(content).toContain("| `uploads`");
    expect(content).toContain("| `tools`");
    expect(content).toContain("| `test-suites`");
    expect(content).toContain("| `admin`");
    expect(content).toContain("| `internal`");
    expect(content).toContain("| `hosted-chat`");
    expect(content).toContain("| `chat-endpoint`");
  });

  it("documents module file template", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    expect(content).toContain("routes.ts");
    expect(content).toContain("schema.ts");
    expect(content).toContain("service.ts");
    expect(content).toContain("repo.ts");
    expect(content).toContain("types.ts");
  });

  it("documents import rules", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    expect(content).toContain("### Allowed Import Directions");
    expect(content).toContain("routes.ts  -->  schema.ts, service.ts");
    expect(content).toContain("service.ts -->  repo.ts, schema.ts");
    expect(content).toContain("repo.ts    -->  DB clients");
    expect(content).toContain("### Cross-Module Access Rules");
    expect(content).toContain("### Service/Repo Transaction Patterns");
  });

  it("documents app assembly components", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    expect(content).toContain("apps/api/src/index.ts");
    expect(content).toContain("apps/api/src/app.ts");
    expect(content).toContain("apps/api/src/routes/index.ts");
    expect(content).toContain("apps/api/src/startup/index.ts");
  });

  it("documents middleware order", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    expect(content).toContain("requestId()");
    expect(content).toContain("secureHeaders()");
    expect(content).toContain("prettyJSON()");
    expect(content).toContain("cors()");
    expect(content).toContain("wideEventMiddleware()");
    expect(content).toContain("errorHandler");
    expect(content).toContain("notFound()");
  });

  it("documents route mount paths", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    // Public routes
    expect(content).toContain("/api/v1/auth");
    expect(content).toContain("/api/v1/widget");
    expect(content).toContain("/api/v1/c");

    // Tenant routes
    expect(content).toContain("/api/v1/tenants");
    expect(content).toContain("/api/v1/knowledge-bases");
    expect(content).toContain("/api/v1/sources");
    expect(content).toContain("/api/v1/agents");
    expect(content).toContain("/api/v1/chat");
    expect(content).toContain("/api/v1/analytics");
    expect(content).toContain("/api/v1/uploads");
    expect(content).toContain("/api/v1/tools");

    // Admin routes
    expect(content).toContain("/api/v1/admin/dashboard");
    expect(content).toContain("/api/v1/admin/settings");
    expect(content).toContain("/api/v1/admin/models");
    expect(content).toContain("/api/v1/admin/users");

    // Internal routes
    expect(content).toContain("/api/v1/internal/workers");
  });

  it("documents route aliases", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    expect(content).toContain("### Route Aliases");
    expect(content).toContain("/api/v1/global-knowledge-bases");
    expect(content).toContain("GET /chat/:token");
    expect(content).toContain("/api/v1/c/:token");
  });

  it("links to related documentation", async () => {
    const content = await readFile(apiModulesDocPath, "utf-8");

    expect(content).toContain("docs/refactor/baseline.md");
    expect(content).toContain("docs/refactor/dependencies.md");
    expect(content).toContain("docs/refactor/test-matrix.md");
    expect(content).toContain("docs/refactor/migration-log.md");
    expect(content).toContain("tasks/phase-1-api-structure.md");
  });
});

describe("api modules doc accuracy", () => {
  it("matches modules barrel export routes", async () => {
    const docContent = await readFile(apiModulesDocPath, "utf-8");
    const modulesContent = await readFile(modulesIndexPath, "utf-8");

    // Verify key route exports mentioned in doc exist in actual barrel
    const routeExports = [
      "authRoutes",
      "tenantRoutes",
      "kbRoutes",
      "sourceRoutes",
      "agentRoutes",
      "chatRoutes",
      "widgetRoutes",
      "chatEndpointRoutes",
      "analyticsRoutes",
      "uploadRoutes",
      "toolRoutes",
      "internalWorkersRoutes",
    ];

    for (const route of routeExports) {
      expect(modulesContent).toContain(route);
      expect(docContent).toContain(route);
    }
  });

  it("matches middleware in app.ts", async () => {
    const docContent = await readFile(apiModulesDocPath, "utf-8");
    const appContent = await readFile(appPath, "utf-8");

    // Verify middleware mentioned in doc exists in app.ts
    expect(appContent).toContain("requestId()");
    expect(appContent).toContain("secureHeaders()");
    expect(appContent).toContain("prettyJSON()");
    expect(appContent).toContain("cors(");
    expect(appContent).toContain("wideEventMiddleware(");
    expect(appContent).toContain("errorHandler");
    expect(appContent).toContain("notFound");

    // Doc should reflect these
    expect(docContent).toContain("requestId()");
    expect(docContent).toContain("secureHeaders()");
    expect(docContent).toContain("prettyJSON()");
    expect(docContent).toContain("cors()");
    expect(docContent).toContain("wideEventMiddleware()");
  });

  it("matches route mounts in routes/index.ts", async () => {
    const docContent = await readFile(apiModulesDocPath, "utf-8");
    const routesContent = await readFile(routesIndexPath, "utf-8");

    // Verify key route mounts mentioned in doc exist in routes/index.ts
    const routeMounts = [
      '"/auth"',
      '"/tenants"',
      '"/knowledge-bases"',
      '"/sources"',
      '"/agents"',
      '"/chat"',
      '"/widget"',
      '"/analytics"',
      '"/uploads"',
      '"/tools"',
      '"/admin/dashboard"',
      '"/admin/settings"',
      '"/internal/workers"',
    ];

    for (const mount of routeMounts) {
      expect(routesContent).toContain(mount);
    }

    // Doc should reflect these paths
    expect(docContent).toContain("/api/v1/auth");
    expect(docContent).toContain("/api/v1/tenants");
    expect(docContent).toContain("/api/v1/knowledge-bases");
  });

  it("matches startup module exports", async () => {
    const docContent = await readFile(apiModulesDocPath, "utf-8");
    const startupContent = await readFile(startupIndexPath, "utf-8");

    // Doc mentions startup handles these
    expect(docContent).toContain("migrations");
    expect(docContent).toContain("seeding");
    expect(docContent).toContain("shutdown");

    // Startup should have these functions
    expect(startupContent).toContain("runMigrations");
    expect(startupContent).toContain("seedSystemAdmin");
    expect(startupContent).toContain("stopStartupTasks");
    expect(startupContent).toContain("registerShutdownHandlers");
  });
});
