import { describe, it, expect } from "bun:test";

import { pageRegistry, pageRegistryById, type PageId } from "./page-registry";

// =============================================================================
// Page Registry Tests
// =============================================================================

describe("pageRegistry", () => {
  const expectedIds: PageId[] = [
    "kbs",
    "agents",
    "sources",
    "chat",
    "test-suites",
    "test-suite-detail",
    "analytics",
    "dashboard",
    "settings",
    "tenants",
    "models",
    "users",
    "shared-kbs",
    "shared-kb-sources",
    "shared-kb-detail",
    "admin-analytics",
    "tenant-settings",
    "admin-audit-logs",
  ];

  it("should include all known pages", () => {
    const ids = pageRegistry.map((entry) => entry.id);
    expect(ids).toEqual(expectedIds);
  });

  it("should have unique page ids", () => {
    const ids = pageRegistry.map((entry) => entry.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(pageRegistry.length);
  });

  it("should provide labels and components for each entry", () => {
    pageRegistry.forEach((entry) => {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.component).toBeDefined();
      expect(typeof entry.component).toBe("function");
    });
  });
});

// =============================================================================
// Page Registry Lookup Tests
// =============================================================================

describe("pageRegistryById", () => {
  const expectedIds: PageId[] = [
    "kbs",
    "agents",
    "sources",
    "chat",
    "test-suites",
    "test-suite-detail",
    "analytics",
    "dashboard",
    "settings",
    "tenants",
    "models",
    "users",
    "shared-kbs",
    "shared-kb-sources",
    "shared-kb-detail",
    "admin-analytics",
    "tenant-settings",
    "admin-audit-logs",
  ];

  it("should expose entries by id", () => {
    expectedIds.forEach((id) => {
      expect(pageRegistryById[id]).toBeDefined();
    });
  });

  it("should align lookup entries with the registry", () => {
    expectedIds.forEach((id) => {
      const entry = pageRegistryById[id];
      expect(entry.id).toBe(id);
      expect(entry.label.length).toBeGreaterThan(0);
    });
  });
});
