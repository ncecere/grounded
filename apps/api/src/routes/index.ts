import { Hono } from "hono";

import {
  adminAnalyticsRoutes,
  adminAuditRoutes,
  adminDashboardRoutes,
  adminModelsRoutes,
  adminSettingsRoutes,
  adminSharedKbsRoutes,
  adminTokensRoutes,
  adminUsersRoutes,
  agentRoutes,
  agentTestSuiteRoutes,
  analyticsRoutes,
  authRoutes,
  chatEndpointRoutes,
  chatRoutes,
  experimentRoutes,
  internalWorkersRoutes,
  kbRoutes,
  sourceRoutes,
  tenantRoutes,
  testCaseRoutes,
  testRunRoutes,
  testSuiteRoutes,
  toolRoutes,
  uploadRoutes,
  widgetRoutes,
} from "../modules";

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
