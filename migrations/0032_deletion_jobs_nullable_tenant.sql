-- Make deletion_jobs.tenant_id nullable to support:
-- 1. Global/shared KB deletions (no tenant)
-- 2. Tenant self-deletion (avoids cascade issue)
ALTER TABLE deletion_jobs ALTER COLUMN tenant_id DROP NOT NULL;
