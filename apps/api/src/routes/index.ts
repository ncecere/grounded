import { Hono } from "hono";

import { authRoutes } from "./auth";
import { tenantRoutes } from "./tenants";
import { kbRoutes } from "./knowledge-bases";
import { sourceRoutes } from "./sources";
import { agentRoutes } from "./agents";
import { chatRoutes } from "./chat";
import { widgetRoutes } from "./widget";
import { chatEndpointRoutes } from "./chat-endpoint";
import { analyticsRoutes } from "./analytics";
import { uploadRoutes } from "./uploads";
import { agentTestSuiteRoutes, testCaseRoutes, testSuiteRoutes, testRunRoutes, experimentRoutes } from "./test-suites";
import { adminSettingsRoutes } from "./admin/settings";
import { adminModelsRoutes } from "./admin/models";
import { adminUsersRoutes } from "./admin/users";
import { adminSharedKbsRoutes } from "./admin/shared-kbs";
import { adminDashboardRoutes } from "./admin/dashboard";
import { adminAnalyticsRoutes } from "./admin/analytics";
import { adminTokensRoutes } from "./admin/tokens";
import { adminAuditRoutes } from "./admin/audit";
import { toolRoutes } from "./tools";
import { internalWorkersRoutes } from "./internal/workers";

export const createV1Routes = () => {
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
  v1.route("/agents", agentTestSuiteRoutes);

  // Test suites
  v1.route("/test-suites", testSuiteRoutes);
  v1.route("/test-cases", testCaseRoutes);
  v1.route("/test-runs", testRunRoutes);
  v1.route("/experiments", experimentRoutes);

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

  // Internal routes (for workers to fetch configuration)
  v1.route("/internal/workers", internalWorkersRoutes);

  return v1;
};
