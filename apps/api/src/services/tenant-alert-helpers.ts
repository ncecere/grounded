import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

/**
 * Default values for tenant alert settings
 * Used when no settings exist in the database
 */
export const DEFAULT_ALERT_SETTINGS = {
  enabled: true,
  notifyOwners: true,
  notifyAdmins: false,
  additionalEmails: null,
  errorRateThreshold: null,
  quotaWarningThreshold: null,
  inactivityDays: null,
} as const;

/**
 * Type for alert settings from database or defaults
 */
export interface TenantAlertSettings {
  tenantId: string;
  enabled: boolean;
  notifyOwners: boolean;
  notifyAdmins: boolean;
  additionalEmails: string | null;
  errorRateThreshold: number | null;
  quotaWarningThreshold: number | null;
  inactivityDays: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * Resolved alert settings with system defaults applied to null thresholds
 */
export interface ResolvedAlertSettings {
  enabled: boolean;
  notifyOwners: boolean;
  notifyAdmins: boolean;
  additionalEmails: string | null;
  errorRateThreshold: number;
  quotaWarningThreshold: number;
  inactivityDays: number;
}

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Schema for updating tenant alert settings
 */
export const updateAlertSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  notifyOwners: z.boolean().optional(),
  notifyAdmins: z.boolean().optional(),
  additionalEmails: z.string().optional().nullable(),
  errorRateThreshold: z.number().int().min(1).max(100).optional().nullable(),
  quotaWarningThreshold: z.number().int().min(1).max(100).optional().nullable(),
  inactivityDays: z.number().int().min(0).max(365).optional().nullable(),
});

export type UpdateAlertSettingsInput = z.infer<typeof updateAlertSettingsSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates a comma-separated list of email addresses
 * @param emailList Comma-separated email addresses
 * @returns Array of validation errors (empty if all valid)
 */
export function validateAdditionalEmails(emailList: string): string[] {
  const errors: string[] = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emails = emailList.split(",").map((e) => e.trim());

  for (const email of emails) {
    if (email && !emailRegex.test(email)) {
      errors.push(`Invalid email address: ${email}`);
    }
  }

  return errors;
}

/**
 * Parses a comma-separated email list into an array
 * Filters out empty strings
 * @param emailList Comma-separated email addresses or null
 * @returns Array of trimmed email addresses
 */
export function parseAdditionalEmails(emailList: string | null): string[] {
  if (!emailList) {
    return [];
  }
  return emailList.split(",").map((e) => e.trim()).filter(Boolean);
}

// ============================================================================
// Default Settings Helpers
// ============================================================================

/**
 * Returns default alert settings for a tenant
 * Used when no settings row exists in the database
 * @param tenantId The tenant ID
 */
export function getDefaultAlertSettings(tenantId: string): TenantAlertSettings {
  return {
    tenantId,
    ...DEFAULT_ALERT_SETTINGS,
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * Resolves tenant-specific settings with system defaults
 * Tenant-specific threshold values override system defaults when non-null
 * @param tenantSettings Tenant-specific settings (or null for defaults)
 * @param systemDefaults System-wide default thresholds
 */
export function resolveAlertSettings(
  tenantSettings: Pick<
    TenantAlertSettings,
    | "enabled"
    | "notifyOwners"
    | "notifyAdmins"
    | "additionalEmails"
    | "errorRateThreshold"
    | "quotaWarningThreshold"
    | "inactivityDays"
  > | null,
  systemDefaults: {
    errorRateThreshold: number;
    quotaWarningThreshold: number;
    inactivityDays: number;
  }
): ResolvedAlertSettings {
  return {
    enabled: tenantSettings?.enabled ?? DEFAULT_ALERT_SETTINGS.enabled,
    notifyOwners: tenantSettings?.notifyOwners ?? DEFAULT_ALERT_SETTINGS.notifyOwners,
    notifyAdmins: tenantSettings?.notifyAdmins ?? DEFAULT_ALERT_SETTINGS.notifyAdmins,
    additionalEmails: tenantSettings?.additionalEmails ?? DEFAULT_ALERT_SETTINGS.additionalEmails,
    errorRateThreshold: tenantSettings?.errorRateThreshold ?? systemDefaults.errorRateThreshold,
    quotaWarningThreshold: tenantSettings?.quotaWarningThreshold ?? systemDefaults.quotaWarningThreshold,
    inactivityDays: tenantSettings?.inactivityDays ?? systemDefaults.inactivityDays,
  };
}

// ============================================================================
// Upsert Data Builder
// ============================================================================

/**
 * Builds the insert values for tenant alert settings upsert
 * Applies defaults for missing fields
 * @param tenantId The tenant ID
 * @param input Validated update input
 */
export function buildAlertSettingsInsertValues(
  tenantId: string,
  input: UpdateAlertSettingsInput
) {
  return {
    tenantId,
    enabled: input.enabled ?? DEFAULT_ALERT_SETTINGS.enabled,
    notifyOwners: input.notifyOwners ?? DEFAULT_ALERT_SETTINGS.notifyOwners,
    notifyAdmins: input.notifyAdmins ?? DEFAULT_ALERT_SETTINGS.notifyAdmins,
    additionalEmails: input.additionalEmails ?? DEFAULT_ALERT_SETTINGS.additionalEmails,
    errorRateThreshold: input.errorRateThreshold ?? DEFAULT_ALERT_SETTINGS.errorRateThreshold,
    quotaWarningThreshold: input.quotaWarningThreshold ?? DEFAULT_ALERT_SETTINGS.quotaWarningThreshold,
    inactivityDays: input.inactivityDays ?? DEFAULT_ALERT_SETTINGS.inactivityDays,
  };
}

/**
 * Builds the update values for tenant alert settings upsert (conflict update)
 * Only includes fields that are explicitly set in the input
 * @param input Validated update input
 */
export function buildAlertSettingsUpdateValues(input: UpdateAlertSettingsInput) {
  return {
    enabled: input.enabled,
    notifyOwners: input.notifyOwners,
    notifyAdmins: input.notifyAdmins,
    additionalEmails: input.additionalEmails,
    errorRateThreshold: input.errorRateThreshold,
    quotaWarningThreshold: input.quotaWarningThreshold,
    inactivityDays: input.inactivityDays,
    updatedAt: new Date(),
  };
}
