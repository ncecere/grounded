// =============================================================================
// User & Authentication Types
// =============================================================================

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  tenantId: string;
  role: string;
  isSystemAdmin: boolean;
}

export interface AuthResponse {
  user: { id: string; email: string };
  token: string;
  token_type: string;
}

// =============================================================================
// Tenant & Membership Types
// =============================================================================

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

// =============================================================================
// Knowledge Base & Source Types
// =============================================================================

export interface KnowledgeBase {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  sourceCount?: number;
  chunkCount?: number;
  isShared?: boolean;
  isGlobal?: boolean;
  // Embedding model info
  embeddingModelId?: string | null;
  embeddingDimensions?: number;
  // Reindex tracking
  reindexStatus?: "pending" | "in_progress" | "failed" | null;
  reindexProgress?: number | null;
  reindexError?: string | null;
  pendingEmbeddingModelId?: string | null;
  pendingEmbeddingDimensions?: number | null;
  reindexStartedAt?: string | null;
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
  lastRunStatus?: string | null;
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

export type SourceRunStage = "discovering" | "scraping" | "processing" | "indexing" | "embedding" | "completed";

export interface SourceRun {
  id: string;
  sourceId: string;
  tenantId: string | null;
  status: "pending" | "running" | "partial" | "succeeded" | "failed" | "canceled";
  stage: SourceRunStage | null;
  trigger: "manual" | "scheduled";
  startedAt: string | null;
  finishedAt: string | null;
  stats: SourceRunStats;
  // Stage progress tracking
  stageTotal: number;
  stageCompleted: number;
  stageFailed: number;
  // Legacy chunk tracking (still used for embedding stage)
  chunksToEmbed: number;
  chunksEmbedded: number;
  error: string | null;
  createdAt: string;
}

// =============================================================================
// Agent & Chat Types
// =============================================================================

export type RagType = "simple" | "advanced";

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  welcomeMessage: string | null;
  logoUrl: string | null;
  isEnabled: boolean;
  ragType: RagType;
  showReasoningSteps: boolean;
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
    similarityThreshold: number;
    historyTurns: number;
    advancedMaxSubqueries: number;
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
    url?: string;
    snippet: string;
  }>;
}

// =============================================================================
// Test Suite Types
// =============================================================================

export interface ContainsPhrasesCheck {
  type: "contains_phrases";
  phrases: string[];
  caseSensitive?: boolean;
}

export interface SemanticSimilarityCheck {
  type: "semantic_similarity";
  expectedAnswer: string;
  threshold: number;
}

export interface LlmJudgeCheck {
  type: "llm_judge";
  expectedAnswer: string;
  criteria?: string;
}

export type ExpectedCheck = ContainsPhrasesCheck | SemanticSimilarityCheck | LlmJudgeCheck;

export interface ExpectedBehavior {
  checks: ExpectedCheck[];
  mode: "all" | "any";
}

export interface CheckResult {
  checkIndex: number;
  checkType: "contains_phrases" | "semantic_similarity" | "llm_judge";
  passed: boolean;
  details: {
    matchedPhrases?: string[];
    missingPhrases?: string[];
    similarityScore?: number;
    threshold?: number;
    judgement?: string;
    reasoning?: string;
  };
}

export interface TestSuiteRunSummary {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  passRate: number;
  completedAt: string | null;
}

