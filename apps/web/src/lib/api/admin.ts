import { API_BASE, request, getToken } from "./client";
import type {
  SystemSetting,
  ModelProvider,
  ModelConfiguration,
  ProviderType,
  ModelType,
  RegistryStatus,
  AdminUser,
  AdminUserDetail,
  SharedKnowledgeBase,
  SharedKnowledgeBaseDetail,
  AvailableTenant,
  Source,
  SourceRun,
  DashboardHealth,
  DashboardStats,
  AdminAnalyticsOverview,
  AdminAnalyticsTenants,
  AdminAnalyticsTenantDetail,
  AdminApiToken,
  AdminApiTokenWithSecret,
  AuditLogResponse,
  AuditLogEntry,
  AuditLogFilters,
  AuditSummary,
} from "./types";

export const adminApi = {
  // Settings
  getAdminSettings: (category?: string) =>
    request<{ settings: SystemSetting[] }>(
      `/admin/settings${category ? `?category=${category}` : ""}`
    ),

  getAdminSetting: (key: string) =>
    request<SystemSetting & { exists: boolean }>(`/admin/settings/${key}`),

  updateAdminSetting: (key: string, value: string | number | boolean) =>
    request<{ message: string; key: string }>(`/admin/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),

  bulkUpdateAdminSettings: (settings: Array<{ key: string; value: string | number | boolean }>) =>
    request<{ message: string; count: number }>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    }),

  // Model Providers
  listProviders: () =>
    request<{ providers: ModelProvider[] }>("/admin/models/providers"),

  getProvider: (id: string) =>
    request<{ provider: ModelProvider & { models: ModelConfiguration[] } }>(`/admin/models/providers/${id}`),

  createProvider: (data: {
    name: string;
    displayName: string;
    type: ProviderType;
    baseUrl?: string | null;
    apiKey: string;
    isEnabled?: boolean;
  }) =>
    request<{ message: string; provider: ModelProvider }>("/admin/models/providers", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateProvider: (id: string, data: {
    displayName?: string;
    type?: ProviderType;
    baseUrl?: string | null;
    apiKey?: string;
    isEnabled?: boolean;
  }) =>
    request<{ message: string; provider: ModelProvider }>(`/admin/models/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteProvider: (id: string) =>
    request<{ message: string }>(`/admin/models/providers/${id}`, { method: "DELETE" }),

  testProvider: (id: string) =>
    request<{ success: boolean; message: string; modelsFound?: number }>(`/admin/models/providers/${id}/test`, {
      method: "POST",
    }),

  // Model Configurations
  listModels: (params?: { type?: ModelType; providerId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set("type", params.type);
    if (params?.providerId) searchParams.set("providerId", params.providerId);
    const query = searchParams.toString();
    return request<{ models: ModelConfiguration[] }>(`/admin/models/models${query ? `?${query}` : ""}`);
  },

  getModel: (id: string) =>
    request<{ model: ModelConfiguration }>(`/admin/models/models/${id}`),

  createModel: (data: {
    providerId: string;
    modelId: string;
    displayName: string;
    modelType: ModelType;
    maxTokens?: number;
    temperature?: number;
    supportsStreaming?: boolean;
    supportsTools?: boolean;
    dimensions?: number | null;
    isEnabled?: boolean;
    isDefault?: boolean;
  }) =>
    request<{ message: string; model: ModelConfiguration }>("/admin/models/models", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateModel: (id: string, data: {
    displayName?: string;
    maxTokens?: number;
    temperature?: number;
    supportsStreaming?: boolean;
    supportsTools?: boolean;
    dimensions?: number | null;
    isEnabled?: boolean;
    isDefault?: boolean;
  }) =>
    request<{ message: string; model: ModelConfiguration }>(`/admin/models/models/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteModel: (id: string) =>
    request<{ message: string }>(`/admin/models/models/${id}`, { method: "DELETE" }),

  setDefaultModel: (id: string) =>
    request<{ message: string; modelType: ModelType }>(`/admin/models/models/${id}/set-default`, {
      method: "POST",
    }),

  // Registry Status
  getRegistryStatus: () =>
    request<RegistryStatus>("/admin/models/status"),

  refreshRegistry: () =>
    request<{ message: string }>("/admin/models/refresh", { method: "POST" }),

  // Users
  listUsers: () =>
    request<{ users: AdminUser[] }>("/admin/users"),

  getUser: (id: string) =>
    request<AdminUserDetail>(`/admin/users/${id}`),

  createUser: (data: { email: string; password?: string; isSystemAdmin?: boolean }) =>
    request<{ id: string; email: string; isSystemAdmin: boolean }>("/admin/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateUser: (id: string, data: { isSystemAdmin?: boolean; disabled?: boolean }) =>
    request<{ message: string }>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteUser: (id: string) =>
    request<{ message: string }>(`/admin/users/${id}`, { method: "DELETE" }),

  resetUserPassword: (id: string, newPassword: string) =>
    request<{ message: string }>(`/admin/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),

  // Shared Knowledge Bases
  listSharedKbs: () =>
    request<{ knowledgeBases: SharedKnowledgeBase[] }>("/admin/shared-kbs"),

  getSharedKb: (id: string) =>
    request<{ knowledgeBase: SharedKnowledgeBaseDetail }>(`/admin/shared-kbs/${id}`),

  createSharedKb: (data: { name: string; description?: string; embeddingModelId?: string }) =>
    request<{ knowledgeBase: SharedKnowledgeBase }>("/admin/shared-kbs", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateSharedKb: (id: string, data: { name?: string; description?: string }) =>
    request<{ knowledgeBase: SharedKnowledgeBase }>(`/admin/shared-kbs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteSharedKb: (id: string) =>
    request<{ message: string }>(`/admin/shared-kbs/${id}`, { method: "DELETE" }),

  publishSharedKb: (id: string) =>
    request<{ knowledgeBase: SharedKnowledgeBase; message: string }>(`/admin/shared-kbs/${id}/publish`, {
      method: "POST",
    }),

  unpublishSharedKb: (id: string) =>
    request<{ knowledgeBase: SharedKnowledgeBase; message: string }>(`/admin/shared-kbs/${id}/unpublish`, {
      method: "POST",
    }),

  shareKbWithTenant: (kbId: string, tenantId: string) =>
    request<{ message: string; tenant: { id: string; name: string; slug: string } }>(`/admin/shared-kbs/${kbId}/shares`, {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    }),

  unshareKbFromTenant: (kbId: string, tenantId: string) =>
    request<{ message: string }>(`/admin/shared-kbs/${kbId}/shares/${tenantId}`, {
      method: "DELETE",
    }),

  getAvailableTenants: (kbId: string) =>
    request<{ tenants: AvailableTenant[] }>(`/admin/shared-kbs/${kbId}/available-tenants`),

  // Shared KB Sources
  listSharedKbSources: async (kbId: string) => {
    const res = await request<{ sources: Source[] }>(`/admin/shared-kbs/${kbId}/sources`);
    return res.sources;
  },

  createSharedKbSource: async (
    kbId: string,
    data: { name: string; type: string; config: Record<string, unknown> }
  ) => {
    const res = await request<{ source: Source }>(`/admin/shared-kbs/${kbId}/sources`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.source;
  },

  updateSharedKbSource: async (
    kbId: string,
    sourceId: string,
    data: { name?: string; config?: Record<string, unknown> }
  ) => {
    const res = await request<{ source: Source }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.source;
  },

  deleteSharedKbSource: (kbId: string, sourceId: string) =>
    request<{ message: string }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}`, { method: "DELETE" }),

  triggerSharedKbSourceRun: async (kbId: string, sourceId: string, options?: { forceReindex?: boolean }) => {
    const res = await request<{ run: SourceRun }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}/runs`, {
      method: "POST",
      body: JSON.stringify({ forceReindex: options?.forceReindex ?? false }),
    });
    return res.run;
  },

  listSharedKbSourceRuns: async (kbId: string, sourceId: string) => {
    const res = await request<{ runs: SourceRun[] }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}/runs`);
    return res.runs;
  },

  getSharedKbSourceStats: async (kbId: string, sourceId: string) => {
    const res = await request<{ stats: { pageCount: number; chunkCount: number } }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}/stats`);
    return res.stats;
  },

  // Dashboard
  getDashboardHealth: () =>
    request<DashboardHealth>("/admin/dashboard/health"),

  getDashboardStats: () =>
    request<DashboardStats>("/admin/dashboard/stats"),

  // Email/SMTP Testing
  verifySmtp: () =>
    request<{ success: boolean; message: string }>("/admin/settings/email/verify", {
      method: "POST",
    }),

  sendTestEmail: (email: string) =>
    request<{ success: boolean; message: string }>("/admin/settings/email/test", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  getEmailStatus: () =>
    request<{ configured: boolean }>("/admin/settings/email/status"),

  // Alert Scheduler
  getAlertStatus: () =>
    request<{ schedulerRunning: boolean; lastCheckTime: string | null }>("/admin/settings/alerts/status"),

  runHealthCheck: () =>
    request<{ checked: boolean; tenantsWithIssues: number; alertSent: boolean; error?: string }>("/admin/settings/alerts/check", {
      method: "POST",
    }),

  startAlertScheduler: () =>
    request<{ success: boolean; running: boolean; message: string }>("/admin/settings/alerts/start", {
      method: "POST",
    }),

  stopAlertScheduler: () =>
    request<{ success: boolean; running: boolean; message: string }>("/admin/settings/alerts/stop", {
      method: "POST",
    }),

  // Admin Analytics
  getAdminAnalyticsOverview: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<AdminAnalyticsOverview>(`/admin/analytics/overview${query ? `?${query}` : ""}`);
  },

  getAdminAnalyticsTenants: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<AdminAnalyticsTenants>(`/admin/analytics/tenants${query ? `?${query}` : ""}`);
  },

  getAdminAnalyticsTenantDetail: (tenantId: string, params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<AdminAnalyticsTenantDetail>(`/admin/analytics/tenants/${tenantId}${query ? `?${query}` : ""}`);
  },

  exportAdminAnalyticsOverview: (params?: { startDate?: string; endDate?: string }) => {
    const token = getToken();
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return fetch(`${API_BASE}/admin/analytics/export/overview${query ? `?${query}` : ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },

  exportAdminAnalyticsTenants: () => {
    const token = getToken();
    return fetch(`${API_BASE}/admin/analytics/export/tenants`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },

  // Admin API Tokens
  listAdminTokens: () =>
    request<{ tokens: AdminApiToken[] }>("/admin/tokens"),

  createAdminToken: (data: { name: string; expiresAt?: string }) =>
    request<AdminApiTokenWithSecret>("/admin/tokens", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  revokeAdminToken: (id: string) =>
    request<{ message: string }>(`/admin/tokens/${id}`, { method: "DELETE" }),

  // Audit Logs
  listAuditLogs: (params?: {
    tenantId?: string;
    actorId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.tenantId) searchParams.set("tenantId", params.tenantId);
    if (params?.actorId) searchParams.set("actorId", params.actorId);
    if (params?.action) searchParams.set("action", params.action);
    if (params?.resourceType) searchParams.set("resourceType", params.resourceType);
    if (params?.resourceId) searchParams.set("resourceId", params.resourceId);
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    return request<AuditLogResponse>(`/admin/audit${query ? `?${query}` : ""}`);
  },

  getAuditLog: (id: string) =>
    request<{ log: AuditLogEntry & { actorEmail: string | null; tenantName: string | null } }>(`/admin/audit/${id}`),

  getAuditLogFilters: () =>
    request<AuditLogFilters>("/admin/audit/filters/options"),

  getResourceAuditHistory: (resourceType: string, resourceId: string) =>
    request<{ logs: Array<AuditLogEntry & { actorEmail: string | null }> }>(`/admin/audit/resource/${resourceType}/${resourceId}`),

  getAuditSummary: (tenantId: string, days?: number) => {
    const params = days ? `?days=${days}` : "";
    return request<{ summary: AuditSummary }>(`/admin/audit/summary/${tenantId}${params}`);
  },
};
