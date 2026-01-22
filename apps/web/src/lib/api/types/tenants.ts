export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount?: number;
}

export interface UserTenant {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface TenantMember {
  userId: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface TenantAlertSettings {
  tenantId: string;
  enabled: boolean;
  notifyOwners: boolean;
  notifyAdmins: boolean;
  additionalEmails: string | null;
  errorRateThreshold: number | null;
  quotaWarningThreshold: number | null;
  inactivityDays: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TenantApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdBy: string;
}

export interface TenantApiKeyWithSecret extends TenantApiKey {
  apiKey: string;
}

export interface AvailableTenant {
  id: string;
  name: string;
  slug: string;
  isShared: boolean;
}
