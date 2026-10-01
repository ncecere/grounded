/* Human-readable audit actions, action groups (areas) and actors. */
import type { Schemas } from "../../api/client";
import type { FacetOption } from "@/components/ui/filter-bar/filter-bar";

type AuditEntry = Schemas["AuditEntry"];

const actionLabels: Record<string, string> = {
  "agent.create": "Created agent",
  "agent.update": "Changed agent draft",
  "agent.answer_cache_update": "Changed saved answers settings",
  "agent.answer_cache_clear": "Cleared saved answers",
  "agent.publish": "Published agent",
  "agent.revert": "Reverted agent draft",
  "agent.status": "Changed agent status",
  "agent.delete": "Deleted agent",
  "agent.policy_violation": "Refused answer (policy)",
  "agent.publishable_key_create": "Created widget key",
  "agent.publishable_key_update": "Changed widget key",
  "agent.publishable_key_revoke": "Revoked widget key",
  "agent.publishable_key_pepper_rehash": "Re-hashed widget key with the new pepper",
  "agent.short_name": "Changed agent short name",
  "apikey.create": "Created API key",
  "apikey.revoke": "Revoked API key",
  "apikey.contact_change": "Changed API key contact",
  "apikey.pepper_rehash": "Re-hashed API key with the new pepper",
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.login_denied": "Sign-in denied",
  "breakglass.start": "Started break-glass",
  "breakglass.approve": "Approved break-glass",
  "breakglass.deny": "Denied break-glass",
  "breakglass.cancel": "Withdrew break-glass request",
  "breakglass.end": "Ended break-glass",
  "breakglass.expire": "Break-glass expired",
  "breakglass.request_expire": "Break-glass request lapsed",
  "breakglass.read": "Read under break-glass",
  "platform.break_glass_settings_update": "Changed break-glass settings",
  "crawl.allowlist_add": "Allowed crawl domain",
  "crawl.allowlist_remove": "Removed allowed domain",
  "crawl.allowlist_seed": "Seeded crawl allowlist",
  "crawl.domain_request": "Requested crawl domain",
  "crawl.domain_review": "Reviewed domain request",
  "crawl.domain_withdraw": "Withdrew domain request",
  "demo.seed": "Seeded the demo",
  "demo.owner_provision": "Created the demo owner's account",
  "document.upload": "Uploaded documents",
  "document.delete": "Deleted document",
  "document.tags": "Changed document tags",
  "document.retry_bulk": "Retried documents that need OCR",
  "kb.create": "Created knowledge base",
  "legal_hold.create": "Placed legal hold",
  "legal_hold.release": "Released legal hold",
  "kb.update": "Changed knowledge base",
  "kb.delete": "Deleted knowledge base",
  "kb.source_attach": "Attached data source",
  "kb.source_detach": "Detached data source",
  "kb.profile_migration_start": "Started embedding profile migration",
  "kb.profile_migration_cancel": "Cancelled embedding profile migration",
  "kb.profile_migration_retry": "Retried profile migration documents",
  "kb.profile_switch": "Switched embedding profile",
  "kb.profile_switch_back": "Switched back to previous embedding profile",
  "kb.profile_migration_finish": "Deleted old vectors early",
  "kb.profile_migration_complete": "Deleted old vectors after grace period",
  "limits.platform_update": "Changed platform limits",
  "limits.team_update": "Changed team limits",
  "costs.settings_update": "Changed cost settings",
  "costs.price_add": "Added prices",
  "costs.price_delete": "Deleted a price",
  "costs.budget_update": "Changed a team budget",
  "costs.extension_grant": "Granted a budget extension",
  "platform.bootstrap_role": "Granted first admin role",
  "platform.classification_create": "Added classification level",
  "platform.classification_update": "Changed classification level",
  "platform.connection_create": "Added model connection",
  "platform.connection_update": "Changed model connection",
  "platform.connection_delete": "Deleted model connection",
  "platform.model_create": "Added model",
  "platform.model_update": "Changed model",
  "platform.model_delete": "Deleted model",
  "platform.moderation_policy_update": "Changed moderation policy",
  "platform.public_access": "Changed public access",
  "platform.maintenance_start": "Turned on maintenance mode",
  "platform.maintenance_update": "Changed maintenance mode",
  "platform.maintenance_end": "Turned off maintenance mode",
  "platform.key_rotation": "Rotated keys",
  "platform.secrets_reencrypt": "Re-encrypted stored secrets",
  "platform.systemone_settings_update": "Changed SystemOne settings",
  "platform.parsing_settings_update": "Changed parsing settings",
  "platform.documents_retry": "Retried failed documents (admin)",
  "platform.document_owners_notify": "Told owners about failed documents",
  "platform.embedding_profile_create": "Added embedding profile",
  "platform.embedding_profile_update": "Changed embedding profile",
  "platform.embedding_profile_delete": "Deleted embedding profile",
  "platform.user_update": "Changed user",
  "platform.user_role_change": "Changed platform role",
  "platform.user_suspend": "Suspended user",
  "platform.user_reactivate": "Reactivated user",
  "retention.settings_update": "Changed retention periods",
  "retention.run_request": "Ran retention now",
  "retention.purge": "Retention deleted expired data",
  "source.create": "Created data source",
  "source.update": "Changed data source",
  "source.classification_change": "Changed source classification",
  "source.boilerplate_update": "Changed repeated-block settings",
  "source.delete": "Deleted data source",
  "source.sync": "Started sync",
  "source.sync_cancel": "Cancelled sync",
  "team.create": "Created team",
  "team.update": "Changed team",
  "team.archive": "Archived team",
  "team.unarchive": "Unarchived team",
  "team.member_add": "Added member",
  "team.member_remove": "Removed member",
  "team.member_leave": "Left team",
  "team.member_role_change": "Changed member role",
  "team.owner_assign": "Assigned owner",
  "team.sso_last_owner_kept": "Kept last owner (SSO group mapping)",
  "platform.sso_rule_create": "Added SSO group rule",
  "platform.sso_rule_update": "Changed SSO group rule",
  "platform.sso_rule_delete": "Deleted SSO group rule",
  "platform.evaluations": "Turned evaluations on or off",
  "platform.mcp": "Turned the MCP server on or off",
  "platform.answer_cache": "Turned saved answers on or off",
  "platform.mcp_oauth": "Turned OAuth sign-in for MCP clients on or off",
  "oauth.consent": "Connected an app",
  "oauth.token_issue": "App signed in",
  "oauth.revoke": "Disconnected an app",
  "oauth.client_register": "App registered itself",
  "mcp.search": "Searched over MCP",
  "mcp.ask": "Asked an agent over MCP",
  "mcp.tool_call": "An agent called an MCP tool",
  "mcp_server.create": "Added MCP server",
  "mcp_server.update": "Changed MCP server",
  "mcp_server.delete": "Deleted MCP server",
  "mcp_server.refresh": "Refreshed MCP server tools",
  "mcp_tool.approve": "Approved MCP tool",
  "mcp_tool.unapprove": "Withdrew approval of MCP tool",
  "evaluation.set_create": "Created evaluation set",
  "evaluation.set_update": "Changed evaluation set",
  "evaluation.set_delete": "Deleted evaluation set",
  "evaluation.question_create": "Added evaluation question",
  "evaluation.question_update": "Changed evaluation question",
  "evaluation.question_delete": "Deleted evaluation question",
  "evaluation.questions_import": "Imported evaluation questions",
  "evaluation.run_start": "Started evaluation run",
  "evaluation.run_cancel": "Cancelled evaluation run",
  "gap_topic.dismiss": "Dismissed gap topic",
  "gap_topic.fix": "Marked gap topic fixed",
  "gap_topic.add_source": "Went to add a source for a gap topic",
  "gap_topic.add_to_evaluations": "Added a shared question to evaluations",
  "team.invite_create": "Invited member",
  "team.invite_revoke": "Revoked invite",
  "team.invite_accept": "Accepted invite",
};

