ALTER TABLE uploads
  ALTER COLUMN tenant_id DROP NOT NULL;

--> statement-breakpoint

DROP INDEX IF EXISTS uploads_tenant_kb_idx;
CREATE INDEX IF NOT EXISTS uploads_tenant_kb_idx
  ON uploads (tenant_id, kb_id);
