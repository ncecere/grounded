-- Migration: Populate tsv (tsvector) column for full-text search
-- This enables hybrid search (vector + full-text) for better retrieval

-- Create a function that generates tsvector from chunk content and metadata
-- Weights: A = title/heading (highest), B = keywords/entities, C = content
CREATE OR REPLACE FUNCTION kb_chunks_tsv_trigger() RETURNS trigger AS $$
DECLARE
  keywords_text TEXT;
  entities_text TEXT;
BEGIN
  -- Convert arrays to space-separated strings for tsvector
  keywords_text := COALESCE(array_to_string(NEW.keywords, ' '), '');
  entities_text := COALESCE(array_to_string(NEW.entities, ' '), '');

  -- Build weighted tsvector:
  -- A weight: title, heading (most important for matching)
  -- B weight: keywords, entities (enrichment metadata)
  -- C weight: content (main body text)
  NEW.tsv :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.heading, '')), 'A') ||
    setweight(to_tsvector('english', keywords_text), 'B') ||
    setweight(to_tsvector('english', entities_text), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Create trigger to auto-populate tsv on insert and update
DROP TRIGGER IF EXISTS kb_chunks_tsv_update ON kb_chunks;
CREATE TRIGGER kb_chunks_tsv_update
  BEFORE INSERT OR UPDATE OF content, title, heading, keywords, entities
  ON kb_chunks
  FOR EACH ROW
  EXECUTE FUNCTION kb_chunks_tsv_trigger();

--> statement-breakpoint

-- Backfill existing chunks that have NULL tsv
-- This updates all chunks, triggering the function to populate tsv
UPDATE kb_chunks
SET tsv =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(heading, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(array_to_string(keywords, ' '), '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(array_to_string(entities, ' '), '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(content, '')), 'C')
WHERE tsv IS NULL OR tsv = '';

--> statement-breakpoint

-- Ensure GIN index exists for fast full-text search
CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx ON kb_chunks USING GIN (tsv);