type Obj = Record<string, unknown>;

/** Actions whose entry says which way they went ("Turned evaluations off"), by their recorded after (and metadata). */
const directedLabels: Record<string, (after: Obj, meta: Obj) => string | undefined> = {
  "platform.evaluations": (a) => (typeof a.enabled === "boolean" ? `Turned evaluations ${a.enabled ? "on" : "off"}` : undefined),
  "platform.mcp": (a) => (typeof a.enabled === "boolean" ? `Turned the MCP server ${a.enabled ? "on" : "off"}` : undefined),
  "platform.answer_cache": (a) => (typeof a.enabled === "boolean" ? `Turned saved answers ${a.enabled ? "on" : "off"}` : undefined),
  "platform.mcp_oauth": (a) => (typeof a.oauthEnabled === "boolean" ? `Turned OAuth sign-in for MCP clients ${a.oauthEnabled ? "on" : "off"}` : undefined),
};

/** Actions whose label follows their metadata: why a connection ended, a refresh, a tool call that wasn't made. */
const metadataLabels: Record<string, (meta: Obj) => string | undefined> = {
  "oauth.revoke": (m) =>
    ({
      admin: "Disconnected a person's app",
      client: m.token === "access" ? "App signed out one token" : "App disconnected itself",
      refresh_reuse: "Connection revoked: a refresh token was reused (possible theft)",
    })[String(m.reason)],
  "oauth.token_issue": (m) => (m.grantType === "refresh_token" ? "App renewed its sign-in" : undefined),
  "mcp.tool_call": (m) => {
    if (m.outcome === "ok") return undefined;
    const why = { call_limit: "call limit", budget: "budget used up" }[String(m.reason)];
    if (m.outcome === "refused") return `An agent's MCP tool call was refused${why ? ` (${why})` : ""}`;
    return typeof m.outcome === "string" ? `An agent's MCP tool call failed (${m.outcome.replace(/_/g, " ")})` : undefined;
  },
};

