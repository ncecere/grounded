import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { prettyJSON } from "hono/pretty-json";
import { getEnv } from "@grounded/shared";
import { wideEventMiddleware } from "@grounded/logger/middleware";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { errorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";
import { createV1Routes } from "./routes";

export const createApiApp = () => {
  const app = new Hono();

  // ==========================================================================
  // Global Middleware
  // ==========================================================================

  app.use("*", requestId());
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

  // Wide event logging middleware - logs comprehensive request info
  app.use(
    "*",
    wideEventMiddleware({
      service: "api",
      skipPaths: ["/health"], // Skip health checks
      sampling: {
        baseSampleRate: 1.0, // Log 100% for now, can reduce later
        alwaysLogErrors: true,
        slowRequestThresholdMs: 2000,
      },
      // Extract tenant/user from auth context if available
      getTenant: (c) => {
        const auth = c.get("auth");
        if (auth?.tenantId) {
          return { id: auth.tenantId };
        }
        return undefined;
      },
      getUser: (c) => {
        const auth = c.get("auth");
        if (auth?.user) {
          return {
            id: auth.user.id,
            email: auth.user.email || undefined,
            role: auth.role || undefined,
          };
        }
        return undefined;
      },
    })
  );

  // ==========================================================================
  // Health Check
  // ==========================================================================

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    });
  });

  // ==========================================================================
  // API Routes (v1)
  // ==========================================================================

  const v1 = createV1Routes();

  // Mount v1 routes
  app.route("/api/v1", v1);

  // ==========================================================================
  // Hosted Chat Page (top-level for nicer URLs)
  // ==========================================================================

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

  // ==========================================================================
  // Error Handler
  // ==========================================================================

  app.onError(errorHandler);

  // ==========================================================================
  // 404 Handler
  // ==========================================================================

  app.notFound((c) => {
    return c.json(
      {
        error: "Not Found",
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      404
    );
  });

  return app;
};
