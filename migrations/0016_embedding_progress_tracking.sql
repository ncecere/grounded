-- Add embedding progress tracking columns to source_runs
ALTER TABLE "source_runs" ADD COLUMN IF NOT EXISTS "chunks_to_embed" integer DEFAULT 0 NOT NULL;
ALTER TABLE "source_runs" ADD COLUMN IF NOT EXISTS "chunks_embedded" integer DEFAULT 0 NOT NULL;