const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * "Published agent" for agent.publish; unknown actions are spelled out ("foo.bar_baz" → "Foo: bar baz"). With the
 * entry, a switch says which way it went ("Turned evaluations off", not "…on or off"), and some actions say what
 * happened ("App renewed its sign-in", "An agent's MCP tool call was refused (call limit)").
 */
export function actionLabel(action: string, entry?: Pick<AuditEntry, "after"> & Partial<Pick<AuditEntry, "metadata">>) {
  const after = isObj(entry?.after) ? entry.after : undefined;
  const meta = isObj(entry?.metadata) ? entry.metadata : {};
  const directed = (after && directedLabels[action]?.(after, meta)) ?? metadataLabels[action]?.(meta);
  if (directed) return directed;
  const known = actionLabels[action];
  if (known) return known;
  const [group = "", rest = ""] = action.split(".");
  const words = rest.replace(/_/g, " ");
  return `${group.charAt(0).toUpperCase()}${group.slice(1)}${words ? `: ${words}` : ""}`;
}

/**
 * Action groups for the filter; `platform` groups are only offered in the
 * platform log. "group_mapping.", "mcp_clients." and "agent_tools." aren't
 * prefixes: the API reads the first as the group mapping rules' changes and
 * the memberships they made, "mcp_clients." as what AI tools did over the MCP
 * server (mcp. without mcp.tool_call) and "agent_tools." as agents' MCP tool
 * calls with the MCP servers' and tools' changes (mcp.tool_call, mcp_server.,
 * mcp_tool.).
 */
export const actionGroups: { prefix: string; label: string; platform?: boolean }[] = [
  { prefix: "agent.", label: "Agents" },
  { prefix: "apikey.", label: "API keys" },
  { prefix: "source.", label: "Data sources" },
  { prefix: "document.", label: "Documents" },
  { prefix: "kb.", label: "Knowledge bases" },
  { prefix: "team.", label: "Team and members" },
  { prefix: "crawl.", label: "Crawling" },
  { prefix: "limits.", label: "Limits" },
  { prefix: "costs.", label: "Costs" },
  { prefix: "evaluation.", label: "Evaluations" },
  { prefix: "gap_topic.", label: "Gaps" },
  { prefix: "group_mapping.", label: "SSO groups" },
  { prefix: "breakglass.", label: "Break-glass" },
  { prefix: "mcp_clients.", label: "MCP server: AI tools' searches and questions" },
  { prefix: "agent_tools.", label: "Agents' MCP tools: calls, servers and approvals" },
  { prefix: "oauth.", label: "Connected apps and OAuth sign-in", platform: true },
  { prefix: "platform.", label: "Platform settings", platform: true },
  { prefix: "auth.", label: "Sign-in", platform: true },
  { prefix: "legal_hold.", label: "Legal holds", platform: true },
  { prefix: "retention.", label: "Retention", platform: true },
];

