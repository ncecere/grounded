export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount?: number;
}

export type {
  UserTenant,
  TenantMember,
  TenantAlertSettings,
  TenantApiKey,
  TenantApiKeyWithSecret,
  AvailableTenant,
} from "@grounded/shared/types/admin";
