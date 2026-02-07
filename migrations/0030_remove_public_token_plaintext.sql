-- Remove plaintext public token columns after hash migration cutover.
-- Guard clause prevents dropping columns if active tokens are still missing hash metadata.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "widget_tokens"
    WHERE "revoked_at" IS NULL
      AND ("token_hash" IS NULL OR "token_prefix" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Cannot drop widget_tokens.token: active rows missing token_hash/token_prefix';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "chat_endpoint_tokens"
    WHERE "revoked_at" IS NULL
      AND ("token_hash" IS NULL OR "token_prefix" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Cannot drop chat_endpoint_tokens.token: active rows missing token_hash/token_prefix';
  END IF;
END
$$;

DROP INDEX IF EXISTS "widget_tokens_token_unique";
DROP INDEX IF EXISTS "chat_endpoint_tokens_token_unique";

ALTER TABLE "widget_tokens"
  DROP COLUMN IF EXISTS "token";

ALTER TABLE "chat_endpoint_tokens"
  DROP COLUMN IF EXISTS "token";