const areaLabel = (prefix: string) => actionGroups.find((g) => g.prefix === prefix)?.label;

/** The area an action belongs to, by its code's group (the SSO rules' own changes are under SSO groups). */
export function areaOf(action: string): string | undefined {
  if (action.startsWith("platform.sso_rule_")) return areaLabel("group_mapping.");
  if (action === "mcp.tool_call" || action.startsWith("mcp_server.") || action.startsWith("mcp_tool.")) return areaLabel("agent_tools.");
  if (action.startsWith("mcp.")) return areaLabel("mcp_clients.");
  return actionGroups.find((g) => g.prefix !== "group_mapping." && action.startsWith(g.prefix))?.label;
}

/**
 * The audit log's Area filter: every area, then every known action under its area, so typing "budget" finds "Changed
 * a team budget". An area's value is its prefix ("costs."), an action's its code; the API takes both. `hideCosts`: for
 * editors, whose log has no cost entries (they don't see the team's spend).
 */
export function areaOptions(platform: boolean, { hideCosts = false } = {}): FacetOption[] {
  const areas = actionGroups.filter((g) => (platform || !g.platform) && !(hideCosts && g.prefix === "costs."));
  const shown = new Set(areas.map((g) => g.label));
  const actions = Object.entries(actionLabels)
    .map(([value, label]) => ({ value, label, group: areaOf(value) }))
    .filter((o): o is FacetOption & { group: string } => Boolean(o.group && shown.has(o.group)))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  return [...areas.map((g) => ({ value: g.prefix, label: `${g.label} (all)`, group: "Areas" })), ...actions];
}

/** The Person filter's entry for the memberships SSO group mapping rules made at sign-in (the API's actorKind). */
export const groupMappingPerson = "system:group_mapping";
export const groupMappingPersonOption: FacetOption = { value: groupMappingPerson, label: "System (group mapping)" };

/** The Person filter's value as API filters: a person's ID, or the group mapping rules as the actor. */
export function personFilter(value: string | undefined): { actorUserId?: string; actorKind?: "group_mapping" } {
  if (!value) return {};
  return value === groupMappingPerson ? { actorKind: "group_mapping" } : { actorUserId: value };
}

/**
 * Who did it: a person's name, the API key, or "System". With the entry, a
 * membership a group mapping rule made says so: "System (group mapping:
 * advising-staff → Academic Advising)".
 */
export function actorName(actor: AuditEntry["actor"], entry?: Pick<AuditEntry, "metadata" | "teamName">) {
  if (actor.kind === "system") {
    if (entry?.metadata.via !== "sso_group_rule") return "System";
    const group = typeof entry.metadata.group === "string" ? entry.metadata.group : "";
    const rule = group && entry.teamName ? `${group} → ${entry.teamName}` : group;
    return rule ? `System (group mapping: ${rule})` : "System (group mapping)";
  }
  return actor.displayName || actor.email || (actor.userId ? "Unknown user" : "Unknown");
}

/** How the person acted, in words ("Signed in", "API key: Help desk bot", "Connected app: Example Assistant"); "" for the system. */
export function viaLabel(via: AuditEntry["via"]) {
  if (!via) return "";
  const named = (what: string) => (via.name ? `${what}: ${via.name}` : what);
  return via.kind === "api_key" ? named("API key") : via.kind === "oauth" ? named("Connected app") : "Signed in";
}

type ActedFields = Pick<AuditEntry, "actor" | "metadata"> & Partial<Pick<AuditEntry, "via">>;

