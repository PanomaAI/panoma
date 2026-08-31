CREATE TABLE "design_fingerprints" (
	"project_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"identity" text NOT NULL,
	"source" text NOT NULL,
	"session_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"category" text,
	"quote" text NOT NULL,
	"context" text,
	"signals" jsonb NOT NULL,
	"accepted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_fingerprints" ADD CONSTRAINT "design_fingerprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verdicts_identity_idx" ON "verdicts" USING btree ("identity","created_at");--> statement-breakpoint
CREATE INDEX "verdicts_accepted_idx" ON "verdicts" USING btree ("accepted");