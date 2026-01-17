import { request } from "./client";
import type { Tenant, TenantMember, TenantAlertSettings, TenantApiKey, TenantApiKeyWithSecret } from "./types";

export const tenantsApi = {
  listAllTenants: () => request<{ tenants: Tenant[] }>("/tenants"),

  createTenant: (data: {
    name: string;
    slug: string;
    ownerEmail?: string;
    quotas?: {
      maxKbs?: number;
      maxAgents?: number;
      maxUploadedDocsPerMonth?: number;
      maxScrapedPagesPerMonth?: number;
      maxCrawlConcurrency?: number;
      chatRateLimitPerMinute?: number;
    };
  }) =>
    request<{ tenant: Tenant }>("/tenants", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getTenant: (id: string) => request<{ tenant: Tenant }>(`/tenants/${id}`),

  updateTenant: (id: string, data: { name?: string }) =>
    request<{ tenant: Tenant }>(`/tenants/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteTenant: (id: string) =>
    request<{ message: string }>(`/tenants/${id}`, { method: "DELETE" }),

  // Tenant Members
  listTenantMembers: (tenantId: string) =>
    request<{ members: TenantMember[] }>(`/tenants/${tenantId}/members`),

  addTenantMember: (tenantId: string, data: { email: string; role: string }) =>
    request<{ message: string; userId: string }>(`/tenants/${tenantId}/members`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTenantMember: (tenantId: string, userId: string, data: { role: string }) =>
    request<{ message: string }>(`/tenants/${tenantId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  removeTenantMember: (tenantId: string, userId: string) =>
    request<{ message: string }>(`/tenants/${tenantId}/members/${userId}`, {
      method: "DELETE",
    }),

  // Tenant Alert Settings
  getTenantAlertSettings: (tenantId: string) =>
    request<{ alertSettings: TenantAlertSettings }>(`/tenants/${tenantId}/alert-settings`),

  updateTenantAlertSettings: (
    tenantId: string,
    data: Partial<Omit<TenantAlertSettings, "tenantId" | "createdAt" | "updatedAt">>
  ) =>
    request<{ alertSettings: TenantAlertSettings }>(`/tenants/${tenantId}/alert-settings`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Tenant API Keys
  listTenantApiKeys: (tenantId: string) =>
    request<{ apiKeys: TenantApiKey[] }>(`/tenants/${tenantId}/api-keys`),

  createTenantApiKey: (tenantId: string, data: { name: string; scopes?: string[]; expiresAt?: string }) =>
    request<TenantApiKeyWithSecret>(`/tenants/${tenantId}/api-keys`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  revokeTenantApiKey: (tenantId: string, keyId: string) =>
    request<{ message: string }>(`/tenants/${tenantId}/api-keys/${keyId}`, { method: "DELETE" }),
};
