// Re-export client utilities
export {
  API_BASE,
  getToken,
  setToken,
  clearToken,
  getCurrentTenantId,
  setCurrentTenantId,
  clearCurrentTenantId,
  request,
} from "./client";

// Re-export all types
export * from "./types";

// Import domain APIs
import { authApi } from "./auth";
import { tenantsApi } from "./tenants";
import { knowledgeBasesApi } from "./knowledge-bases";
import { sourcesApi } from "./sources";
import { agentsApi } from "./agents";
import { chatApi } from "./chat";
import { toolsApi } from "./tools";
import { analyticsApi } from "./analytics";
import { adminApi } from "./admin";

// Unified API object for backward compatibility
export const api = {
  // Auth
  getMe: authApi.getMe,
  logout: authApi.logout,
  login: authApi.login,
  register: authApi.register,
  getMyTenants: authApi.getMyTenants,

  // Tenants
  listAllTenants: tenantsApi.listAllTenants,
  createTenant: tenantsApi.createTenant,
  getTenant: tenantsApi.getTenant,
  updateTenant: tenantsApi.updateTenant,
  deleteTenant: tenantsApi.deleteTenant,
  listTenantMembers: tenantsApi.listTenantMembers,
  addTenantMember: tenantsApi.addTenantMember,
  updateTenantMember: tenantsApi.updateTenantMember,
  removeTenantMember: tenantsApi.removeTenantMember,
  getTenantAlertSettings: tenantsApi.getTenantAlertSettings,
  updateTenantAlertSettings: tenantsApi.updateTenantAlertSettings,
  listTenantApiKeys: tenantsApi.listTenantApiKeys,
  createTenantApiKey: tenantsApi.createTenantApiKey,
  revokeTenantApiKey: tenantsApi.revokeTenantApiKey,

  // Knowledge Bases
  listKnowledgeBases: knowledgeBasesApi.listKnowledgeBases,
  getKnowledgeBase: knowledgeBasesApi.getKnowledgeBase,
  createKnowledgeBase: knowledgeBasesApi.createKnowledgeBase,
  updateKnowledgeBase: knowledgeBasesApi.updateKnowledgeBase,
  deleteKnowledgeBase: knowledgeBasesApi.deleteKnowledgeBase,
  reindexKnowledgeBase: knowledgeBasesApi.reindexKnowledgeBase,
  cancelKbReindex: knowledgeBasesApi.cancelKbReindex,

  // Sources
  listSources: sourcesApi.listSources,
  getSource: sourcesApi.getSource,
  createSource: sourcesApi.createSource,
  updateSource: sourcesApi.updateSource,
  deleteSource: sourcesApi.deleteSource,
  triggerSourceRun: sourcesApi.triggerSourceRun,
  listSourceRuns: sourcesApi.listSourceRuns,
  getSourceStats: sourcesApi.getSourceStats,
  uploadFile: sourcesApi.uploadFile,

  // Agents
  listAgents: agentsApi.listAgents,
  listLLMModels: agentsApi.listLLMModels,
  getAgent: agentsApi.getAgent,
  createAgent: agentsApi.createAgent,
  updateAgent: agentsApi.updateAgent,
  deleteAgent: agentsApi.deleteAgent,
  getWidgetToken: agentsApi.getWidgetToken,
  getWidgetConfig: agentsApi.getWidgetConfig,
  updateWidgetConfig: agentsApi.updateWidgetConfig,
  getRetrievalConfig: agentsApi.getRetrievalConfig,
  updateRetrievalConfig: agentsApi.updateRetrievalConfig,
  listChatEndpoints: agentsApi.listChatEndpoints,
  createChatEndpoint: agentsApi.createChatEndpoint,
  deleteChatEndpoint: agentsApi.deleteChatEndpoint,

  // Chat
  chat: chatApi.chat,
  simpleChatStream: chatApi.simpleChatStream,
  advancedChatStream: chatApi.advancedChatStream,

  // Tools
  listTools: toolsApi.listTools,
  getTool: toolsApi.getTool,
  createTool: toolsApi.createTool,
  updateTool: toolsApi.updateTool,
  deleteTool: toolsApi.deleteTool,
  listBuiltinTools: toolsApi.listBuiltinTools,
  listAgentTools: toolsApi.listAgentTools,
  attachToolToAgent: toolsApi.attachToolToAgent,
  detachToolFromAgent: toolsApi.detachToolFromAgent,

  // Analytics
  getAnalytics: analyticsApi.getAnalytics,

  // Admin Settings
  getAdminSettings: adminApi.getAdminSettings,
  getAdminSetting: adminApi.getAdminSetting,
  updateAdminSetting: adminApi.updateAdminSetting,
  bulkUpdateAdminSettings: adminApi.bulkUpdateAdminSettings,

  // Admin Model Providers
  listProviders: adminApi.listProviders,
  getProvider: adminApi.getProvider,
  createProvider: adminApi.createProvider,
  updateProvider: adminApi.updateProvider,
  deleteProvider: adminApi.deleteProvider,
  testProvider: adminApi.testProvider,

  // Admin Model Configurations
  listModels: adminApi.listModels,
  getModel: adminApi.getModel,
  createModel: adminApi.createModel,
  updateModel: adminApi.updateModel,
  deleteModel: adminApi.deleteModel,
  setDefaultModel: adminApi.setDefaultModel,

  // Registry Status
  getRegistryStatus: adminApi.getRegistryStatus,
  refreshRegistry: adminApi.refreshRegistry,

  // Admin Users
  listUsers: adminApi.listUsers,
  getUser: adminApi.getUser,
  createUser: adminApi.createUser,
  updateUser: adminApi.updateUser,
  deleteUser: adminApi.deleteUser,
  resetUserPassword: adminApi.resetUserPassword,

  // Admin Shared Knowledge Bases
  listSharedKbs: adminApi.listSharedKbs,
  getSharedKb: adminApi.getSharedKb,
  createSharedKb: adminApi.createSharedKb,
  updateSharedKb: adminApi.updateSharedKb,
  deleteSharedKb: adminApi.deleteSharedKb,
  publishSharedKb: adminApi.publishSharedKb,
  unpublishSharedKb: adminApi.unpublishSharedKb,
  shareKbWithTenant: adminApi.shareKbWithTenant,
  unshareKbFromTenant: adminApi.unshareKbFromTenant,
  getAvailableTenants: adminApi.getAvailableTenants,
  listSharedKbSources: adminApi.listSharedKbSources,
  createSharedKbSource: adminApi.createSharedKbSource,
  updateSharedKbSource: adminApi.updateSharedKbSource,
  deleteSharedKbSource: adminApi.deleteSharedKbSource,
  triggerSharedKbSourceRun: adminApi.triggerSharedKbSourceRun,
  listSharedKbSourceRuns: adminApi.listSharedKbSourceRuns,
  getSharedKbSourceStats: adminApi.getSharedKbSourceStats,

  // Admin Dashboard
  getDashboardHealth: adminApi.getDashboardHealth,
  getDashboardStats: adminApi.getDashboardStats,

  // Email/SMTP Testing
  verifySmtp: adminApi.verifySmtp,
  sendTestEmail: adminApi.sendTestEmail,
  getEmailStatus: adminApi.getEmailStatus,

  // Alert Scheduler
  getAlertStatus: adminApi.getAlertStatus,
  runHealthCheck: adminApi.runHealthCheck,
  startAlertScheduler: adminApi.startAlertScheduler,
  stopAlertScheduler: adminApi.stopAlertScheduler,

  // Admin Analytics
  getAdminAnalyticsOverview: adminApi.getAdminAnalyticsOverview,
  getAdminAnalyticsTenants: adminApi.getAdminAnalyticsTenants,
  getAdminAnalyticsTenantDetail: adminApi.getAdminAnalyticsTenantDetail,
  exportAdminAnalyticsOverview: adminApi.exportAdminAnalyticsOverview,
  exportAdminAnalyticsTenants: adminApi.exportAdminAnalyticsTenants,

  // Admin API Tokens
  listAdminTokens: adminApi.listAdminTokens,
  createAdminToken: adminApi.createAdminToken,
  revokeAdminToken: adminApi.revokeAdminToken,

  // Audit Logs
  listAuditLogs: adminApi.listAuditLogs,
  getAuditLog: adminApi.getAuditLog,
  getAuditLogFilters: adminApi.getAuditLogFilters,
  getResourceAuditHistory: adminApi.getResourceAuditHistory,
  getAuditSummary: adminApi.getAuditSummary,
};

// Export domain APIs for direct use
export { authApi } from "./auth";
export { tenantsApi } from "./tenants";
export { knowledgeBasesApi } from "./knowledge-bases";
export { sourcesApi } from "./sources";
export { agentsApi } from "./agents";
export { chatApi } from "./chat";
export { toolsApi } from "./tools";
export { analyticsApi } from "./analytics";
export { adminApi } from "./admin";
