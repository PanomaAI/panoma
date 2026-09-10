CREATE TABLE "app_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"identity" text NOT NULL,
	"workspace_id" text,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" jsonb,
	"result" jsonb,
	"error" text,
	"app_version" text NOT NULL,
	"pid" integer,
	"dedupe_key" text NOT NULL,
	"reserved_calls" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_workspaces" (
	"app_id" text NOT NULL,
	"identity" text NOT NULL,
	"workspace_id" text NOT NULL,
	"root_at_creation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_workspaces_app_id_identity_pk" PRIMARY KEY("app_id","identity")
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"pkg" text NOT NULL,
	"version" text,
	"staged_version" text,
	"previous_version" text,
	"protocol" text,
	"status" text DEFAULT 'absent' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"manifest" jsonb,
	"requirements" jsonb,
	"requirements_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{"brain":"none","voice":false}'::jsonb NOT NULL,
	"error" text,
	"installed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "app_job_id" text;--> statement-breakpoint
ALTER TABLE "app_jobs" ADD CONSTRAINT "app_jobs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_workspaces" ADD CONSTRAINT "app_workspaces_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_jobs_identity_idx" ON "app_jobs" USING btree ("identity","requested_at");--> statement-breakpoint
CREATE INDEX "app_jobs_status_idx" ON "app_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "app_jobs_dedupe_live" ON "app_jobs" USING btree ("dedupe_key") WHERE status in ('pending', 'running', 'cancelling');