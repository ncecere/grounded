import type {
  Tenant as SharedTenant,
  UserTenant,
  TenantMember,
  TenantAlertSettings,
  TenantApiKey,
  TenantApiKeyWithSecret,
  AvailableTenant,
} from "@grounded/shared/types/api";

export interface Tenant extends SharedTenant {
  memberCount?: number;
}

export type {
  UserTenant,
  TenantMember,
  TenantAlertSettings,
  TenantApiKey,
  TenantApiKeyWithSecret,
  AvailableTenant,
};
