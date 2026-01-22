export interface SystemSetting {
  key: string;
  value: string | number | boolean;
  category: string;
  isSecret: boolean;
  description: string;
  isConfigured: boolean;
  updatedAt: string | null;
}

export interface FairnessMetrics {
  activeRunCount: number;
  totalSlotsInUse: number;
  totalSlotsAvailable: number;
  runSlots: Record<string, number>;
  fairSharePerRun: number;
  timestamp: string;
}

export type ProviderType = "openai" | "anthropic" | "google" | "openai-compatible";
export type ModelType = "chat" | "embedding";

export interface ModelProvider {
  id: string;
  name: string;
  displayName: string;
  type: ProviderType;
  baseUrl: string | null;
  apiKey: string;
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
  token: string;
}

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
