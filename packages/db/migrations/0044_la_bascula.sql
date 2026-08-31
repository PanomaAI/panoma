CREATE TABLE "servings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"arm" text NOT NULL,
	"note_ids" jsonb NOT NULL,
	"note_chars" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servings" ADD CONSTRAINT "servings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servings" ADD CONSTRAINT "servings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "servings_project_idx" ON "servings" USING btree ("project_id","at");