import { describe, it, expect } from "bun:test";

// Test module structure and exports
describe("api module structure", () => {
  describe("client exports", () => {
    it("should export API_BASE", async () => {
      // Note: This will fail in test env since window is not defined,
      // but we're testing that the export exists
      const { API_BASE } = await import("./client");
      expect(typeof API_BASE).toBe("string");
    });

    it("should export token management functions", async () => {
      const { getToken, setToken, clearToken } = await import("./client");
      expect(typeof getToken).toBe("function");
      expect(typeof setToken).toBe("function");
      expect(typeof clearToken).toBe("function");
    });

    it("should export tenant context functions", async () => {
      const { getCurrentTenantId, setCurrentTenantId, clearCurrentTenantId } = await import("./client");
      expect(typeof getCurrentTenantId).toBe("function");
      expect(typeof setCurrentTenantId).toBe("function");
      expect(typeof clearCurrentTenantId).toBe("function");
    });

    it("should export request function", async () => {
      const { request } = await import("./client");
      expect(typeof request).toBe("function");
    });
  });

  describe("domain API exports", () => {
    it("should export authApi", async () => {
      const { authApi } = await import("./auth");
      expect(authApi).toBeDefined();
      expect(typeof authApi.getMe).toBe("function");
      expect(typeof authApi.login).toBe("function");
      expect(typeof authApi.logout).toBe("function");
      expect(typeof authApi.register).toBe("function");
      expect(typeof authApi.getMyTenants).toBe("function");
    });

    it("should export tenantsApi", async () => {
      const { tenantsApi } = await import("./tenants");
      expect(tenantsApi).toBeDefined();
      expect(typeof tenantsApi.listAllTenants).toBe("function");
      expect(typeof tenantsApi.createTenant).toBe("function");
      expect(typeof tenantsApi.getTenant).toBe("function");
      expect(typeof tenantsApi.updateTenant).toBe("function");
      expect(typeof tenantsApi.deleteTenant).toBe("function");
      expect(typeof tenantsApi.listTenantMembers).toBe("function");
      expect(typeof tenantsApi.addTenantMember).toBe("function");
      expect(typeof tenantsApi.getTenantAlertSettings).toBe("function");
    });

    it("should export knowledgeBasesApi", async () => {
      const { knowledgeBasesApi } = await import("./knowledge-bases");
      expect(knowledgeBasesApi).toBeDefined();
      expect(typeof knowledgeBasesApi.listKnowledgeBases).toBe("function");
      expect(typeof knowledgeBasesApi.getKnowledgeBase).toBe("function");
      expect(typeof knowledgeBasesApi.createKnowledgeBase).toBe("function");
      expect(typeof knowledgeBasesApi.updateKnowledgeBase).toBe("function");
      expect(typeof knowledgeBasesApi.deleteKnowledgeBase).toBe("function");
      expect(typeof knowledgeBasesApi.reindexKnowledgeBase).toBe("function");
    });

    it("should export sourcesApi", async () => {
      const { sourcesApi } = await import("./sources");
      expect(sourcesApi).toBeDefined();
      expect(typeof sourcesApi.listSources).toBe("function");
      expect(typeof sourcesApi.getSource).toBe("function");
      expect(typeof sourcesApi.createSource).toBe("function");
      expect(typeof sourcesApi.updateSource).toBe("function");
      expect(typeof sourcesApi.deleteSource).toBe("function");
      expect(typeof sourcesApi.triggerSourceRun).toBe("function");
      expect(typeof sourcesApi.uploadFile).toBe("function");
    });

    it("should export agentsApi", async () => {
      const { agentsApi } = await import("./agents");
      expect(agentsApi).toBeDefined();
      expect(typeof agentsApi.listAgents).toBe("function");
      expect(typeof agentsApi.getAgent).toBe("function");
      expect(typeof agentsApi.createAgent).toBe("function");
      expect(typeof agentsApi.updateAgent).toBe("function");
      expect(typeof agentsApi.deleteAgent).toBe("function");
      expect(typeof agentsApi.getWidgetConfig).toBe("function");
      expect(typeof agentsApi.updateWidgetConfig).toBe("function");
    });

    it("should export chatApi", async () => {
      const { chatApi } = await import("./chat");
      expect(chatApi).toBeDefined();
      expect(typeof chatApi.chat).toBe("function");
      expect(typeof chatApi.simpleChatStream).toBe("function");
      expect(typeof chatApi.advancedChatStream).toBe("function");
    });

    it("should export toolsApi", async () => {
      const { toolsApi } = await import("./tools");
      expect(toolsApi).toBeDefined();
      expect(typeof toolsApi.listTools).toBe("function");
      expect(typeof toolsApi.getTool).toBe("function");
      expect(typeof toolsApi.createTool).toBe("function");
      expect(typeof toolsApi.updateTool).toBe("function");
      expect(typeof toolsApi.deleteTool).toBe("function");
      expect(typeof toolsApi.listAgentTools).toBe("function");
    });

    it("should export analyticsApi", async () => {
      const { analyticsApi } = await import("./analytics");
      expect(analyticsApi).toBeDefined();
      expect(typeof analyticsApi.getAnalytics).toBe("function");
    });

    it("should export testSuitesApi", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(testSuitesApi).toBeDefined();
      expect(typeof testSuitesApi.listTestSuites).toBe("function");
      expect(typeof testSuitesApi.createTestSuite).toBe("function");
      expect(typeof testSuitesApi.listTestCases).toBe("function");
      expect(typeof testSuitesApi.listTestRuns).toBe("function");
    });

    it("should export adminApi", async () => {
      const { adminApi } = await import("./admin");
      expect(adminApi).toBeDefined();
      expect(typeof adminApi.getAdminSettings).toBe("function");
      expect(typeof adminApi.listProviders).toBe("function");
      expect(typeof adminApi.listModels).toBe("function");
      expect(typeof adminApi.listUsers).toBe("function");
      expect(typeof adminApi.listSharedKbs).toBe("function");
      expect(typeof adminApi.getDashboardHealth).toBe("function");
      expect(typeof adminApi.listAuditLogs).toBe("function");
    });
  });

  describe("unified api object", () => {
    it("should export api with all methods", async () => {
      const { api } = await import("./index");
      expect(api).toBeDefined();

      // Auth methods
      expect(typeof api.getMe).toBe("function");
      expect(typeof api.login).toBe("function");
      expect(typeof api.logout).toBe("function");
      expect(typeof api.register).toBe("function");

      // Tenant methods
      expect(typeof api.listAllTenants).toBe("function");
      expect(typeof api.createTenant).toBe("function");
      expect(typeof api.getTenantAlertSettings).toBe("function");

      // KB methods
      expect(typeof api.listKnowledgeBases).toBe("function");
      expect(typeof api.createKnowledgeBase).toBe("function");

      // Source methods
      expect(typeof api.listSources).toBe("function");
      expect(typeof api.uploadFile).toBe("function");

      // Agent methods
      expect(typeof api.listAgents).toBe("function");
      expect(typeof api.createAgent).toBe("function");

      // Chat methods
      expect(typeof api.chat).toBe("function");
      expect(typeof api.simpleChatStream).toBe("function");
      expect(typeof api.advancedChatStream).toBe("function");

      // Tool methods
      expect(typeof api.listTools).toBe("function");
      expect(typeof api.listAgentTools).toBe("function");

      // Test suite methods
      expect(typeof api.listTestSuites).toBe("function");
      expect(typeof api.createTestSuite).toBe("function");
      expect(typeof api.listTestCases).toBe("function");
      expect(typeof api.listTestRuns).toBe("function");

      // Admin methods
      expect(typeof api.getAdminSettings).toBe("function");
      expect(typeof api.listProviders).toBe("function");
      expect(typeof api.listAuditLogs).toBe("function");
    });
  });

  describe("backward compatibility", () => {
    it("should re-export everything from main api.ts", async () => {
      const mainApi = await import("../api");
      const indexApi = await import("./index");

      // Verify unified api object is available
      expect(mainApi.api).toBeDefined();
      expect(indexApi.api).toBeDefined();

      // Verify client exports
      expect(typeof mainApi.getToken).toBe("function");
      expect(typeof mainApi.setToken).toBe("function");
      expect(typeof mainApi.getCurrentTenantId).toBe("function");

      // Verify domain APIs are exported
      expect(mainApi.authApi).toBeDefined();
      expect(mainApi.tenantsApi).toBeDefined();
      expect(mainApi.knowledgeBasesApi).toBeDefined();
      expect(mainApi.sourcesApi).toBeDefined();
      expect(mainApi.agentsApi).toBeDefined();
      expect(mainApi.chatApi).toBeDefined();
      expect(mainApi.toolsApi).toBeDefined();
      expect(mainApi.analyticsApi).toBeDefined();
      expect(mainApi.testSuitesApi).toBeDefined();
      expect(mainApi.adminApi).toBeDefined();
    });
  });
});

describe("type exports", () => {
  it("should export User type", async () => {
    const types = await import("./types");
    // Type-only test: we can't test types at runtime, but we can verify the module loads
    expect(types).toBeDefined();
  });
});
