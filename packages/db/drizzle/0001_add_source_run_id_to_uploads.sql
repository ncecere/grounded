-- Add source_run_id column to uploads table
ALTER TABLE "uploads" ADD COLUMN "source_run_id" uuid REFERENCES "source_runs"("id") ON DELETE SET NULL;
