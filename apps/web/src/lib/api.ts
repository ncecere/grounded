// Runtime config injected via config.js at container startup
// In K8s, set API_URL="" so Ingress handles /api routing
// In local dev, set API_URL="http://localhost:3001"
declare global {
  interface Window {
    __GROUNDED_CONFIG__?: { API_URL?: string };
  }
}
const API_BASE = (window.__GROUNDED_CONFIG__?.API_URL || "") + "/api/v1";

// Token storage
const TOKEN_KEY = "grounded_auth_token";
const TENANT_KEY = "grounded_current_tenant";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getCurrentTenantId(): string | null {
  return localStorage.getItem(TENANT_KEY);
}

export function setCurrentTenantId(tenantId: string): void {
  localStorage.setItem(TENANT_KEY, tenantId);
}

export function clearCurrentTenantId(): void {
  localStorage.removeItem(TENANT_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const tenantId = getCurrentTenantId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (tenantId) {
    headers["X-Tenant-ID"] = tenantId;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    if (response.status === 401) {
      clearToken();
    }
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  tenantId: string;
  role: string;
  isSystemAdmin: boolean;
}

export interface SystemSetting {
  key: string;
  value: string | number | boolean;
  category: string;
  isSecret: boolean;
  description: string;
  isConfigured: boolean;
  updatedAt: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount?: number;
}

export interface UserTenant {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface TenantMember {
  userId: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface TenantAlertSettings {
  tenantId: string;
  enabled: boolean;
  notifyOwners: boolean;
  notifyAdmins: boolean;
  additionalEmails: string | null;
  errorRateThreshold: number | null;
  quotaWarningThreshold: number | null;
  inactivityDays: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface KnowledgeBase {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  sourceCount?: number;
  chunkCount?: number;
  isShared?: boolean;
  isGlobal?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  kbId: string;
  name: string;
  type: "web" | "upload" | "api";
  config: Record<string, unknown>;
  status: "active" | "paused" | "error";
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRunStats {
  pagesSeen: number;
  pagesIndexed: number;
  pagesFailed: number;
  tokensEstimated: number;
}

export interface SourceRun {
  id: string;
  sourceId: string;
  tenantId: string;
  status: "pending" | "running" | "partial" | "succeeded" | "failed" | "canceled";
  trigger: "manual" | "scheduled";
  startedAt: string | null;
  finishedAt: string | null;
  stats: SourceRunStats;
  error: string | null;
  createdAt: string;
}

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  welcomeMessage: string | null;
  logoUrl: string | null;
  isEnabled: boolean;
  suggestedQuestions: string[];
  kbIds: string[];
  llmModelConfigId: string | null;
  widgetConfig: {
    id: string;
    agentId: string;
    isPublic: boolean;
    allowedDomains: string[];
    oidcRequired: boolean;
    theme: {
      primaryColor: string;
      backgroundColor: string;
      textColor: string;
      buttonPosition: "bottom-right" | "bottom-left";
      borderRadius: number;
      buttonStyle: "circle" | "pill" | "square";
      buttonSize: "small" | "medium" | "large";
      buttonText: string;
      buttonIcon: "chat" | "help" | "question" | "message";
      buttonColor: string;
      customIconUrl: string | null;
      customIconSize: number | null;
    };
    createdAt: string;
    updatedAt: string;
  } | null;
  retrievalConfig: {
    topK: number;
    candidateK: number;
    maxCitations: number;
    rerankerEnabled: boolean;
    rerankerType: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LLMModel {
  id: string;
  modelId: string;
  displayName: string;
  providerName: string;
  isDefault: boolean;
}

export interface ChatEndpoint {
  id: string;
  name: string | null;
  token: string;
  endpointType: "api" | "hosted";
  createdAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Array<{
    index: number;
    title: string;
    url: string;
    snippet: string;
  }>;
}

export interface AnalyticsData {
  totalQueries: number;
  totalConversations: number;
  avgResponseTime: number;
  topQueries: Array<{ query: string; count: number }>;
  queriesByDay: Array<{ date: string; count: number }>;
}

export interface AuthResponse {
  user: { id: string; email: string };
  token: string;
  token_type: string;
}

// AI Provider Types
export type ProviderType = "openai" | "anthropic" | "google" | "openai-compatible";
export type ModelType = "chat" | "embedding";

export interface ModelProvider {
  id: string;
  name: string;
  displayName: string;
  type: ProviderType;
  baseUrl: string | null;
  apiKey: string; // Will be "***REDACTED***" from API
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelConfiguration {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  modelType: ModelType;
  maxTokens: number | null;
  temperature: string | null;
  supportsStreaming: boolean;
  supportsTools: boolean;
  dimensions: number | null;
  isEnabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  provider?: ModelProvider;
}

export interface RegistryStatus {
  initialized: boolean;
  providerCount: number;
  chatModelCount: number;
  embeddingModelCount: number;
  defaultChatModel: string | null;
  defaultEmbeddingModel: string | null;
  error?: string;
}

export interface AdminUser {
  id: string;
  email: string | null;
  createdAt: string;
  isSystemAdmin: boolean;
  isDisabled: boolean;
  tenantCount: number;
}

export interface AdminUserDetail extends Omit<AdminUser, "tenantCount"> {
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;
}

export interface SharedKnowledgeBase {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  isGlobal: boolean;
  publishedAt: string | null;
  createdBy: string;
  createdAt: string;
  deletedAt: string | null;
  sourceCount: number;
  chunkCount: number;
  shareCount: number;
  isPublished: boolean;
  creatorEmail: string | null;
}

export interface SharedKnowledgeBaseDetail extends SharedKnowledgeBase {
  sharedWithTenants: Array<{
    id: string;
    name: string;
    slug: string;
    sharedAt: string;
  }>;
}

export interface AvailableTenant {
  id: string;
  name: string;
  slug: string;
  isShared: boolean;
}

// Admin Dashboard types
export interface DashboardHealth {
  database: {
    ok: boolean;
    latencyMs?: number;
    message?: string;
  };
  vectorStore: {
    ok: boolean;
    configured: boolean;
    type?: string;
    vectorCount?: number;
    latencyMs?: number;
    message?: string;
  };
  aiProviders: {
    ok: boolean;
    hasChatModel: boolean;
    hasEmbeddingModel: boolean;
    message?: string;
  };
}

export interface DashboardStats {
  users: number;
  tenants: number;
  knowledgeBases: number;
  sources: number;
  chunks: number;
  vectors: number;
  agents: number;
  chatEvents: {
    last24h: number;
    last7d: number;
  };
}

// Admin Analytics Types
export interface AdminAnalyticsOverview {
  overview: {
    totalQueries: number;
    successfulQueries: number;
    errorQueries: number;
    rateLimitedQueries: number;
    errorRate: number;
    avgLatencyMs: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    activeTenants: number;
    activeAgents: number;
  };
  queriesByDay: Array<{
    date: string;
    count: number;
    errors: number;
  }>;
  queriesByChannel: Array<{
    channel: string;
    count: number;
  }>;
  topTenants: Array<{
    tenantId: string;
    tenantName: string;
    queries: number;
    errors: number;
    errorRate: number;
  }>;
}

export type TenantHealthFlag =
  | "high_error_rate"
  | "kb_quota_warning"
  | "agent_quota_warning"
  | "upload_quota_warning"
  | "scrape_quota_warning"
  | "high_rate_limiting"
  | "low_activity";

export interface TenantWithHealth {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  members: number;
  resources: {
    kbs: number;
    agents: number;
    maxKbs: number;
    maxAgents: number;
  };
  usage: {
    totalQueries: number;
    successfulQueries: number;
    errorQueries: number;
    rateLimitedQueries: number;
    errorRate: number;
    avgLatencyMs: number;
    lastQueryAt: string | null;
    uploadedDocs: number;
    scrapedPages: number;
    maxUploadedDocs: number;
    maxScrapedPages: number;
  };
  flags: TenantHealthFlag[];
  healthScore: number;
}

export interface AdminAnalyticsTenants {
  tenants: TenantWithHealth[];
  summary: {
    total: number;
    healthy: number;
    withWarnings: number;
    flagCounts: Record<TenantHealthFlag, number>;
  };
}

// Admin API Tokens
export interface AdminApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdBy: string;
}

export interface AdminApiTokenWithSecret extends AdminApiToken {
  token: string; // Only returned on creation
}

// Tenant API Keys
export interface TenantApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdBy: string;
}

export interface TenantApiKeyWithSecret extends TenantApiKey {
  apiKey: string; // Only returned on creation
}

// Audit Log Types
export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.password_changed"
  | "tenant.created"
  | "tenant.updated"
  | "tenant.deleted"
  | "user.created"
  | "user.updated"
  | "user.disabled"
  | "user.enabled"
  | "user.role_changed"
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  | "agent.enabled"
  | "agent.disabled"
  | "kb.created"
  | "kb.updated"
  | "kb.deleted"
  | "kb.published"
  | "kb.unpublished"
  | "source.created"
  | "source.updated"
  | "source.deleted"
  | "source.run_triggered"
  | "api_key.created"
  | "api_key.revoked"
  | "widget_token.created"
  | "widget_token.revoked"
  | "chat_endpoint.created"
  | "chat_endpoint.revoked"
  | "settings.updated"
  | "model.created"
  | "model.updated"
  | "model.deleted"
  | "provider.created"
  | "provider.updated"
  | "provider.deleted";

export type AuditResourceType =
  | "user"
  | "tenant"
  | "agent"
  | "knowledge_base"
  | "source"
  | "api_key"
  | "widget_token"
  | "chat_endpoint"
  | "settings"
  | "model"
  | "provider"
  | "membership";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string | null;
  tenantId: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  success: boolean;
  errorMessage: string | null;
}

export interface AuditLogResponse {
  logs: Array<AuditLogEntry & { actorEmail: string | null; tenantName: string | null }>;
  total: number;
  hasMore: boolean;
}

export interface AuditLogFilters {
  actions: string[];
  resourceTypes: string[];
  tenants: Array<{ id: string; name: string }>;
}

export interface AuditSummary {
  totalEvents: number;
  byAction: Record<string, number>;
  byResourceType: Record<string, number>;
  failureCount: number;
}

// Tool Types
export type ToolType = "api" | "mcp" | "builtin";

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ApiToolConfig {
  baseUrl: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: {
    type: "none" | "api_key" | "bearer" | "basic" | "custom_header";
    headerName?: string;
    secret?: string;
    username?: string;
  };
  headers?: Record<string, string>;
  bodyTemplate?: string;
  responseFormat?: "json" | "text";
  timeoutMs?: number;
}

export interface McpToolConfig {
  transport: "stdio" | "sse" | "websocket";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  connectionOptions?: Record<string, unknown>;
}

export interface BuiltinToolConfig {
  toolType: "multi_kb_router" | "calculator" | "date_time" | "web_search";
  options?: Record<string, unknown>;
}

export type ToolConfig = ApiToolConfig | McpToolConfig | BuiltinToolConfig;

export interface ToolDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: ToolType;
  config: ToolConfig;
  parameters: ToolParameter[];
  isEnabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCapabilities {
  id: string;
  agentId: string;
  agenticModeEnabled: boolean;
  multiKbRoutingEnabled: boolean;
  toolCallingEnabled: boolean;
  maxToolCallsPerTurn: number;
  multiStepReasoningEnabled: boolean;
  maxReasoningSteps: number;
  showChainOfThought: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTool {
  id: string;
  toolId: string;
  isEnabled: boolean;
  priority: number;
  createdAt: string;
  tool: {
    id: string;
    name: string;
    description: string;
    type: ToolType;
    isEnabled: boolean;
  };
}

export interface BuiltinToolInfo {
  id: string;
  name: string;
  description: string;
  type: "builtin";
  configSchema: BuiltinToolConfig;
  requiresConfig?: boolean;
}

// Chain of Thought Types
export interface ChainOfThoughtStep {
  type: "thinking" | "searching" | "tool_call" | "tool_result" | "answering";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  kbId?: string;
  kbName?: string;
  timestamp: number;
}

export interface AdminAnalyticsTenantDetail {
  tenant: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
  };
  resources: {
    members: number;
    kbs: number;
    agents: number;
    sources: number;
    chunks: number;
  };
  quotas: {
    maxKbs: number;
    maxAgents: number;
    maxUploadedDocsPerMonth: number;
    maxScrapedPagesPerMonth: number;
    chatRateLimitPerMinute: number;
  };
  currentUsage: {
    month: string;
    uploadedDocs: number;
    scrapedPages: number;
    chatRequests: number;
    promptTokens: number;
    completionTokens: number;
  };
  stats: {
    totalQueries: number;
    successfulQueries: number;
    errorQueries: number;
    rateLimitedQueries: number;
    errorRate: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
  };
  queriesByDay: Array<{
    date: string;
    count: number;
    errors: number;
    avgLatency: number;
  }>;
  queriesByChannel: Array<{
    channel: string;
    count: number;
    errors: number;
  }>;
  byAgent: Array<{
    agentId: string;
    agentName: string;
    queries: number;
    errors: number;
    errorRate: number;
    avgLatency: number;
  }>;
  historicalUsage: Array<{
    month: string;
    uploadedDocs: number;
    scrapedPages: number;
    chatRequests: number;
    promptTokens: number;
    completionTokens: number;
  }>;
}

export const api = {
  // Auth
  getMe: () => request<User>("/auth/me"),
  logout: () => {
    clearToken();
    return Promise.resolve();
  },
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(response.token);
    return response;
  },
  register: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(response.token);
    return response;
  },

  // User's tenants (the tenants a user belongs to)
  getMyTenants: () => request<{ tenants: UserTenant[] }>("/auth/tenants"),

  // Admin Tenant Management (System Admin only)
  listAllTenants: () => request<{ tenants: Tenant[] }>("/tenants"),
  createTenant: (data: {
    name: string;
    slug: string;
    ownerEmail?: string;
    quotas?: {
      maxKbs?: number;
      maxAgents?: number;
      maxUploadedDocsPerMonth?: number;
      maxScrapedPagesPerMonth?: number;
      maxCrawlConcurrency?: number;
      chatRateLimitPerMinute?: number;
    };
  }) =>
    request<{ tenant: Tenant }>("/tenants", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getTenant: (id: string) => request<{ tenant: Tenant }>(`/tenants/${id}`),
  updateTenant: (id: string, data: { name?: string }) =>
    request<{ tenant: Tenant }>(`/tenants/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteTenant: (id: string) =>
    request<{ message: string }>(`/tenants/${id}`, { method: "DELETE" }),

  // Tenant Members
  listTenantMembers: (tenantId: string) =>
    request<{ members: TenantMember[] }>(`/tenants/${tenantId}/members`),
  addTenantMember: (tenantId: string, data: { email: string; role: string }) =>
    request<{ message: string; userId: string }>(`/tenants/${tenantId}/members`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTenantMember: (tenantId: string, userId: string, data: { role: string }) =>
    request<{ message: string }>(`/tenants/${tenantId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  removeTenantMember: (tenantId: string, userId: string) =>
    request<{ message: string }>(`/tenants/${tenantId}/members/${userId}`, {
      method: "DELETE",
    }),
  getTenantAlertSettings: (tenantId: string) =>
    request<{ alertSettings: TenantAlertSettings }>(`/tenants/${tenantId}/alert-settings`),
  updateTenantAlertSettings: (
    tenantId: string,
    data: Partial<Omit<TenantAlertSettings, "tenantId" | "createdAt" | "updatedAt">>
  ) =>
    request<{ alertSettings: TenantAlertSettings }>(`/tenants/${tenantId}/alert-settings`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Knowledge Bases
  listKnowledgeBases: async () => {
    const res = await request<{ knowledgeBases: KnowledgeBase[] }>("/knowledge-bases");
    return res.knowledgeBases;
  },
  getKnowledgeBase: async (id: string) => {
    const res = await request<{ knowledgeBase: KnowledgeBase }>(`/knowledge-bases/${id}`);
    return res.knowledgeBase;
  },
  createKnowledgeBase: async (data: { name: string; description?: string; embeddingModelId?: string }) => {
    const res = await request<{ knowledgeBase: KnowledgeBase }>("/knowledge-bases", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.knowledgeBase;
  },
  updateKnowledgeBase: async (id: string, data: { name?: string; description?: string }) => {
    const res = await request<{ knowledgeBase: KnowledgeBase }>(`/knowledge-bases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.knowledgeBase;
  },
  deleteKnowledgeBase: (id: string) =>
    request<void>(`/knowledge-bases/${id}`, { method: "DELETE" }),

  // Sources
  listSources: async (kbId: string) => {
    const res = await request<{ sources: Source[] }>(`/sources/kb/${kbId}`);
    return res.sources;
  },
  getSource: async (_kbId: string, id: string) => {
    const res = await request<{ source: Source }>(`/sources/${id}`);
    return res.source;
  },
  createSource: async (
    kbId: string,
    data: { name: string; type: string; config: Record<string, unknown> }
  ) => {
    const res = await request<{ source: Source }>(`/sources`, {
      method: "POST",
      body: JSON.stringify({ ...data, kbId }),
    });
    return res.source;
  },
  updateSource: async (
    _kbId: string,
    id: string,
    data: { name?: string; config?: Record<string, unknown>; status?: string }
  ) => {
    const res = await request<{ source: Source }>(`/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.source;
  },
  deleteSource: (_kbId: string, id: string) =>
    request<void>(`/sources/${id}`, { method: "DELETE" }),
  triggerSourceRun: async (_kbId: string, id: string, options?: { forceReindex?: boolean }) => {
    const res = await request<{ run: SourceRun }>(`/sources/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ forceReindex: options?.forceReindex ?? false }),
    });
    return res.run;
  },
  listSourceRuns: async (_kbId: string, id: string) => {
    const res = await request<{ runs: SourceRun[] }>(`/sources/${id}/runs`);
    return res.runs;
  },
  getSourceStats: async (_kbId: string, id: string) => {
    const res = await request<{ stats: { pageCount: number; chunkCount: number } }>(`/sources/${id}/stats`);
    return res.stats;
  },

  // Agents
  listAgents: async () => {
    const res = await request<{ agents: Agent[] }>("/agents");
    return res.agents;
  },
  listLLMModels: async () => {
    const res = await request<{ models: LLMModel[] }>("/agents/models");
    return res.models;
  },
  getAgent: async (id: string) => {
    const res = await request<{ agent: Agent }>(`/agents/${id}`);
    return res.agent;
  },
  createAgent: async (data: {
    name: string;
    description?: string;
    systemPrompt: string;
    welcomeMessage?: string;
    suggestedQuestions?: string[];
    kbIds: string[];
    llmModelConfigId?: string;
  }) => {
    const res = await request<{ agent: Agent }>("/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.agent;
  },
  updateAgent: async (
    id: string,
    data: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      welcomeMessage?: string;
      logoUrl?: string | null;
      isEnabled?: boolean;
      suggestedQuestions?: string[];
      kbIds?: string[];
      llmModelConfigId?: string | null;
      widgetConfig?: Record<string, unknown>;
      retrievalConfig?: Record<string, unknown>;
    }
  ) => {
    const res = await request<{ agent: Agent }>(`/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.agent;
  },
  deleteAgent: (id: string) => request<void>(`/agents/${id}`, { method: "DELETE" }),
  getWidgetToken: (id: string) => request<{ token: string }>(`/agents/${id}/widget-token`),
  getWidgetConfig: async (agentId: string) => {
    const res = await request<{ widgetConfig: Agent["widgetConfig"]; tokens: { id: string; name: string; token: string }[] }>(`/agents/${agentId}/widget`);
    return res;
  },
  updateWidgetConfig: async (
    agentId: string,
    data: {
      isPublic?: boolean;
      allowedDomains?: string[];
      oidcRequired?: boolean;
      theme?: {
        primaryColor?: string;
        backgroundColor?: string;
        textColor?: string;
        buttonPosition?: "bottom-right" | "bottom-left";
        borderRadius?: number;
        buttonStyle?: "circle" | "pill" | "square";
        buttonSize?: "small" | "medium" | "large";
        buttonText?: string;
        buttonIcon?: "chat" | "help" | "question" | "message";
        buttonColor?: string;
        customIconUrl?: string | null;
        customIconSize?: number | null;
      };
    }
  ) => {
    const res = await request<{ widgetConfig: Agent["widgetConfig"] }>(`/agents/${agentId}/widget`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.widgetConfig;
  },
  getRetrievalConfig: async (agentId: string) => {
    const res = await request<{ retrievalConfig: Agent["retrievalConfig"] }>(`/agents/${agentId}/retrieval-config`);
    return res.retrievalConfig;
  },
  updateRetrievalConfig: async (
    agentId: string,
    data: {
      topK?: number;
      candidateK?: number;
      maxCitations?: number;
      rerankerEnabled?: boolean;
    }
  ) => {
    const res = await request<{ retrievalConfig: Agent["retrievalConfig"] }>(`/agents/${agentId}/retrieval-config`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.retrievalConfig;
  },

  // Chat Endpoints
  listChatEndpoints: async (agentId: string) => {
    const res = await request<{ chatEndpoints: ChatEndpoint[] }>(`/agents/${agentId}/chat-endpoints`);
    return res.chatEndpoints;
  },
  createChatEndpoint: async (
    agentId: string,
    data: { name?: string; endpointType: "api" | "hosted" }
  ) => {
    const res = await request<{ chatEndpoint: ChatEndpoint }>(`/agents/${agentId}/chat-endpoints`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.chatEndpoint;
  },
  deleteChatEndpoint: (agentId: string, endpointId: string) =>
    request<{ message: string }>(`/agents/${agentId}/chat-endpoints/${endpointId}`, { method: "DELETE" }),

  // Chat
  chat: async (
    agentId: string,
    message: string,
    conversationId?: string
  ): Promise<{ response: string; conversationId: string; citations: ChatMessage["citations"] }> => {
    return request(`/chat/${agentId}`, {
      method: "POST",
      body: JSON.stringify({ message, conversationId }),
    });
  },

  // Streaming Chat
  chatStream: async (
    agentId: string,
    message: string,
    conversationId: string | undefined,
    onChunk: (text: string) => void,
    onDone: (data: { conversationId: string; citations: ChatMessage["citations"] }) => void,
    onError: (error: string) => void,
    onStatus?: (status: { status: string; message?: string; sourcesCount?: number }) => void
  ): Promise<void> => {
    const token = getToken();
    const tenantId = getCurrentTenantId();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) {
      headers["X-Tenant-ID"] = tenantId;
    }

    try {
      const response = await fetch(`${API_BASE}/chat/stream/${agentId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message, conversationId }),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data) {
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "status" && onStatus) {
                  onStatus({
                    status: parsed.status,
                    message: parsed.message,
                    sourcesCount: parsed.sourcesCount,
                  });
                } else if (parsed.type === "text") {
                  onChunk(parsed.content);
                } else if (parsed.type === "done") {
                  onDone({
                    conversationId: parsed.conversationId,
                    citations: parsed.citations,
                  });
                } else if (parsed.type === "error") {
                  onError(parsed.message);
                }
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Stream failed");
    }
  },

  // Agentic Streaming Chat (with tool calling and chain of thought)
  agenticChatStream: async (
    agentId: string,
    message: string,
    conversationId: string | undefined,
    onChunk: (text: string) => void,
    onDone: (data: { 
      conversationId: string; 
      citations: ChatMessage["citations"];
      chainOfThought?: ChainOfThoughtStep[];
      toolCallsCount?: number;
    }) => void,
    onError: (error: string) => void,
    onStatus?: (status: { status: string; message?: string; toolName?: string }) => void,
    onChainOfThought?: (step: ChainOfThoughtStep) => void
  ): Promise<void> => {
    const token = getToken();
    const tenantId = getCurrentTenantId();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) {
      headers["X-Tenant-ID"] = tenantId;
    }

    try {
      const response = await fetch(`${API_BASE}/chat/agentic/${agentId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message, conversationId }),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data) {
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "status" && onStatus) {
                  onStatus({
                    status: parsed.status,
                    message: parsed.message,
                    toolName: parsed.toolName,
                  });
                } else if (parsed.type === "chain_of_thought" && onChainOfThought) {
                  onChainOfThought(parsed.step);
                } else if (parsed.type === "text") {
                  onChunk(parsed.content);
                } else if (parsed.type === "done") {
                  onDone({
                    conversationId: parsed.conversationId,
                    citations: parsed.citations,
                    chainOfThought: parsed.chainOfThought,
                    toolCallsCount: parsed.toolCallsCount,
                  });
                } else if (parsed.type === "error") {
                  onError(parsed.message);
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Stream failed");
    }
  },

  // Analytics
  getAnalytics: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<AnalyticsData>(`/analytics${query ? `?${query}` : ""}`);
  },

  // Uploads
  uploadFile: async (kbId: string, file: File, options?: { sourceName?: string; sourceId?: string }) => {
    const token = getToken();
    const tenantId = getCurrentTenantId();
    const headers: Record<string, string> = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) {
      headers["X-Tenant-ID"] = tenantId;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (options?.sourceName) {
      formData.append("sourceName", options.sourceName);
    }
    if (options?.sourceId) {
      formData.append("sourceId", options.sourceId);
    }
    const response = await fetch(
      `${API_BASE}/uploads/kb/${kbId}`,
      {
        method: "POST",
        body: formData,
        headers,
        credentials: "include",
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Upload failed" }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    return response.json();
  },

  // Admin Settings
  getAdminSettings: (category?: string) =>
    request<{ settings: SystemSetting[] }>(
      `/admin/settings${category ? `?category=${category}` : ""}`
    ),
  getAdminSetting: (key: string) =>
    request<SystemSetting & { exists: boolean }>(`/admin/settings/${key}`),
  updateAdminSetting: (key: string, value: string | number | boolean) =>
    request<{ message: string; key: string }>(`/admin/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  bulkUpdateAdminSettings: (settings: Array<{ key: string; value: string | number | boolean }>) =>
    request<{ message: string; count: number }>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    }),

  // Admin Model Providers
  listProviders: () =>
    request<{ providers: ModelProvider[] }>("/admin/models/providers"),
  getProvider: (id: string) =>
    request<{ provider: ModelProvider & { models: ModelConfiguration[] } }>(`/admin/models/providers/${id}`),
  createProvider: (data: {
    name: string;
    displayName: string;
    type: ProviderType;
    baseUrl?: string | null;
    apiKey: string;
    isEnabled?: boolean;
  }) =>
    request<{ message: string; provider: ModelProvider }>("/admin/models/providers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProvider: (id: string, data: {
    displayName?: string;
    type?: ProviderType;
    baseUrl?: string | null;
    apiKey?: string;
    isEnabled?: boolean;
  }) =>
    request<{ message: string; provider: ModelProvider }>(`/admin/models/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteProvider: (id: string) =>
    request<{ message: string }>(`/admin/models/providers/${id}`, { method: "DELETE" }),
  testProvider: (id: string) =>
    request<{ success: boolean; message: string; modelsFound?: number }>(`/admin/models/providers/${id}/test`, {
      method: "POST",
    }),

  // Admin Model Configurations
  listModels: (params?: { type?: ModelType; providerId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set("type", params.type);
    if (params?.providerId) searchParams.set("providerId", params.providerId);
    const query = searchParams.toString();
    return request<{ models: ModelConfiguration[] }>(`/admin/models/models${query ? `?${query}` : ""}`);
  },
  getModel: (id: string) =>
    request<{ model: ModelConfiguration }>(`/admin/models/models/${id}`),
  createModel: (data: {
    providerId: string;
    modelId: string;
    displayName: string;
    modelType: ModelType;
    maxTokens?: number;
    temperature?: number;
    supportsStreaming?: boolean;
    supportsTools?: boolean;
    dimensions?: number | null;
    isEnabled?: boolean;
    isDefault?: boolean;
  }) =>
    request<{ message: string; model: ModelConfiguration }>("/admin/models/models", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateModel: (id: string, data: {
    displayName?: string;
    maxTokens?: number;
    temperature?: number;
    supportsStreaming?: boolean;
    supportsTools?: boolean;
    dimensions?: number | null;
    isEnabled?: boolean;
    isDefault?: boolean;
  }) =>
    request<{ message: string; model: ModelConfiguration }>(`/admin/models/models/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteModel: (id: string) =>
    request<{ message: string }>(`/admin/models/models/${id}`, { method: "DELETE" }),
  setDefaultModel: (id: string) =>
    request<{ message: string; modelType: ModelType }>(`/admin/models/models/${id}/set-default`, {
      method: "POST",
    }),

  // Registry Status
  getRegistryStatus: () =>
    request<RegistryStatus>("/admin/models/status"),
  refreshRegistry: () =>
    request<{ message: string }>("/admin/models/refresh", { method: "POST" }),

  // Admin Users
  listUsers: () =>
    request<{ users: AdminUser[] }>("/admin/users"),
  getUser: (id: string) =>
    request<AdminUserDetail>(`/admin/users/${id}`),
  createUser: (data: { email: string; password?: string; isSystemAdmin?: boolean }) =>
    request<{ id: string; email: string; isSystemAdmin: boolean }>("/admin/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateUser: (id: string, data: { isSystemAdmin?: boolean; disabled?: boolean }) =>
    request<{ message: string }>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteUser: (id: string) =>
    request<{ message: string }>(`/admin/users/${id}`, { method: "DELETE" }),
  resetUserPassword: (id: string, newPassword: string) =>
    request<{ message: string }>(`/admin/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),

  // Admin Shared Knowledge Bases
  listSharedKbs: () =>
    request<{ knowledgeBases: SharedKnowledgeBase[] }>("/admin/shared-kbs"),
  getSharedKb: (id: string) =>
    request<{ knowledgeBase: SharedKnowledgeBaseDetail }>(`/admin/shared-kbs/${id}`),
  createSharedKb: (data: { name: string; description?: string; embeddingModelId?: string }) =>
    request<{ knowledgeBase: SharedKnowledgeBase }>("/admin/shared-kbs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSharedKb: (id: string, data: { name?: string; description?: string }) =>
    request<{ knowledgeBase: SharedKnowledgeBase }>(`/admin/shared-kbs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteSharedKb: (id: string) =>
    request<{ message: string }>(`/admin/shared-kbs/${id}`, { method: "DELETE" }),
  publishSharedKb: (id: string) =>
    request<{ knowledgeBase: SharedKnowledgeBase; message: string }>(`/admin/shared-kbs/${id}/publish`, {
      method: "POST",
    }),
  unpublishSharedKb: (id: string) =>
    request<{ knowledgeBase: SharedKnowledgeBase; message: string }>(`/admin/shared-kbs/${id}/unpublish`, {
      method: "POST",
    }),
  shareKbWithTenant: (kbId: string, tenantId: string) =>
    request<{ message: string; tenant: { id: string; name: string; slug: string } }>(`/admin/shared-kbs/${kbId}/shares`, {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    }),
  unshareKbFromTenant: (kbId: string, tenantId: string) =>
    request<{ message: string }>(`/admin/shared-kbs/${kbId}/shares/${tenantId}`, {
      method: "DELETE",
    }),
  getAvailableTenants: (kbId: string) =>
    request<{ tenants: AvailableTenant[] }>(`/admin/shared-kbs/${kbId}/available-tenants`),

  // Admin Shared KB Sources
  listSharedKbSources: async (kbId: string) => {
    const res = await request<{ sources: Source[] }>(`/admin/shared-kbs/${kbId}/sources`);
    return res.sources;
  },
  createSharedKbSource: async (
    kbId: string,
    data: { name: string; type: string; config: Record<string, unknown> }
  ) => {
    const res = await request<{ source: Source }>(`/admin/shared-kbs/${kbId}/sources`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.source;
  },
  updateSharedKbSource: async (
    kbId: string,
    sourceId: string,
    data: { name?: string; config?: Record<string, unknown> }
  ) => {
    const res = await request<{ source: Source }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.source;
  },
  deleteSharedKbSource: (kbId: string, sourceId: string) =>
    request<{ message: string }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}`, { method: "DELETE" }),
  triggerSharedKbSourceRun: async (kbId: string, sourceId: string, options?: { forceReindex?: boolean }) => {
    const res = await request<{ run: SourceRun }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}/runs`, {
      method: "POST",
      body: JSON.stringify({ forceReindex: options?.forceReindex ?? false }),
    });
    return res.run;
  },
  listSharedKbSourceRuns: async (kbId: string, sourceId: string) => {
    const res = await request<{ runs: SourceRun[] }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}/runs`);
    return res.runs;
  },
  getSharedKbSourceStats: async (kbId: string, sourceId: string) => {
    const res = await request<{ stats: { pageCount: number; chunkCount: number } }>(`/admin/shared-kbs/${kbId}/sources/${sourceId}/stats`);
    return res.stats;
  },

  // Admin Dashboard
  getDashboardHealth: () =>
    request<DashboardHealth>("/admin/dashboard/health"),
  getDashboardStats: () =>
    request<DashboardStats>("/admin/dashboard/stats"),

  // Email/SMTP Testing
  verifySmtp: () =>
    request<{ success: boolean; message: string }>("/admin/settings/email/verify", {
      method: "POST",
    }),
  sendTestEmail: (email: string) =>
    request<{ success: boolean; message: string }>("/admin/settings/email/test", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  getEmailStatus: () =>
    request<{ configured: boolean }>("/admin/settings/email/status"),

  // Alert Scheduler
  getAlertStatus: () =>
    request<{ schedulerRunning: boolean; lastCheckTime: string | null }>("/admin/settings/alerts/status"),
  runHealthCheck: () =>
    request<{ checked: boolean; tenantsWithIssues: number; alertSent: boolean; error?: string }>("/admin/settings/alerts/check", {
      method: "POST",
    }),
  startAlertScheduler: () =>
    request<{ success: boolean; running: boolean; message: string }>("/admin/settings/alerts/start", {
      method: "POST",
    }),
  stopAlertScheduler: () =>
    request<{ success: boolean; running: boolean; message: string }>("/admin/settings/alerts/stop", {
      method: "POST",
    }),

  // Admin Analytics
  getAdminAnalyticsOverview: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<AdminAnalyticsOverview>(`/admin/analytics/overview${query ? `?${query}` : ""}`);
  },
  getAdminAnalyticsTenants: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<AdminAnalyticsTenants>(`/admin/analytics/tenants${query ? `?${query}` : ""}`);
  },
  getAdminAnalyticsTenantDetail: (tenantId: string, params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<AdminAnalyticsTenantDetail>(`/admin/analytics/tenants/${tenantId}${query ? `?${query}` : ""}`);
  },
  exportAdminAnalyticsOverview: (params?: { startDate?: string; endDate?: string }) => {
    const token = getToken();
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return fetch(`${API_BASE}/admin/analytics/export/overview${query ? `?${query}` : ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
  exportAdminAnalyticsTenants: () => {
    const token = getToken();
    return fetch(`${API_BASE}/admin/analytics/export/tenants`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },

  // Admin API Tokens
  listAdminTokens: () =>
    request<{ tokens: AdminApiToken[] }>("/admin/tokens"),
  createAdminToken: (data: { name: string; expiresAt?: string }) =>
    request<AdminApiTokenWithSecret>("/admin/tokens", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  revokeAdminToken: (id: string) =>
    request<{ message: string }>(`/admin/tokens/${id}`, { method: "DELETE" }),

  // Tenant API Keys
  listTenantApiKeys: (tenantId: string) =>
    request<{ apiKeys: TenantApiKey[] }>(`/tenants/${tenantId}/api-keys`),
  createTenantApiKey: (tenantId: string, data: { name: string; scopes?: string[]; expiresAt?: string }) =>
    request<TenantApiKeyWithSecret>(`/tenants/${tenantId}/api-keys`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  revokeTenantApiKey: (tenantId: string, keyId: string) =>
    request<{ message: string }>(`/tenants/${tenantId}/api-keys/${keyId}`, { method: "DELETE" }),

  // Admin Audit Logs
  listAuditLogs: (params?: {
    tenantId?: string;
    actorId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.tenantId) searchParams.set("tenantId", params.tenantId);
    if (params?.actorId) searchParams.set("actorId", params.actorId);
    if (params?.action) searchParams.set("action", params.action);
    if (params?.resourceType) searchParams.set("resourceType", params.resourceType);
    if (params?.resourceId) searchParams.set("resourceId", params.resourceId);
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    return request<AuditLogResponse>(`/admin/audit${query ? `?${query}` : ""}`);
  },
  getAuditLog: (id: string) =>
    request<{ log: AuditLogEntry & { actorEmail: string | null; tenantName: string | null } }>(`/admin/audit/${id}`),
  getAuditLogFilters: () =>
    request<AuditLogFilters>("/admin/audit/filters/options"),
  getResourceAuditHistory: (resourceType: string, resourceId: string) =>
    request<{ logs: Array<AuditLogEntry & { actorEmail: string | null }> }>(`/admin/audit/resource/${resourceType}/${resourceId}`),
  getAuditSummary: (tenantId: string, days?: number) => {
    const params = days ? `?days=${days}` : "";
    return request<{ summary: AuditSummary }>(`/admin/audit/summary/${tenantId}${params}`);
  },

  // Tools
  listTools: () =>
    request<{ tools: ToolDefinition[] }>("/tools"),
  getTool: (id: string) =>
    request<{ tool: ToolDefinition }>(`/tools/${id}`),
  createTool: (data: {
    name: string;
    description: string;
    type: ToolType;
    config: ToolConfig;
    parameters?: ToolParameter[];
    isEnabled?: boolean;
  }) =>
    request<{ tool: ToolDefinition }>("/tools", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTool: (id: string, data: {
    name?: string;
    description?: string;
    config?: ToolConfig;
    parameters?: ToolParameter[];
    isEnabled?: boolean;
  }) =>
    request<{ tool: ToolDefinition }>(`/tools/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteTool: (id: string) =>
    request<{ message: string }>(`/tools/${id}`, { method: "DELETE" }),
  listBuiltinTools: () =>
    request<{ tools: BuiltinToolInfo[] }>("/tools/builtin"),

  // Agent Capabilities
  getAgentCapabilities: (agentId: string) =>
    request<{ capabilities: AgentCapabilities }>(`/tools/agents/${agentId}/capabilities`),
  updateAgentCapabilities: (agentId: string, data: {
    agenticModeEnabled?: boolean;
    multiKbRoutingEnabled?: boolean;
    toolCallingEnabled?: boolean;
    maxToolCallsPerTurn?: number;
    multiStepReasoningEnabled?: boolean;
    maxReasoningSteps?: number;
    showChainOfThought?: boolean;
  }) =>
    request<{ capabilities: AgentCapabilities }>(`/tools/agents/${agentId}/capabilities`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Agent Tools
  listAgentTools: (agentId: string) =>
    request<{ tools: AgentTool[] }>(`/tools/agents/${agentId}/tools`),
  attachToolToAgent: (agentId: string, data: {
    toolId: string;
    isEnabled?: boolean;
    priority?: number;
  }) =>
    request<{ agentTool: AgentTool }>(`/tools/agents/${agentId}/tools`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  detachToolFromAgent: (agentId: string, toolId: string) =>
    request<{ message: string }>(`/tools/agents/${agentId}/tools/${toolId}`, { method: "DELETE" }),
};
