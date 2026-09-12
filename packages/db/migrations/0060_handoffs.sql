CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"cwd" text NOT NULL,
	"title" text,
	"source_agent" text NOT NULL,
	"source_session_id" text NOT NULL,
	"source_path" text NOT NULL,
	"source_hash" text NOT NULL,
	"target_agent" text NOT NULL,
	"target_session_id" text NOT NULL,
	"target_path" text NOT NULL,
	"tier" text NOT NULL,
	"turns" integer NOT NULL,
	"bytes" integer NOT NULL,
	"dropped" jsonb DEFAULT '{"thinking":0,"images":0,"subagents":0,"offloaded":0,"secrets":0,"other":0}'::jsonb NOT NULL,
	"resume_command" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoffs_project_idx" ON "handoffs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "handoffs_source_idx" ON "handoffs" USING btree ("source_hash","target_agent");