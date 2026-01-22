import type { ComponentType } from "react";

import { KnowledgeBases } from "@/pages/KnowledgeBases";
import { Agents } from "@/pages/Agents";
import { Sources } from "@/pages/Sources";
import { Chat } from "@/pages/Chat";
import { AgentTestSuites } from "@/pages/AgentTestSuites";
import { AgentTestSuiteDetail } from "@/pages/AgentTestSuiteDetail";
import { Analytics } from "@/pages/Analytics";
import { AdminSettings } from "@/pages/AdminSettings";
import { AdminTenants } from "@/pages/AdminTenants";
import { AdminModels } from "@/pages/AdminModels";
import { AdminUsers } from "@/pages/AdminUsers";
import { AdminSharedKBs } from "@/pages/AdminSharedKBs";
import { AdminSharedKbSources } from "@/pages/AdminSharedKbSources";
import { SharedKbDetail } from "@/pages/SharedKbDetail";
import AdminDashboard from "@/pages/AdminDashboard";
import { AdminAnalytics } from "@/pages/AdminAnalytics";
import { TenantSettings } from "@/pages/TenantSettings";
import { AdminAuditLogs } from "@/pages/AdminAuditLogs";

export interface PageRegistryEntry {
  id: string;
  label: string;
  component: ComponentType<any>;
}

export const pageRegistry = [
  { id: "kbs", label: "Knowledge Bases", component: KnowledgeBases },
  { id: "agents", label: "Agents", component: Agents },
  { id: "sources", label: "Sources", component: Sources },
  { id: "chat", label: "Chat", component: Chat },
  { id: "test-suites", label: "Test Suites", component: AgentTestSuites },
  { id: "test-suite-detail", label: "Test Suite", component: AgentTestSuiteDetail },
  { id: "analytics", label: "Analytics", component: Analytics },
  { id: "dashboard", label: "Dashboard", component: AdminDashboard },
  { id: "settings", label: "Settings", component: AdminSettings },
  { id: "tenants", label: "Tenants", component: AdminTenants },
  { id: "models", label: "AI Models", component: AdminModels },
  { id: "users", label: "Users", component: AdminUsers },
  { id: "shared-kbs", label: "Shared Knowledge Bases", component: AdminSharedKBs },
  { id: "shared-kb-sources", label: "Shared KB Sources", component: AdminSharedKbSources },
  { id: "shared-kb-detail", label: "Shared Knowledge Base", component: SharedKbDetail },
  { id: "admin-analytics", label: "Analytics", component: AdminAnalytics },
  { id: "tenant-settings", label: "Tenant Settings", component: TenantSettings },
  { id: "admin-audit-logs", label: "Audit Logs", component: AdminAuditLogs },
] as const satisfies ReadonlyArray<PageRegistryEntry>;

export type PageId = (typeof pageRegistry)[number]["id"];

export const pageRegistryById = pageRegistry.reduce(
  (acc, entry) => {
    acc[entry.id] = entry;
    return acc;
  },
  {} as Record<PageId, PageRegistryEntry>
);
