import { describe, it, expect } from "bun:test";

import {
  pageRegistry,
  pageRegistryById,
  type PageAuthGate,
  type PageGroup,
  type PageId,
} from "./page-registry";

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

  it("should include group, auth gate, and order metadata", () => {
    const validGroups: PageGroup[] = ["workspace", "admin"];
    const validAuthGates: PageAuthGate[] = ["tenant", "tenant-admin", "system-admin"];

    pageRegistry.forEach((entry) => {
      expect(validGroups).toContain(entry.group);
      expect(validAuthGates).toContain(entry.authGate);
      expect(entry.order).toBeGreaterThan(0);
    });
  });

  it("should keep entries ordered by the order field", () => {
    const orders = pageRegistry.map((entry) => entry.order);
    const sortedOrders = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sortedOrders);
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
