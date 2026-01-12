-- Create chat_endpoint_tokens table for public chat API and hosted chat endpoints
CREATE TABLE IF NOT EXISTS "chat_endpoint_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token" text NOT NULL,
	"name" text,
	"endpoint_type" text DEFAULT 'api' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);

-- Foreign key constraints
DO $$ BEGIN
 ALTER TABLE "chat_endpoint_tokens" ADD CONSTRAINT "chat_endpoint_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "chat_endpoint_tokens" ADD CONSTRAINT "chat_endpoint_tokens_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "chat_endpoint_tokens" ADD CONSTRAINT "chat_endpoint_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "chat_endpoint_tokens_token_unique" ON "chat_endpoint_tokens" USING btree ("token");
CREATE INDEX IF NOT EXISTS "chat_endpoint_tokens_tenant_idx" ON "chat_endpoint_tokens" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "chat_endpoint_tokens_agent_idx" ON "chat_endpoint_tokens" USING btree ("agent_id");
