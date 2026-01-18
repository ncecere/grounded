ALTER TABLE source_run_pages
ADD COLUMN IF NOT EXISTS current_stage TEXT;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS source_run_pages_current_stage_idx
  ON source_run_pages (current_stage);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS source_run_page_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  source_run_page_id UUID NOT NULL REFERENCES source_run_pages(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS source_run_page_stages_page_stage_unique
  ON source_run_page_stages (source_run_page_id, stage);

CREATE INDEX IF NOT EXISTS source_run_page_stages_page_id_idx
  ON source_run_page_stages (source_run_page_id);

CREATE INDEX IF NOT EXISTS source_run_page_stages_status_idx
  ON source_run_page_stages (status);

CREATE INDEX IF NOT EXISTS source_run_page_stages_stage_status_idx
  ON source_run_page_stages (stage, status);

--> statement-breakpoint

ALTER TABLE source_run_page_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY source_run_page_stages_isolation ON source_run_page_stages
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );
