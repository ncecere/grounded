import { describe, expect, it } from "bun:test";
import { createTestSuiteSchema, updateTestSuiteSchema } from "../modules/test-suites/schema";

// ============================================================================
// Tests for createTestSuiteSchema
// ============================================================================

describe("createTestSuiteSchema", () => {
  it("defaults scheduleType to manual", () => {
    const result = createTestSuiteSchema.parse({ name: "Suite" });
    expect(result.scheduleType).toBe("manual");
  });

  it("defaults alert settings", () => {
    const result = createTestSuiteSchema.parse({ name: "Suite" });
    expect(result.alertOnRegression).toBe(true);
    expect(result.alertThresholdPercent).toBe(10);
  });

  it("accepts valid schedule time", () => {
    const result = createTestSuiteSchema.parse({
      name: "Suite",
      scheduleType: "daily",
      scheduleTime: "09:30",
    });
    expect(result.scheduleTime).toBe("09:30");
  });

  it("rejects invalid schedule time", () => {
    expect(() =>
      createTestSuiteSchema.parse({
        name: "Suite",
        scheduleType: "daily",
        scheduleTime: "9:30",
      })
    ).toThrow();
  });

  it("accepts valid schedule day of week", () => {
    const result = createTestSuiteSchema.parse({
      name: "Suite",
      scheduleType: "weekly",
      scheduleDayOfWeek: 2,
    });
    expect(result.scheduleDayOfWeek).toBe(2);
  });

  it("rejects schedule day of week outside range", () => {
    expect(() =>
      createTestSuiteSchema.parse({
        name: "Suite",
        scheduleDayOfWeek: 7,
      })
    ).toThrow();
  });

  it("rejects alert threshold above 100", () => {
    expect(() =>
      createTestSuiteSchema.parse({
        name: "Suite",
        alertThresholdPercent: 120,
      })
    ).toThrow();
  });
});

// ============================================================================
// Tests for updateTestSuiteSchema
// ============================================================================

describe("updateTestSuiteSchema", () => {
  it("allows partial updates", () => {
    const result = updateTestSuiteSchema.parse({ isEnabled: false });
    expect(result.isEnabled).toBe(false);
  });

  it("accepts null scheduleTime to clear", () => {
    const result = updateTestSuiteSchema.parse({ scheduleTime: null });
    expect(result.scheduleTime).toBeNull();
  });

  it("rejects invalid schedule type", () => {
    expect(() => updateTestSuiteSchema.parse({ scheduleType: "monthly" })).toThrow();
  });
});
