import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { prettyJSON } from "hono/pretty-json";
import { getEnv } from "@grounded/shared";
import { wideEventMiddleware } from "@grounded/logger/middleware";

import { errorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";
import { createV1Routes } from "./routes";
import { hostedChatRoutes } from "./routes/hosted-chat";

export const createApiApp = () => {
  const app = new Hono();
  const maxJsonBodyBytes = Number(getEnv("MAX_JSON_BODY_BYTES", "65536"));
  const maxPublicChatBodyBytes = Number(getEnv("MAX_PUBLIC_CHAT_BODY_BYTES", "65536"));
  const maxUploadBodyBytes = Number(getEnv("MAX_UPLOAD_BODY_BYTES", "15728640"));

  // ==========================================================================
  // Global Middleware
  // ==========================================================================

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use("*", prettyJSON());
  const corsOrigins = getEnv("CORS_ORIGINS", "http://localhost:8088,http://localhost:5173");
  if (process.env.NODE_ENV === "production" && (corsOrigins === "*" || !process.env.CORS_ORIGINS)) {
    throw new Error("CORS_ORIGINS must be explicitly set in production (not wildcard)");
  }
  app.use(
    "*",
    cors({
      origin: corsOrigins.split(",").map((o) => o.trim()),
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Tenant-ID"],
      exposeHeaders: ["X-Request-ID", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    })
  );

  app.use("*", async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (!["POST", "PUT", "PATCH"].includes(method)) {
      return next();
    }

    const rawContentLength = c.req.header("content-length");
    if (!rawContentLength) {
      return next();
    }

    const contentLength = Number(rawContentLength);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return c.json(
        {
          error: "BAD_REQUEST",
          message: "Invalid Content-Length header",
        },
        400
      );
    }

    const contentType = (c.req.header("content-type") || "").toLowerCase();
    let maxBytes = contentType.includes("multipart/form-data") ? maxUploadBodyBytes : maxJsonBodyBytes;

    if (c.req.path.startsWith("/api/v1/widget/") || c.req.path.startsWith("/api/v1/c/")) {
      maxBytes = Math.min(maxBytes, maxPublicChatBodyBytes);
    }

    if (contentLength > maxBytes) {
      return c.json(
        {
          error: "PAYLOAD_TOO_LARGE",
          message: `Request body exceeds ${maxBytes} bytes`,
        },
        413
      );
    }

    return next();
  });

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

  app.route("/", hostedChatRoutes);

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
