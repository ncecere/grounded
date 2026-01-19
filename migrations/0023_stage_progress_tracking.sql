-- Add stage progress tracking columns to source_runs
-- These columns track progress within each stage of the sequential pipeline
ALTER TABLE "source_runs" ADD COLUMN IF NOT EXISTS "stage_total" integer NOT NULL DEFAULT 0;
ALTER TABLE "source_runs" ADD COLUMN IF NOT EXISTS "stage_completed" integer NOT NULL DEFAULT 0;
ALTER TABLE "source_runs" ADD COLUMN IF NOT EXISTS "stage_failed" integer NOT NULL DEFAULT 0;