export interface TestSuite {
  id: string;
  agentId: string;
  name: string;
  description: string | null;
  scheduleType: "manual" | "hourly" | "daily" | "weekly";
  scheduleTime: string | null;
  scheduleDayOfWeek: number | null;
  llmJudgeModelConfigId: string | null;
  alertOnRegression: boolean;
  alertThresholdPercent: number;
  // Prompt analysis & A/B testing
  promptAnalysisEnabled: boolean;
  abTestingEnabled: boolean;
  analysisModelConfigId: string | null;
  manualCandidatePrompt: string | null;
  isEnabled: boolean;
  testCaseCount: number;
  lastRun: TestSuiteRunSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseResultSummary {
  status: "passed" | "failed" | "skipped" | "error";
  runId: string;
  createdAt: string;
}

export interface TestCase {
  id: string;
  suiteId: string;
  name: string;
  description: string | null;
  question: string;
  expectedBehavior: ExpectedBehavior;
  sortOrder: number;
  isEnabled: boolean;
  lastResult: TestCaseResultSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestSuiteRun {
  id: string;
  suiteId: string;
  suiteName: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  triggeredBy: "manual" | "schedule";
  triggeredByUser: { id: string; name: string } | null;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skippedCases: number;
  passRate: number;
  systemPrompt?: string | null;
  promptVariant?: "baseline" | "candidate" | null;
  experimentId?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface TestCaseResult {
  id: string;
  testCaseId: string;
  testCaseName: string;
  question: string;
  status: "passed" | "failed" | "skipped" | "error";
  actualResponse: string | null;
  checkResults: CheckResult[];
  durationMs: number | null;
  errorMessage: string | null;
}

export interface TestRunWithResults extends TestSuiteRun {
  results: TestCaseResult[];
}

export interface TestSuiteRunAnalytics {
  runs: Array<{
    date: string;
    passRate: number;
    totalRuns: number;
  }>;
  averagePassRate: number;
  totalRuns: number;
  regressions: number;
}

export interface TestSuiteAnalyticsSummary {
  totalSuites: number;
  totalCases: number;
  totalRuns: number;
  overallPassRate: number;
}

export interface TestSuiteAnalyticsAgent {
  agentId: string;
  agentName: string;
  suiteCount: number;
  caseCount: number;
  runCount: number;
  passRate: number;
  previousPassRate: number | null;
  passRateChange: number | null;
  trend?: "up" | "down" | "stable" | "unknown";
  lastRunAt?: string | null;
  lastRunStatus?: "pending" | "running" | "completed" | "failed" | "cancelled";
}

export interface TestSuiteAnalyticsRegression {
  runId: string;
  suiteId: string;
  suiteName: string;
  agentId: string | null;
  agentName: string;
  completedAt: string;
  previousPassRate: number;
  currentPassRate: number;
  passRateDrop: number;
}

export interface TestSuiteAnalytics {
  summary: TestSuiteAnalyticsSummary;
  passRateOverTime: Array<{
    date: string;
    passRate: number;
    totalRuns: number;
  }>;
  agents: TestSuiteAnalyticsAgent[];
  recentRegressions: TestSuiteAnalyticsRegression[];
}

export interface CreateTestSuiteDto {
  name: string;
  description?: string;
  scheduleType?: "manual" | "hourly" | "daily" | "weekly";
  scheduleTime?: string;
  scheduleDayOfWeek?: number;
  llmJudgeModelConfigId?: string;
  alertOnRegression?: boolean;
  alertThresholdPercent?: number;
}

export interface UpdateTestSuiteDto extends Partial<CreateTestSuiteDto> {
  isEnabled?: boolean;
  promptAnalysisEnabled?: boolean;
  abTestingEnabled?: boolean;
  analysisModelConfigId?: string | null;
  manualCandidatePrompt?: string | null;
}

export interface CreateTestCaseDto {
  name: string;
  description?: string;
  question: string;
  expectedBehavior: ExpectedBehavior;
  sortOrder?: number;
}

export interface UpdateTestCaseDto extends Partial<CreateTestCaseDto> {
  isEnabled?: boolean;
}

// =============================================================================
// Prompt Analysis & A/B Experiment Types
// =============================================================================

export interface FailureCluster {
  category: string;
  description: string;
  affectedCases: string[];
  suggestedFix: string;
}

export interface PromptAnalysis {
  id: string;
  suiteId: string;
  runId: string;
  experimentId: string | null;
  modelConfigId: string | null;
  summary: string | null;
  failureClusters: FailureCluster[] | null;
  suggestedPrompt: string | null;
  rationale: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export type ExperimentStatus =
  | "pending"
  | "baseline_running"
  | "analyzing"
  | "candidate_running"
  | "completed"
  | "failed";

export interface Experiment {
  id: string;
  suiteId: string;
  baselineRunId: string | null;
  candidateRunId: string | null;
  status: ExperimentStatus;
  candidateSource: "analysis" | "manual" | null;
  candidatePrompt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ExperimentRunStats {
  runId: string;
  passRate: number;
  passedCases: number;
  failedCases: number;
  totalCases: number;
  systemPrompt: string | null;
}

export interface ExperimentComparison {
  experiment: Experiment;
  baseline: ExperimentRunStats | null;
  candidate: ExperimentRunStats | null;
  delta: {
    passRate: number;
    passedCases: number;
    failedCases: number;
  } | null;
}

export interface StartRunResponse {
  id: string;
  experimentId?: string;
  status: "started" | "queued";
  message: string;
  isExperiment: boolean;
}

// =============================================================================
// Reasoning Types (for Advanced RAG)
// =============================================================================

export type ReasoningStepType = "rewrite" | "plan" | "search" | "merge" | "generate";
export type ReasoningStepStatus = "pending" | "in_progress" | "completed" | "error";

/**
 * Represents a single step in the advanced RAG reasoning process
 */
export interface ReasoningStep {
  id: string;
  type: ReasoningStepType;
  title: string;
  summary: string;
  status: ReasoningStepStatus;
  details?: Record<string, unknown>;
}

// =============================================================================
// AI Provider & Model Types
// =============================================================================

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

// =============================================================================
// Admin Types
// =============================================================================

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

// =============================================================================
// Admin Dashboard Types
// =============================================================================

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

// =============================================================================
// Admin Analytics Types
// =============================================================================

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

// =============================================================================
// API Token Types
// =============================================================================

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

// =============================================================================
// Audit Log Types
// =============================================================================

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

// =============================================================================
// Tool Types
// =============================================================================

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
  tenantId: string | null;
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

// =============================================================================
// Analytics Types
// =============================================================================

export interface AnalyticsData {
  totalQueries: number;
  totalConversations: number;
  avgResponseTime: number;
  topQueries: Array<{ query: string; count: number }>;
  queriesByDay: Array<{ date: string; count: number }>;
}
