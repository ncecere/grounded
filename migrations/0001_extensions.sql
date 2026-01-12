-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Note: vector extension is now on the separate postgres-vector database
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create tsvector update function
CREATE OR REPLACE FUNCTION kb_chunks_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.heading, '') || ' ' ||
    coalesce(NEW.section_path, '') || ' ' ||
    NEW.content
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
