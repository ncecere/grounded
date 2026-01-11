import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { prettyJSON } from "hono/pretty-json";
import { getEnv, getEnvNumber } from "@kcb/shared";

import { authRoutes } from "./routes/auth";
import { tenantRoutes } from "./routes/tenants";
import { kbRoutes } from "./routes/knowledge-bases";
import { sourceRoutes } from "./routes/sources";
import { agentRoutes } from "./routes/agents";
import { chatRoutes } from "./routes/chat";
import { widgetRoutes } from "./routes/widget";
import { analyticsRoutes } from "./routes/analytics";
import { uploadRoutes } from "./routes/uploads";
import { errorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";
import { adminSettingsRoutes } from "./routes/admin/settings";
import { adminModelsRoutes } from "./routes/admin/models";
import { adminUsersRoutes } from "./routes/admin/users";
import { runMigrations } from "./startup/run-migrations";
import { seedSystemAdmin } from "./startup/seed-admin";

const app = new Hono();

// Run startup tasks
(async () => {
  try {
    // Run database migrations first
    await runMigrations();
    // Then seed admin user
    await seedSystemAdmin();
  } catch (error) {
    console.error("[Startup] Startup tasks failed:", error);
  }
})();

// ============================================================================
// Global Middleware
// ============================================================================

app.use("*", requestId());
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: getEnv("CORS_ORIGINS", "*").split(","),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Tenant-ID"],
    exposeHeaders: ["X-Request-ID", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
  })
);

// ============================================================================
// Health Check
// ============================================================================

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

// ============================================================================
// API Routes (v1)
// ============================================================================

const v1 = new Hono();

// Auth routes
v1.route("/auth", authRoutes);

// Tenant management
v1.route("/tenants", tenantRoutes);

// Knowledge base management
v1.route("/knowledge-bases", kbRoutes);
v1.route("/global-knowledge-bases", kbRoutes); // Global KB routes share the same router

// Source management
v1.route("/sources", sourceRoutes);

// Agent management
v1.route("/agents", agentRoutes);

// Chat
v1.route("/chat", chatRoutes);

// Widget (public endpoints)
v1.route("/widget", widgetRoutes);

// Analytics
v1.route("/analytics", analyticsRoutes);

// Uploads
v1.route("/uploads", uploadRoutes);

// Admin routes (system admin only)
v1.route("/admin/settings", adminSettingsRoutes);
v1.route("/admin/models", adminModelsRoutes);
v1.route("/admin/users", adminUsersRoutes);

// Mount v1 routes
app.route("/api/v1", v1);

// ============================================================================
// Error Handler
// ============================================================================

app.onError(errorHandler);

// ============================================================================
// 404 Handler
// ============================================================================

app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404
  );
});

// ============================================================================
// Start Server
// ============================================================================

const port = getEnvNumber("PORT", 3000);

console.log(`Starting API server on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
