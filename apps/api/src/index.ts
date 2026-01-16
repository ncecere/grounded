import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { prettyJSON } from "hono/pretty-json";
import { getEnv, getEnvNumber } from "@grounded/shared";
import { initializeVectorStore, isVectorStoreConfigured } from "@grounded/vector-store";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { authRoutes } from "./routes/auth";
import { tenantRoutes } from "./routes/tenants";
import { kbRoutes } from "./routes/knowledge-bases";
import { sourceRoutes } from "./routes/sources";
import { agentRoutes } from "./routes/agents";
import { chatRoutes } from "./routes/chat";
import { widgetRoutes } from "./routes/widget";
import { chatEndpointRoutes } from "./routes/chat-endpoint";
import { analyticsRoutes } from "./routes/analytics";
import { uploadRoutes } from "./routes/uploads";
import { errorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";
import { adminSettingsRoutes } from "./routes/admin/settings";
import { adminModelsRoutes } from "./routes/admin/models";
import { adminUsersRoutes } from "./routes/admin/users";
import { adminSharedKbsRoutes } from "./routes/admin/shared-kbs";
import { adminDashboardRoutes } from "./routes/admin/dashboard";
import { adminAnalyticsRoutes } from "./routes/admin/analytics";
import { adminTokensRoutes } from "./routes/admin/tokens";
import { adminAuditRoutes } from "./routes/admin/audit";
import { toolRoutes } from "./routes/tools";
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
    // Initialize vector store (optional - may not be configured)
    if (isVectorStoreConfigured()) {
      await initializeVectorStore();
      console.log("[Startup] Vector store initialized successfully");
    } else {
      console.warn("[Startup] Vector store not configured. Set VECTOR_DB_URL or VECTOR_DB_HOST.");
    }
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

// Tools management
v1.route("/tools", toolRoutes);

// Chat
v1.route("/chat", chatRoutes);

// Widget (public endpoints)
v1.route("/widget", widgetRoutes);

// Chat Endpoints (public endpoints for published chat)
v1.route("/c", chatEndpointRoutes);

// Analytics
v1.route("/analytics", analyticsRoutes);

// Uploads
v1.route("/uploads", uploadRoutes);

// Admin routes (system admin only)
v1.route("/admin/dashboard", adminDashboardRoutes);
v1.route("/admin/settings", adminSettingsRoutes);
v1.route("/admin/models", adminModelsRoutes);
v1.route("/admin/users", adminUsersRoutes);
v1.route("/admin/shared-kbs", adminSharedKbsRoutes);
v1.route("/admin/analytics", adminAnalyticsRoutes);
v1.route("/admin/tokens", adminTokensRoutes);
v1.route("/admin/audit", adminAuditRoutes);

// Mount v1 routes
app.route("/api/v1", v1);

// ============================================================================
// Hosted Chat Page (top-level for nicer URLs)
// ============================================================================

// Redirect /chat/:token to /api/v1/c/:token for the hosted chat page
app.get("/chat/:token", async (c) => {
  const token = c.req.param("token");
  // Forward to the chat endpoint route
  return c.redirect(`/api/v1/c/${token}`);
});

// Serve published-chat.js for hosted chat pages
// Cache the JS content in memory (loaded on first request)
let publishedChatJsCache: string | null = null;

app.get("/published-chat.js", (c) => {
  if (!publishedChatJsCache) {
    // Try multiple paths:
    // - Docker/production: /app/packages/widget/dist/published-chat.js
    // - Local dev from project root: packages/widget/dist/published-chat.js
    // - Local dev from apps/api: ../../packages/widget/dist/published-chat.js
    const paths = [
      join(process.cwd(), "packages/widget/dist/published-chat.js"),
      join(process.cwd(), "../../packages/widget/dist/published-chat.js"),
    ];
    
    for (const path of paths) {
      if (existsSync(path)) {
        publishedChatJsCache = readFileSync(path, "utf-8");
        break;
      }
    }
    
    if (!publishedChatJsCache) {
      return c.text("// Published chat JS not found", 404);
    }
  }
  
  c.header("Content-Type", "application/javascript");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(publishedChatJsCache);
});

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
