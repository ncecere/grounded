import { describe, it, expect } from "bun:test";
import {
  DEFAULT_ALERT_SETTINGS,
  updateAlertSettingsSchema,
  validateAdditionalEmails,
  parseAdditionalEmails,
  getDefaultAlertSettings,
  resolveAlertSettings,
  buildAlertSettingsInsertValues,
  buildAlertSettingsUpdateValues,
} from "./tenant-alert-helpers";

describe("tenant-alert-helpers", () => {
  describe("DEFAULT_ALERT_SETTINGS", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_ALERT_SETTINGS.enabled).toBe(true);
      expect(DEFAULT_ALERT_SETTINGS.notifyOwners).toBe(true);
      expect(DEFAULT_ALERT_SETTINGS.notifyAdmins).toBe(false);
      expect(DEFAULT_ALERT_SETTINGS.additionalEmails).toBe(null);
      expect(DEFAULT_ALERT_SETTINGS.errorRateThreshold).toBe(null);
      expect(DEFAULT_ALERT_SETTINGS.quotaWarningThreshold).toBe(null);
      expect(DEFAULT_ALERT_SETTINGS.inactivityDays).toBe(null);
    });
  });

  describe("updateAlertSettingsSchema", () => {
    it("should accept valid input with all fields", () => {
      const input = {
        enabled: true,
        notifyOwners: false,
        notifyAdmins: true,
        additionalEmails: "test@example.com",
        errorRateThreshold: 50,
        quotaWarningThreshold: 80,
        inactivityDays: 30,
      };

      const result = updateAlertSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept empty input (all fields optional)", () => {
      const result = updateAlertSettingsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept null for nullable fields", () => {
      const input = {
        additionalEmails: null,
        errorRateThreshold: null,
        quotaWarningThreshold: null,
        inactivityDays: null,
      };

      const result = updateAlertSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject errorRateThreshold below 1", () => {
      const result = updateAlertSettingsSchema.safeParse({
        errorRateThreshold: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject errorRateThreshold above 100", () => {
      const result = updateAlertSettingsSchema.safeParse({
        errorRateThreshold: 101,
      });
      expect(result.success).toBe(false);
    });

    it("should reject quotaWarningThreshold below 1", () => {
      const result = updateAlertSettingsSchema.safeParse({
        quotaWarningThreshold: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject quotaWarningThreshold above 100", () => {
      const result = updateAlertSettingsSchema.safeParse({
        quotaWarningThreshold: 101,
      });
      expect(result.success).toBe(false);
    });

    it("should reject inactivityDays below 0", () => {
      const result = updateAlertSettingsSchema.safeParse({
        inactivityDays: -1,
      });
      expect(result.success).toBe(false);
    });

    it("should reject inactivityDays above 365", () => {
      const result = updateAlertSettingsSchema.safeParse({
        inactivityDays: 366,
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-integer thresholds", () => {
      const result = updateAlertSettingsSchema.safeParse({
        errorRateThreshold: 50.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("validateAdditionalEmails", () => {
    it("should return empty array for valid single email", () => {
      const errors = validateAdditionalEmails("test@example.com");
      expect(errors).toEqual([]);
    });

    it("should return empty array for valid multiple emails", () => {
      const errors = validateAdditionalEmails(
        "user1@example.com, user2@example.com, user3@example.org"
      );
      expect(errors).toEqual([]);
    });

    it("should return error for invalid email", () => {
      const errors = validateAdditionalEmails("invalid-email");
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("Invalid email address");
    });

    it("should return multiple errors for multiple invalid emails", () => {
      const errors = validateAdditionalEmails("invalid1, invalid2");
      expect(errors.length).toBe(2);
    });

    it("should handle mixed valid and invalid emails", () => {
      const errors = validateAdditionalEmails("valid@example.com, invalid");
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("invalid");
    });

    it("should handle whitespace around emails", () => {
      const errors = validateAdditionalEmails("  test@example.com  ,  other@example.com  ");
      expect(errors).toEqual([]);
    });
  });

  describe("parseAdditionalEmails", () => {
    it("should return empty array for null", () => {
      const result = parseAdditionalEmails(null);
      expect(result).toEqual([]);
    });

    it("should return empty array for empty string", () => {
      const result = parseAdditionalEmails("");
      expect(result).toEqual([]);
    });

    it("should parse single email", () => {
      const result = parseAdditionalEmails("test@example.com");
      expect(result).toEqual(["test@example.com"]);
    });

    it("should parse multiple emails", () => {
      const result = parseAdditionalEmails("a@example.com, b@example.com");
      expect(result).toEqual(["a@example.com", "b@example.com"]);
    });

    it("should trim whitespace", () => {
      const result = parseAdditionalEmails("  a@example.com  ,  b@example.com  ");
      expect(result).toEqual(["a@example.com", "b@example.com"]);
    });

    it("should filter out empty strings", () => {
      const result = parseAdditionalEmails("a@example.com, , b@example.com");
      expect(result).toEqual(["a@example.com", "b@example.com"]);
    });
  });

  describe("getDefaultAlertSettings", () => {
    it("should return default settings with provided tenantId", () => {
      const tenantId = "test-tenant-123";
      const settings = getDefaultAlertSettings(tenantId);

      expect(settings.tenantId).toBe(tenantId);
      expect(settings.enabled).toBe(DEFAULT_ALERT_SETTINGS.enabled);
      expect(settings.notifyOwners).toBe(DEFAULT_ALERT_SETTINGS.notifyOwners);
      expect(settings.notifyAdmins).toBe(DEFAULT_ALERT_SETTINGS.notifyAdmins);
      expect(settings.additionalEmails).toBe(DEFAULT_ALERT_SETTINGS.additionalEmails);
      expect(settings.errorRateThreshold).toBe(DEFAULT_ALERT_SETTINGS.errorRateThreshold);
      expect(settings.quotaWarningThreshold).toBe(DEFAULT_ALERT_SETTINGS.quotaWarningThreshold);
      expect(settings.inactivityDays).toBe(DEFAULT_ALERT_SETTINGS.inactivityDays);
      expect(settings.createdAt).toBe(null);
      expect(settings.updatedAt).toBe(null);
    });
  });

  describe("resolveAlertSettings", () => {
    const systemDefaults = {
      errorRateThreshold: 10,
      quotaWarningThreshold: 80,
      inactivityDays: 7,
    };

    it("should use defaults when tenant settings is null", () => {
      const resolved = resolveAlertSettings(null, systemDefaults);

      expect(resolved.enabled).toBe(true);
      expect(resolved.notifyOwners).toBe(true);
      expect(resolved.notifyAdmins).toBe(false);
      expect(resolved.additionalEmails).toBe(null);
      expect(resolved.errorRateThreshold).toBe(systemDefaults.errorRateThreshold);
      expect(resolved.quotaWarningThreshold).toBe(systemDefaults.quotaWarningThreshold);
      expect(resolved.inactivityDays).toBe(systemDefaults.inactivityDays);
    });

    it("should use tenant-specific thresholds when provided", () => {
      const tenantSettings = {
        enabled: false,
        notifyOwners: false,
        notifyAdmins: true,
        additionalEmails: "admin@example.com",
        errorRateThreshold: 25,
        quotaWarningThreshold: 90,
        inactivityDays: 14,
      };

      const resolved = resolveAlertSettings(tenantSettings, systemDefaults);

      expect(resolved.enabled).toBe(false);
      expect(resolved.notifyOwners).toBe(false);
      expect(resolved.notifyAdmins).toBe(true);
      expect(resolved.additionalEmails).toBe("admin@example.com");
      expect(resolved.errorRateThreshold).toBe(25);
      expect(resolved.quotaWarningThreshold).toBe(90);
      expect(resolved.inactivityDays).toBe(14);
    });

    it("should use system defaults for null thresholds in tenant settings", () => {
      const tenantSettings = {
        enabled: true,
        notifyOwners: true,
        notifyAdmins: false,
        additionalEmails: null,
        errorRateThreshold: null,
        quotaWarningThreshold: null,
        inactivityDays: null,
      };

      const resolved = resolveAlertSettings(tenantSettings, systemDefaults);

      expect(resolved.enabled).toBe(true);
      expect(resolved.errorRateThreshold).toBe(systemDefaults.errorRateThreshold);
      expect(resolved.quotaWarningThreshold).toBe(systemDefaults.quotaWarningThreshold);
      expect(resolved.inactivityDays).toBe(systemDefaults.inactivityDays);
    });

    it("should allow partial tenant overrides", () => {
      const tenantSettings = {
        enabled: true,
        notifyOwners: true,
        notifyAdmins: false,
        additionalEmails: null,
        errorRateThreshold: 50,  // Override
        quotaWarningThreshold: null,  // Use system default
        inactivityDays: 30,  // Override
      };

      const resolved = resolveAlertSettings(tenantSettings, systemDefaults);

      expect(resolved.errorRateThreshold).toBe(50);
      expect(resolved.quotaWarningThreshold).toBe(systemDefaults.quotaWarningThreshold);
      expect(resolved.inactivityDays).toBe(30);
    });
  });

  describe("buildAlertSettingsInsertValues", () => {
    it("should include tenantId and apply defaults", () => {
      const tenantId = "test-tenant-456";
      const values = buildAlertSettingsInsertValues(tenantId, {});

      expect(values.tenantId).toBe(tenantId);
      expect(values.enabled).toBe(DEFAULT_ALERT_SETTINGS.enabled);
      expect(values.notifyOwners).toBe(DEFAULT_ALERT_SETTINGS.notifyOwners);
      expect(values.notifyAdmins).toBe(DEFAULT_ALERT_SETTINGS.notifyAdmins);
      expect(values.additionalEmails).toBe(DEFAULT_ALERT_SETTINGS.additionalEmails);
      expect(values.errorRateThreshold).toBe(DEFAULT_ALERT_SETTINGS.errorRateThreshold);
      expect(values.quotaWarningThreshold).toBe(DEFAULT_ALERT_SETTINGS.quotaWarningThreshold);
      expect(values.inactivityDays).toBe(DEFAULT_ALERT_SETTINGS.inactivityDays);
    });

    it("should use provided values over defaults", () => {
      const tenantId = "test-tenant-456";
      const input = {
        enabled: false,
        notifyOwners: false,
        notifyAdmins: true,
        additionalEmails: "ops@example.com",
        errorRateThreshold: 15,
        quotaWarningThreshold: 85,
        inactivityDays: 21,
      };

      const values = buildAlertSettingsInsertValues(tenantId, input);

      expect(values.tenantId).toBe(tenantId);
      expect(values.enabled).toBe(false);
      expect(values.notifyOwners).toBe(false);
      expect(values.notifyAdmins).toBe(true);
      expect(values.additionalEmails).toBe("ops@example.com");
      expect(values.errorRateThreshold).toBe(15);
      expect(values.quotaWarningThreshold).toBe(85);
      expect(values.inactivityDays).toBe(21);
    });
  });

  describe("buildAlertSettingsUpdateValues", () => {
    it("should include updatedAt timestamp", () => {
      const before = new Date();
      const values = buildAlertSettingsUpdateValues({});
      const after = new Date();

      expect(values.updatedAt).toBeInstanceOf(Date);
      expect(values.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(values.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should pass through provided values", () => {
      const input = {
        enabled: false,
        notifyOwners: true,
        notifyAdmins: false,
        additionalEmails: "team@example.com",
        errorRateThreshold: 20,
        quotaWarningThreshold: 75,
        inactivityDays: 14,
      };

      const values = buildAlertSettingsUpdateValues(input);

      expect(values.enabled).toBe(false);
      expect(values.notifyOwners).toBe(true);
      expect(values.notifyAdmins).toBe(false);
      expect(values.additionalEmails).toBe("team@example.com");
      expect(values.errorRateThreshold).toBe(20);
      expect(values.quotaWarningThreshold).toBe(75);
      expect(values.inactivityDays).toBe(14);
    });

    it("should pass through undefined for unset fields", () => {
      const values = buildAlertSettingsUpdateValues({});

      expect(values.enabled).toBeUndefined();
      expect(values.notifyOwners).toBeUndefined();
      expect(values.notifyAdmins).toBeUndefined();
      expect(values.additionalEmails).toBeUndefined();
      expect(values.errorRateThreshold).toBeUndefined();
      expect(values.quotaWarningThreshold).toBeUndefined();
      expect(values.inactivityDays).toBeUndefined();
    });
  });

  describe("module exports", () => {
    it("should export all required types and functions", async () => {
      const module = await import("./tenant-alert-helpers");

      expect(module.DEFAULT_ALERT_SETTINGS).toBeDefined();
      expect(typeof module.updateAlertSettingsSchema).toBe("object");
      expect(typeof module.validateAdditionalEmails).toBe("function");
      expect(typeof module.parseAdditionalEmails).toBe("function");
      expect(typeof module.getDefaultAlertSettings).toBe("function");
      expect(typeof module.resolveAlertSettings).toBe("function");
      expect(typeof module.buildAlertSettingsInsertValues).toBe("function");
      expect(typeof module.buildAlertSettingsUpdateValues).toBe("function");
    });
  });
});
