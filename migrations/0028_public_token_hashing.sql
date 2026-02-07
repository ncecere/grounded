-- Add hashed token support for public widget/chat endpoint tokens.
-- This enables secure token lookup using deterministic HMAC hashes while
-- retaining legacy plaintext-token compatibility during migration.

ALTER TABLE "widget_tokens"
  ADD COLUMN IF NOT EXISTS "token_hash" text,
  ADD COLUMN IF NOT EXISTS "token_prefix" text;

ALTER TABLE "chat_endpoint_tokens"
  ADD COLUMN IF NOT EXISTS "token_hash" text,
  ADD COLUMN IF NOT EXISTS "token_prefix" text;

-- Backfill token prefixes for existing rows to support constant-time fallback
-- checks without full table scans.
UPDATE "widget_tokens"
SET "token_prefix" = left("token", 12)
WHERE "token" IS NOT NULL
  AND ("token_prefix" IS NULL OR "token_prefix" = '');

UPDATE "chat_endpoint_tokens"
SET "token_prefix" = left("token", 12)
WHERE "token" IS NOT NULL
  AND ("token_prefix" IS NULL OR "token_prefix" = '');

DROP INDEX IF EXISTS "widget_tokens_token_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "widget_tokens_token_unique"
  ON "widget_tokens" USING btree ("token")
  WHERE "token" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "widget_tokens_token_hash_unique"
  ON "widget_tokens" USING btree ("token_hash")
  WHERE "token_hash" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "widget_tokens_prefix_idx"
  ON "widget_tokens" USING btree ("token_prefix");

DROP INDEX IF EXISTS "chat_endpoint_tokens_token_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "chat_endpoint_tokens_token_unique"
  ON "chat_endpoint_tokens" USING btree ("token")
  WHERE "token" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "chat_endpoint_tokens_token_hash_unique"
  ON "chat_endpoint_tokens" USING btree ("token_hash")
  WHERE "token_hash" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "chat_endpoint_tokens_prefix_idx"
  ON "chat_endpoint_tokens" USING btree ("token_prefix");

