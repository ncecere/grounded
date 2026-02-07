-- Allow legacy public token plaintext columns to be nulled after hash backfill.
-- Runtime backfill/redaction handles copying data into token_hash/token_prefix first.

ALTER TABLE "widget_tokens"
  ALTER COLUMN "token" DROP NOT NULL;

ALTER TABLE "chat_endpoint_tokens"
  ALTER COLUMN "token" DROP NOT NULL;

