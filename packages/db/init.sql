-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- Tenant and User Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_unique ON tenants (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenants_deleted_at_idx ON tenants (deleted_at);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  disabled_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (primary_email) WHERE primary_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_identities_issuer_subject_unique ON user_identities (issuer, subject);
CREATE INDEX IF NOT EXISTS user_identities_user_id_idx ON user_identities (user_id);
CREATE INDEX IF NOT EXISTS user_identities_email_idx ON user_identities (email);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_memberships_unique ON tenant_memberships (tenant_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_memberships_user_id_idx ON tenant_memberships (user_id);

CREATE TABLE IF NOT EXISTS system_admins (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('llm', 'embedding', 'auth', 'quotas', 'general')),
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS system_settings_category_idx ON system_settings (category);

-- ============================================================================
-- Knowledge Base Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_global BOOLEAN DEFAULT FALSE NOT NULL,
  published_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS knowledge_bases_tenant_id_idx ON knowledge_bases (tenant_id);
CREATE INDEX IF NOT EXISTS knowledge_bases_is_global_published_idx ON knowledge_bases (is_global, published_at);
CREATE INDEX IF NOT EXISTS knowledge_bases_created_at_idx ON knowledge_bases (created_at);

CREATE TABLE IF NOT EXISTS tenant_kb_subscriptions (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, kb_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_kb_subscriptions_unique ON tenant_kb_subscriptions (tenant_id, kb_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_kb_subscriptions_kb_id_idx ON tenant_kb_subscriptions (kb_id);

CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  enrichment_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sources_tenant_kb_idx ON sources (tenant_id, kb_id);
CREATE INDEX IF NOT EXISTS sources_kb_id_idx ON sources (kb_id);
CREATE INDEX IF NOT EXISTS sources_created_at_idx ON sources (created_at);

CREATE TABLE IF NOT EXISTS source_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  trigger TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  stats JSONB NOT NULL DEFAULT '{"pagesSeen": 0, "pagesIndexed": 0, "pagesFailed": 0, "tokensEstimated": 0}',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS source_runs_source_created_idx ON source_runs (source_id, created_at);
CREATE INDEX IF NOT EXISTS source_runs_tenant_created_idx ON source_runs (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS source_runs_status_idx ON source_runs (status);

CREATE TABLE IF NOT EXISTS source_run_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_run_id UUID NOT NULL REFERENCES source_runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  title TEXT,
  http_status INTEGER,
  content_hash TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS source_run_pages_run_id_idx ON source_run_pages (source_run_id);
CREATE INDEX IF NOT EXISTS source_run_pages_tenant_url_idx ON source_run_pages (tenant_id, normalized_url);

-- ============================================================================
-- Chunks and Embeddings Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS kb_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_run_id UUID REFERENCES source_runs(id) ON DELETE SET NULL,
  normalized_url TEXT,
  title TEXT,
  heading TEXT,
  section_path TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  language TEXT,
  tags TEXT[],
  entities TEXT[],
  keywords TEXT[],
  summary TEXT,
  tsv TSVECTOR,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kb_chunks_tenant_kb_idx ON kb_chunks (tenant_id, kb_id);
CREATE INDEX IF NOT EXISTS kb_chunks_source_idx ON kb_chunks (source_id);
CREATE INDEX IF NOT EXISTS kb_chunks_source_run_idx ON kb_chunks (source_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS kb_chunks_unique ON kb_chunks (tenant_id, source_id, normalized_url, chunk_index, content_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx ON kb_chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES kb_chunks(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS embeddings_tenant_kb_idx ON embeddings (tenant_id, kb_id);
CREATE INDEX IF NOT EXISTS embeddings_chunk_idx ON embeddings (chunk_id);
CREATE INDEX IF NOT EXISTS embeddings_hnsw_idx ON embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  extracted_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS uploads_tenant_kb_idx ON uploads (tenant_id, kb_id);
CREATE INDEX IF NOT EXISTS uploads_source_idx ON uploads (source_id);
CREATE INDEX IF NOT EXISTS uploads_created_at_idx ON uploads (created_at);

-- ============================================================================
-- Agents Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT 'You are a helpful assistant that answers questions based on the provided context.

IMPORTANT RULES:
1. Only answer questions based on the provided context
2. If the context does not contain enough information to answer the question, say "I don''t know based on the provided sources"
3. Always cite your sources with the document title and URL when available
4. Be concise and direct in your answers
5. Do not make up information that is not in the context',
  reranker_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  citations_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agents_tenant_idx ON agents (tenant_id);
CREATE INDEX IF NOT EXISTS agents_created_at_idx ON agents (created_at);

CREATE TABLE IF NOT EXISTS agent_kbs (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (agent_id, kb_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_kbs_unique ON agent_kbs (agent_id, kb_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_kbs_kb_idx ON agent_kbs (kb_id);

CREATE TABLE IF NOT EXISTS agent_widget_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  is_public BOOLEAN DEFAULT TRUE NOT NULL,
  allowed_domains TEXT[] DEFAULT '{}' NOT NULL,
  oidc_required BOOLEAN DEFAULT FALSE NOT NULL,
  theme JSONB NOT NULL DEFAULT '{"primaryColor": "#0066cc", "backgroundColor": "#ffffff", "textColor": "#1a1a1a", "buttonPosition": "bottom-right", "borderRadius": 12}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_widget_configs_agent_unique ON agent_widget_configs (agent_id);

CREATE TABLE IF NOT EXISTS retrieval_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  top_k INTEGER DEFAULT 8 NOT NULL,
  candidate_k INTEGER DEFAULT 40 NOT NULL,
  reranker_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  reranker_type TEXT DEFAULT 'heuristic' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS retrieval_configs_agent_unique ON retrieval_configs (agent_id);

CREATE TABLE IF NOT EXISTS widget_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  name TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS widget_tokens_token_unique ON widget_tokens (token);
CREATE INDEX IF NOT EXISTS widget_tokens_tenant_idx ON widget_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS widget_tokens_agent_idx ON widget_tokens (agent_id);

-- ============================================================================
-- Analytics Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  llm_provider TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  retrieved_chunks INTEGER,
  reranker_used BOOLEAN DEFAULT FALSE,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS chat_events_tenant_started_idx ON chat_events (tenant_id, started_at);
CREATE INDEX IF NOT EXISTS chat_events_agent_started_idx ON chat_events (agent_id, started_at);
CREATE INDEX IF NOT EXISTS chat_events_status_idx ON chat_events (status);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] DEFAULT '{"chat", "read"}' NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_key_prefix_idx ON api_keys (key_prefix);

CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  max_kbs INTEGER DEFAULT 10 NOT NULL,
  max_agents INTEGER DEFAULT 10 NOT NULL,
  max_uploaded_docs_per_month INTEGER DEFAULT 1000 NOT NULL,
  max_scraped_pages_per_month INTEGER DEFAULT 1000 NOT NULL,
  max_crawl_concurrency INTEGER DEFAULT 5 NOT NULL,
  chat_rate_limit_per_minute INTEGER DEFAULT 60 NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  uploaded_docs INTEGER DEFAULT 0 NOT NULL,
  scraped_pages INTEGER DEFAULT 0 NOT NULL,
  chat_requests INTEGER DEFAULT 0 NOT NULL,
  prompt_tokens INTEGER DEFAULT 0 NOT NULL,
  completion_tokens INTEGER DEFAULT 0 NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS tenant_usage_tenant_month_idx ON tenant_usage (tenant_id, month);

CREATE TABLE IF NOT EXISTS deletion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id UUID NOT NULL,
  scheduled_hard_delete_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS deletion_jobs_status_scheduled_idx ON deletion_jobs (status, scheduled_hard_delete_at);
