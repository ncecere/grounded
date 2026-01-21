import { describe, expect, it } from "bun:test";

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
} from "./index";
import { adminAnalyticsRoutes as directAdminAnalyticsRoutes } from "../routes/admin/analytics";
import { adminAuditRoutes as directAdminAuditRoutes } from "../routes/admin/audit";
import { adminDashboardRoutes as directAdminDashboardRoutes } from "../routes/admin/dashboard";
import { adminModelsRoutes as directAdminModelsRoutes } from "../routes/admin/models";
import { adminSettingsRoutes as directAdminSettingsRoutes } from "../routes/admin/settings";
import { adminSharedKbsRoutes as directAdminSharedKbsRoutes } from "../routes/admin/shared-kbs";
import { adminTokensRoutes as directAdminTokensRoutes } from "../routes/admin/tokens";
import { adminUsersRoutes as directAdminUsersRoutes } from "../routes/admin/users";
import { agentRoutes as directAgentRoutes } from "../routes/agents";
import { analyticsRoutes as directAnalyticsRoutes } from "../routes/analytics";
import { authRoutes as directAuthRoutes } from "../routes/auth";
import { chatEndpointRoutes as directChatEndpointRoutes } from "../routes/chat-endpoint";
import { chatRoutes as directChatRoutes } from "../routes/chat";
import { internalWorkersRoutes as directInternalWorkersRoutes } from "../routes/internal/workers";
import { kbRoutes as directKbRoutes } from "../routes/knowledge-bases";
import { sourceRoutes as directSourceRoutes } from "../routes/sources";
import { tenantRoutes as directTenantRoutes } from "../routes/tenants";
import {
  agentTestSuiteRoutes as directAgentTestSuiteRoutes,
  experimentRoutes as directExperimentRoutes,
  testCaseRoutes as directTestCaseRoutes,
  testRunRoutes as directTestRunRoutes,
  testSuiteRoutes as directTestSuiteRoutes,
} from "../routes/test-suites";
import { toolRoutes as directToolRoutes } from "../routes/tools";
import { uploadRoutes as directUploadRoutes } from "../routes/uploads";
import { widgetRoutes as directWidgetRoutes } from "../routes/widget";

describe("modules index", () => {
  it("re-exports route modules", () => {
    const cases = [
      ["authRoutes", authRoutes, directAuthRoutes],
      ["tenantRoutes", tenantRoutes, directTenantRoutes],
      ["kbRoutes", kbRoutes, directKbRoutes],
      ["sourceRoutes", sourceRoutes, directSourceRoutes],
      ["agentRoutes", agentRoutes, directAgentRoutes],
      ["chatRoutes", chatRoutes, directChatRoutes],
      ["widgetRoutes", widgetRoutes, directWidgetRoutes],
      ["chatEndpointRoutes", chatEndpointRoutes, directChatEndpointRoutes],
      ["analyticsRoutes", analyticsRoutes, directAnalyticsRoutes],
      ["uploadRoutes", uploadRoutes, directUploadRoutes],
      ["agentTestSuiteRoutes", agentTestSuiteRoutes, directAgentTestSuiteRoutes],
      ["testSuiteRoutes", testSuiteRoutes, directTestSuiteRoutes],
      ["testCaseRoutes", testCaseRoutes, directTestCaseRoutes],
      ["testRunRoutes", testRunRoutes, directTestRunRoutes],
      ["experimentRoutes", experimentRoutes, directExperimentRoutes],
      ["adminSettingsRoutes", adminSettingsRoutes, directAdminSettingsRoutes],
      ["adminModelsRoutes", adminModelsRoutes, directAdminModelsRoutes],
      ["adminUsersRoutes", adminUsersRoutes, directAdminUsersRoutes],
      ["adminSharedKbsRoutes", adminSharedKbsRoutes, directAdminSharedKbsRoutes],
      ["adminDashboardRoutes", adminDashboardRoutes, directAdminDashboardRoutes],
      ["adminAnalyticsRoutes", adminAnalyticsRoutes, directAdminAnalyticsRoutes],
      ["adminTokensRoutes", adminTokensRoutes, directAdminTokensRoutes],
      ["adminAuditRoutes", adminAuditRoutes, directAdminAuditRoutes],
      ["toolRoutes", toolRoutes, directToolRoutes],
      ["internalWorkersRoutes", internalWorkersRoutes, directInternalWorkersRoutes],
    ];

    for (const [, barrel, direct] of cases) {
      expect(barrel).toBe(direct);
    }
  });
});
