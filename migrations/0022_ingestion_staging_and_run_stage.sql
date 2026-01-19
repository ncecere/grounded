-- Add ingestion stage tracking for source runs
ALTER TABLE "source_runs" ADD COLUMN IF NOT EXISTS "stage" text;
CREATE INDEX IF NOT EXISTS "source_runs_stage_idx" ON "source_runs" ("stage");

-- Add staging table for extracted page content
CREATE TABLE IF NOT EXISTS "source_run_page_contents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "source_run_id" uuid NOT NULL REFERENCES "source_runs"("id") ON DELETE CASCADE,
  "source_run_page_id" uuid NOT NULL REFERENCES "source_run_pages"("id") ON DELETE CASCADE,
  "normalized_url" text NOT NULL,
  "title" text,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "headings" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "source_run_page_contents_page_unique" ON "source_run_page_contents" ("source_run_page_id");
CREATE INDEX IF NOT EXISTS "source_run_page_contents_run_id_idx" ON "source_run_page_contents" ("source_run_id");
CREATE INDEX IF NOT EXISTS "source_run_page_contents_tenant_url_idx" ON "source_run_page_contents" ("tenant_id", "normalized_url");
