/*
 * The app's vocabulary (D8), in one place so the sidebar, page titles,
 * breadcrumbs and tables agree. Use these instead of typing the words:
 *
 *   import { terms, audienceLabel, switchLabel } from "@/lib/terms";
 *   <PageHeader title={terms.discoverAgents} />
 *
 * Rules:
 *   - "Passages" in UI text, never "chunks" (the API still says chunks).
 *   - Switchable objects (agents, models, connections, keys, public access)
 *     are Enabled / Disabled. Lifecycle states are Active / Retired /
 *     Archived / Suspended (teams, users, versions).
 *   - The authenticated audience is "Signed-in users".
 */
import type { Schemas } from "../api/client";

export const terms = {
  /** The agent directory (workspace sidebar, /agents). */
  discoverAgents: "Discover agents",
  conversations: "Conversations",
  home: "Home",
  teamSettings: "Team settings",
  /** Admin → Crawl domains (allowlist and domain requests). */
  crawlDomains: "Crawl domains",
  domainRequests: "Domain requests",
  logs: "Logs",
  auditLog: "Audit log",
  accessLog: "Access log",
  adminOverview: "Overview",
  /** A searchable piece of a document (the API's "chunk"). */
  passage: "passage",
  passages: "passages",
  Passages: "Passages",
  dangerZone: "Danger zone",
  readOnly: "Read-only",
  systemOneModel: "SystemOne model",
  /** Admin → SSO groups (route /admin/group-mapping): IdP group → team role rules. */
  groupMapping: "SSO groups",
} as const;

/** On a member whose membership an SSO group mapping rule manages. */
export const managedBySso = (group: string) => `Managed by SSO group ${group}`;

type Audience = Schemas["Audience"];

/** Short audience names for tables, badges and tabs. */
export const audienceLabels: Record<Audience, string> = {
  team: "Team",
  all_authenticated: "Signed-in users",
  public: "Public",
};

export const audienceLabel = (a: Audience) => audienceLabels[a];

/** A switchable object's state. */
export const switchLabel = (enabled: boolean) => (enabled ? "Enabled" : "Disabled");

export type Lifecycle = "active" | "retired" | "archived" | "suspended";

/** A lifecycle state's label. */
export const lifecycleLabels: Record<Lifecycle, string> = {
  active: "Active",
  retired: "Retired",
  archived: "Archived",
  suspended: "Suspended",
};

/** "1 passage", "12 passages". */
export const passagesCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? terms.passage : terms.passages}`;

/** The read-only note on admin settings pages (auditors see them, only admins change them). */
export const adminOnly = "You can view these settings. Only platform admins can change them.";
