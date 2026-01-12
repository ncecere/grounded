CREATE TABLE IF NOT EXISTS "tenant_alert_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_owners" boolean DEFAULT true NOT NULL,
	"notify_admins" boolean DEFAULT false NOT NULL,
	"additional_emails" text,
	"error_rate_threshold" integer,
	"quota_warning_threshold" integer,
	"inactivity_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_alert_settings" ADD CONSTRAINT "tenant_alert_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
