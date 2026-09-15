CREATE TABLE "commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"text" text NOT NULL,
	"conditions" jsonb,
	"completion_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"memory_rev" bigint DEFAULT 1 NOT NULL,
	"created_by" text DEFAULT 'human' NOT NULL,
	"resolution" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "commitments_status_check" CHECK ("commitments"."status" in ('open', 'fulfilled', 'cancelled')),
	CONSTRAINT "commitments_memory_rev_check" CHECK ("commitments"."memory_rev" > 0),
	CONSTRAINT "commitments_created_by_check" CHECK ("commitments"."created_by" in ('human', 'agent')),
	CONSTRAINT "commitments_resolution_check" CHECK (("commitments"."status" = 'open' and "commitments"."resolution" is null and "commitments"."resolved_at" is null)
        or ("commitments"."status" <> 'open' and "commitments"."resolution" is not null and "commitments"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "memory_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"project_id" text,
	"subject_revision_id" text NOT NULL,
	"check_id" text,
	"check_rev" bigint,
	"environment" jsonb NOT NULL,
	"result" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"source_id" text,
	"observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_verdict" text,
	"verdict_rev" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "memory_outcomes_kind_check" CHECK ("memory_outcomes"."kind" in ('observation', 'incident')),
	CONSTRAINT "memory_outcomes_result_check" CHECK ("memory_outcomes"."result" in ('pass', 'fail', 'unknown')),
	CONSTRAINT "memory_outcomes_check_pair_check" CHECK (("memory_outcomes"."check_id" is null) = ("memory_outcomes"."check_rev" is null) and ("memory_outcomes"."check_rev" is null or "memory_outcomes"."check_rev" > 0)),
	CONSTRAINT "memory_outcomes_verdict_check" CHECK ("memory_outcomes"."owner_verdict" is null or "memory_outcomes"."owner_verdict" in ('confirmed', 'false_positive')),
	CONSTRAINT "memory_outcomes_verdict_rev_check" CHECK ("memory_outcomes"."verdict_rev" > 0)
);
--> statement-breakpoint
ALTER TABLE "beliefs" ADD COLUMN "checks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_episodes" ADD COLUMN "conditions_predicate" jsonb;--> statement-breakpoint
ALTER TABLE "decision_episodes" ADD COLUMN "exceptions_predicate" jsonb;--> statement-breakpoint
ALTER TABLE "decision_episodes" ADD COLUMN "checks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "valid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "supersedes_id" text;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_outcomes" ADD CONSTRAINT "memory_outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_outcomes" ADD CONSTRAINT "memory_outcomes_subject_revision_id_memory_revisions_id_fk" FOREIGN KEY ("subject_revision_id") REFERENCES "public"."memory_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_outcomes" ADD CONSTRAINT "memory_outcomes_source_id_memory_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."memory_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitments_project_idx" ON "commitments" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "memory_outcomes_occurrence_idx" ON "memory_outcomes" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "memory_outcomes_subject_idx" ON "memory_outcomes" USING btree ("subject_revision_id");--> statement-breakpoint
CREATE INDEX "memory_outcomes_project_idx" ON "memory_outcomes" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_supersedes_id_notes_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_successor_idx" ON "notes" USING btree ("supersedes_id") WHERE status = 'approved' and supersedes_id is not null;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_status_check" CHECK ("notes"."status" in ('proposed', 'approved', 'discarded', 'challenged', 'superseded'));