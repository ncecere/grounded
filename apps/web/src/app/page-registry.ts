import { lazy, type ComponentType } from "react";

// Lazy-load all registry pages so they are code-split into separate chunks.
// This reduces the initial bundle by ~150 KB (these pages are admin-only or
// rarely visited on first load).
const Analytics = lazy(() =>
  import("@/pages/Analytics").then((m) => ({ default: m.Analytics }))
);
const AdminSettings = lazy(() =>
  import("@/pages/AdminSettings").then((m) => ({ default: m.AdminSettings }))
);
const AdminTenants = lazy(() =>
  import("@/pages/AdminTenants").then((m) => ({ default: m.AdminTenants }))
);
const AdminModels = lazy(() =>
  import("@/pages/AdminModels").then((m) => ({ default: m.AdminModels }))
);
const AdminUsers = lazy(() =>
  import("@/pages/AdminUsers").then((m) => ({ default: m.AdminUsers }))
);
const AdminAnalytics = lazy(() =>
  import("@/pages/AdminAnalytics").then((m) => ({ default: m.AdminAnalytics }))
);
const TenantSettings = lazy(() =>
  import("@/pages/TenantSettings").then((m) => ({ default: m.TenantSettings }))
);
const AdminAuditLogs = lazy(() =>
  import("@/pages/AdminAuditLogs").then((m) => ({ default: m.AdminAuditLogs }))
);

type PageComponent = ComponentType<Record<string, never>>;

const PlaceholderPage: PageComponent = () => null;

export type PageGroup = "workspace" | "admin";

export type PageAuthGate = "tenant" | "tenant-admin" | "system-admin";

export interface PageRegistryEntry {
  id: string;
  label: string;
  group: PageGroup;
  component: PageComponent;
  authGate: PageAuthGate;
  order: number;
}

export interface PageAccessContext {
  hasTenant: boolean;
  canManageTenant: boolean;
  isSystemAdmin?: boolean;
}

export const canAccessPage = (entry: PageRegistryEntry, context: PageAccessContext) => {
  switch (entry.authGate) {
    case "tenant":
      return context.hasTenant;
    case "tenant-admin":
      return context.hasTenant && context.canManageTenant;
    case "system-admin":
      return !!context.isSystemAdmin;
    default:
      return false;
  }
};

export const pageRegistry = [
  {
    id: "kbs",
    label: "Knowledge Bases",
    group: "workspace",
    component: PlaceholderPage,
    authGate: "tenant",
    order: 1,
  },
  {
    id: "agents",
    label: "Agents",
    group: "workspace",
    component: PlaceholderPage,
    authGate: "tenant",
    order: 2,
  },
  {
    id: "sources",
    label: "Sources",
    group: "workspace",
    component: PlaceholderPage,
    authGate: "tenant",
    order: 3,
  },
  {
    id: "chat",
    label: "Chat",
    group: "workspace",
    component: PlaceholderPage,
    authGate: "tenant",
    order: 4,
  },
  {
    id: "test-suites",
    label: "Test Suites",
    group: "workspace",
    component: PlaceholderPage,
    authGate: "tenant",
    order: 5,
  },
  {
    id: "test-suite-detail",
    label: "Test Suite",
    group: "workspace",
    component: PlaceholderPage,
    authGate: "tenant",
    order: 6,
  },
  {
    id: "analytics",
    label: "Analytics",
    group: "workspace",
    component: Analytics,
    authGate: "tenant",
    order: 7,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    group: "admin",
    component: PlaceholderPage,
    authGate: "system-admin",
    order: 8,
  },
  {
    id: "settings",
    label: "Settings",
    group: "admin",
    component: AdminSettings,
    authGate: "system-admin",
    order: 9,
  },
  {
    id: "tenants",
    label: "Tenants",
    group: "admin",
    component: AdminTenants,
    authGate: "system-admin",
    order: 10,
  },
  {
    id: "models",
    label: "AI Models",
    group: "admin",
    component: AdminModels,
    authGate: "system-admin",
    order: 11,
  },
  {
    id: "users",
    label: "Users",
    group: "admin",
    component: AdminUsers,
    authGate: "system-admin",
    order: 12,
  },
  {
    id: "shared-kbs",
    label: "Shared Knowledge Bases",
    group: "admin",
    component: PlaceholderPage,
    authGate: "system-admin",
    order: 13,
  },
  {
    id: "shared-kb-sources",
    label: "Shared KB Sources",
    group: "admin",
    component: PlaceholderPage,
    authGate: "system-admin",
    order: 14,
  },
  {
    id: "shared-kb-detail",
    label: "Shared Knowledge Base",
    group: "admin",
    component: PlaceholderPage,
    authGate: "system-admin",
    order: 15,
  },
  {
    id: "admin-analytics",
    label: "Analytics",
    group: "admin",
    component: AdminAnalytics,
    authGate: "system-admin",
    order: 16,
  },
  {
    id: "tenant-settings",
    label: "Tenant Settings",
    group: "workspace",
    component: TenantSettings,
    authGate: "tenant-admin",
    order: 17,
  },
  {
    id: "admin-audit-logs",
    label: "Audit Logs",
    group: "admin",
    component: AdminAuditLogs,
    authGate: "system-admin",
    order: 18,
  },
] as const satisfies ReadonlyArray<PageRegistryEntry>;

export type PageId = (typeof pageRegistry)[number]["id"];

export const pageRegistryById = pageRegistry.reduce(
  (acc, entry) => {
    acc[entry.id] = entry;
    return acc;
  },
  {} as Record<PageId, PageRegistryEntry>
);