/**
 * How the person acted, when it wasn't in the app: "API key: Nightly sync" or "Connected app: Research Assistant".
 * From the entry's via when the server sent it, else from older entries' actor and metadata. Undefined otherwise.
 */
export function actedVia(e: ActedFields): string | undefined {
  if (e.via) return e.via.kind === "api_key" || e.via.kind === "oauth" ? viaLabel(e.via) : undefined;
  if (e.actor.kind === "api_key") return `API key${e.actor.apiKeyName ? `: ${e.actor.apiKeyName}` : ""}`;
  if (e.metadata.via === "oauth") return `Connected app${typeof e.metadata.oauthClient === "string" && e.metadata.oauthClient ? `: ${e.metadata.oauthClient}` : ""}`;
  return undefined;
}

/** The same for the record page's How row: a person without a key or an app acted in the app. */
export function actedHow(e: ActedFields): string | undefined {
  if (e.via) return viaLabel(e.via) || undefined;
  return actedVia(e) ?? (e.actor.kind === "user" ? "Signed in" : undefined);
}

export const targetTypeLabels: Record<string, string> = {
  agent: "Agent",
  api_key: "API key",
  break_glass_session: "Break-glass session",
  break_glass_settings: "Break-glass settings",
  conversation: "Conversation",
  classification: "Classification",
  crawl_allowlist: "Allowed domain",
  crawl_domain_request: "Domain request",
  cost_settings: "Cost settings",
  data_source: "Data source",
  document: "Document",
  embedding_profile: "Embedding profile",
  knowledge_base: "Knowledge base",
  legal_hold: "Legal hold",
  maintenance_mode: "Maintenance mode",
  mcp_settings: "MCP server setting",
  answer_cache_settings: "Saved answers setting",
  mcp_server: "MCP server",
  mcp_tool: "MCP tool",
  oauth_grant: "Connected app",
  oauth_client: "Registered app",
  model: "Model",
  model_connection: "Model connection",
  moderation_policy: "Moderation policy",
  parsing_settings: "Parsing settings",
  platform_keys: "Key rotation",
  platform_limits: "Platform limits",
  platform_settings: "Platform setting",
  publishable_key: "Widget key",
  retention: "Retention run",
  retention_settings: "Retention settings",
  sso_group_rule: "SSO group rule",
  evaluation_run: "Evaluation run",
  evaluation_set: "Evaluation set",
  evaluation_settings: "Evaluations setting",
  systemone_settings: "SystemOne settings",
  team: "Team",
  team_invite: "Invite",
  user: "User",
};

/** Target types that are a platform setting: an entry's action names it ("Turned OAuth sign-in for MCP clients on"). */
const settingsTargets = new Set(["mcp_settings", "answer_cache_settings"]);

/**
 * An entry's action and target in one line for a short list ("Changed a team budget: QA Team"), leaving out a target
 * the action already names ("Turned evaluations off", not "…: Evaluations").
 */
export function entryTitle(e: Pick<AuditEntry, "action" | "after" | "targetLabel"> & Partial<Pick<AuditEntry, "metadata" | "targetType">>) {
  const action = actionLabel(e.action, e);
  // A setting's label ("MCP server") names the settings record, which the action already says in its own words.
  if (e.targetType && settingsTargets.has(e.targetType)) return action;
  return e.targetLabel && !action.toLowerCase().includes(e.targetLabel.toLowerCase()) ? `${action}: ${e.targetLabel}` : action;
}


export const targetTypeLabel = (type: string) => targetTypeLabels[type] ?? type.replace(/_/g, " ");

const uuidRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A before/after value with known ids named, for the audit diff:
 * "chatModelId": "GPT-OSS 120B (9f3c1a2b…)" instead of a bare UUID. Unknown
 * ids and every other value are left as they are.
 */
export function nameIds(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    const name = uuidRE.test(value) ? names.get(value.toLowerCase()) : undefined;
    return name ? `${name} (${value.slice(0, 8)}…)` : value;
  }
  if (Array.isArray(value)) return value.map((v) => nameIds(v, names));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, nameIds(v, names)]));
  return value;
}
