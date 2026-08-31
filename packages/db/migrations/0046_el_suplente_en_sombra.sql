CREATE TABLE "consultations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"belief_ids" jsonb,
	"status" text DEFAULT 'drafting' NOT NULL,
	"verdict" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"drafted_at" timestamp with time zone,
	"verdict_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultations_project_idx" ON "consultations" USING btree ("project_id","created_at");