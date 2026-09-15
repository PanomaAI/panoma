CREATE TABLE "memory_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"harness" text NOT NULL,
	"entrypoint" text NOT NULL,
	"recipient_key" text NOT NULL,
	"native_session_key" text,
	"agent_id" text,
	"generation" bigint DEFAULT 1 NOT NULL,
	"rev" bigint DEFAULT 1 NOT NULL,
	"lifecycle_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_contexts_generation_check" CHECK ("memory_contexts"."generation" > 0),
	CONSTRAINT "memory_contexts_rev_check" CHECK ("memory_contexts"."rev" > 0)
);
--> statement-breakpoint
CREATE TABLE "memory_deletions" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"operation" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"targets" jsonb NOT NULL,
	"progress" jsonb NOT NULL,
	"rev" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "memory_deletions_sequence_check" CHECK ("memory_deletions"."sequence" > 0),
	CONSTRAINT "memory_deletions_rev_check" CHECK ("memory_deletions"."rev" > 0),
	CONSTRAINT "memory_deletions_operation_check" CHECK ("memory_deletions"."operation" in ('baseline', 'withdraw', 'purge')),
	CONSTRAINT "memory_deletions_state_check" CHECK ("memory_deletions"."state" in ('pending', 'cleaning', 'complete', 'failed')),
	CONSTRAINT "memory_deletions_complete_check" CHECK ("memory_deletions"."state" <> 'complete' or "memory_deletions"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "memory_dependencies" (
	"id" text PRIMARY KEY NOT NULL,
	"dependency_key" text NOT NULL,
	"dependent_revision_id" text,
	"dependent_serving_id" text,
	"input_revision_id" text,
	"input_source_id" text,
	"input_from" bigint,
	"input_to" bigint,
	"relation" text NOT NULL,
	"group_no" integer DEFAULT 0 NOT NULL,
	"group_mode" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_dependencies_dependent_check" CHECK (("memory_dependencies"."dependent_revision_id" is not null)::int + ("memory_dependencies"."dependent_serving_id" is not null)::int = 1),
	CONSTRAINT "memory_dependencies_input_check" CHECK (("memory_dependencies"."input_revision_id" is not null)::int + ("memory_dependencies"."input_source_id" is not null)::int = 1),
	CONSTRAINT "memory_dependencies_range_check" CHECK (("memory_dependencies"."input_source_id" is null and "memory_dependencies"."input_from" is null and "memory_dependencies"."input_to" is null)
        or ("memory_dependencies"."input_source_id" is not null and ("memory_dependencies"."input_from" is null or ("memory_dependencies"."input_from" >= 0 and ("memory_dependencies"."input_to" is null or "memory_dependencies"."input_to" > "memory_dependencies"."input_from"))))),
	CONSTRAINT "memory_dependencies_relation_check" CHECK ("memory_dependencies"."relation" in ('derived_from', 'supported_by', 'exception', 'counterexample')),
	CONSTRAINT "memory_dependencies_group_check" CHECK ("memory_dependencies"."group_no" >= 0 and "memory_dependencies"."group_mode" in ('all', 'any'))
);
--> statement-breakpoint
CREATE TABLE "memory_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"object_id" text NOT NULL,
	"rev" bigint NOT NULL,
	"previous_id" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_ref" text,
	"authority" text NOT NULL,
	"disposition" text NOT NULL,
	"payload" jsonb,
	"payload_hash" text,
	"coverage" text DEFAULT 'complete' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "memory_revisions_rev_check" CHECK ("memory_revisions"."rev" > 0),
	CONSTRAINT "memory_revisions_schema_version_check" CHECK ("memory_revisions"."schema_version" = 1),
	CONSTRAINT "memory_revisions_scope_kind_check" CHECK ("memory_revisions"."scope_kind" in ('global', 'project', 'unresolved')),
	CONSTRAINT "memory_revisions_scope_ref_check" CHECK ("memory_revisions"."scope_kind" <> 'project' or "memory_revisions"."scope_ref" is not null),
	CONSTRAINT "memory_revisions_coverage_check" CHECK ("memory_revisions"."coverage" in ('complete', 'baseline_only')),
	CONSTRAINT "memory_revisions_payload_check" CHECK (("memory_revisions"."purged_at" is null and "memory_revisions"."payload" is not null and "memory_revisions"."payload_hash" is not null)
        or ("memory_revisions"."purged_at" is not null and "memory_revisions"."payload" is null and "memory_revisions"."payload_hash" is null))
);
--> statement-breakpoint
CREATE TABLE "memory_source_cursors" (
	"source_id" text NOT NULL,
	"purpose" text NOT NULL,
	"grant_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"grant_generation" bigint NOT NULL,
	"allowed_from" bigint NOT NULL,
	"allowed_to" bigint,
	"next_byte" bigint NOT NULL,
	"parser_version" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"rev" bigint DEFAULT 1 NOT NULL,
	"lease_token" text,
	"lease_until" timestamp with time zone,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_from" bigint,
	"blocked_to" bigint,
	CONSTRAINT "memory_source_cursors_source_id_purpose_grant_id_scope_key_pk" PRIMARY KEY("source_id","purpose","grant_id","scope_key"),
	CONSTRAINT "memory_source_cursors_grant_generation_check" CHECK ("memory_source_cursors"."grant_generation" > 0),
	CONSTRAINT "memory_source_cursors_range_check" CHECK ("memory_source_cursors"."allowed_from" >= 0 and ("memory_source_cursors"."allowed_to" is null or "memory_source_cursors"."allowed_to" > "memory_source_cursors"."allowed_from")),
	CONSTRAINT "memory_source_cursors_next_check" CHECK ("memory_source_cursors"."next_byte" >= "memory_source_cursors"."allowed_from" and ("memory_source_cursors"."allowed_to" is null or "memory_source_cursors"."next_byte" <= "memory_source_cursors"."allowed_to")),
	CONSTRAINT "memory_source_cursors_state_check" CHECK ("memory_source_cursors"."state" in ('pending', 'active', 'blocked', 'complete', 'revoked')),
	CONSTRAINT "memory_source_cursors_rev_check" CHECK ("memory_source_cursors"."rev" > 0),
	CONSTRAINT "memory_source_cursors_lease_check" CHECK (("memory_source_cursors"."lease_token" is null) = ("memory_source_cursors"."lease_until" is null)),
	CONSTRAINT "memory_source_cursors_blocked_check" CHECK ("memory_source_cursors"."blocked_to" is null or ("memory_source_cursors"."blocked_from" is not null and "memory_source_cursors"."blocked_to" > "memory_source_cursors"."blocked_from"))
);
--> statement-breakpoint
CREATE TABLE "memory_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_key" text NOT NULL,
	"generation" bigint NOT NULL,
	"previous_id" text,
	"harness" text NOT NULL,
	"entrypoint" text NOT NULL,
	"native_session_key" text,
	"locator" text,
	"file_identity" jsonb,
	"anchor_hash" text,
	"origin" text DEFAULT 'unknown' NOT NULL,
	"origin_key" text,
	"parent_stream_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "memory_sources_generation_check" CHECK ("memory_sources"."generation" > 0),
	CONSTRAINT "memory_sources_origin_check" CHECK ("memory_sources"."origin" in ('native', 'copy', 'unknown')),
	CONSTRAINT "memory_sources_status_check" CHECK ("memory_sources"."status" in ('active', 'replaced', 'blocked', 'purged')),
	CONSTRAINT "memory_sources_purged_check" CHECK ("memory_sources"."purged_at" is null or ("memory_sources"."locator" is null and "memory_sources"."file_identity" is null and "memory_sources"."anchor_hash" is null))
);
--> statement-breakpoint
CREATE TABLE "serving_events" (
	"id" text PRIMARY KEY NOT NULL,
	"serving_id" text NOT NULL,
	"event_kind" text NOT NULL,
	"event_key" text,
	"source_id" text,
	"byte_offset" bigint,
	"result" text NOT NULL,
	"details" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serving_events_kind_check" CHECK ("serving_events"."event_kind" in ('attempt', 'reception')),
	CONSTRAINT "serving_events_result_check" CHECK (("serving_events"."event_kind" = 'attempt' and "serving_events"."result" in ('sent', 'failed', 'unknown'))
        or ("serving_events"."event_kind" = 'reception' and "serving_events"."result" in ('full', 'partial', 'unknown', 'not_observed'))),
	CONSTRAINT "serving_events_offset_check" CHECK ("serving_events"."byte_offset" is null or "serving_events"."byte_offset" >= 0)
);
--> statement-breakpoint
ALTER TABLE "servings" DROP CONSTRAINT "servings_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "servings" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "beliefs" ADD COLUMN "memory_rev" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "beliefs" ADD COLUMN "scope_kind" text DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "beliefs" ADD COLUMN "delivery_mode" text DEFAULT 'contextual' NOT NULL;--> statement-breakpoint
ALTER TABLE "beliefs" ADD COLUMN "delivery_policy_rev" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_episodes" ADD COLUMN "memory_rev" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_episodes" ADD COLUMN "scope_kind" text DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "memory_rev" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "schema_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "context_id" text;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "context_generation" bigint;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "rendered" text;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "rendered_hash" text;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "serialized_bytes" bigint;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "unit_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "policy_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "servings" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_contexts" ADD CONSTRAINT "memory_contexts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_contexts" ADD CONSTRAINT "memory_contexts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_dependencies" ADD CONSTRAINT "memory_dependencies_dependent_revision_id_memory_revisions_id_fk" FOREIGN KEY ("dependent_revision_id") REFERENCES "public"."memory_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_dependencies" ADD CONSTRAINT "memory_dependencies_dependent_serving_id_servings_id_fk" FOREIGN KEY ("dependent_serving_id") REFERENCES "public"."servings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_dependencies" ADD CONSTRAINT "memory_dependencies_input_revision_id_memory_revisions_id_fk" FOREIGN KEY ("input_revision_id") REFERENCES "public"."memory_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_dependencies" ADD CONSTRAINT "memory_dependencies_input_source_id_memory_sources_id_fk" FOREIGN KEY ("input_source_id") REFERENCES "public"."memory_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_previous_id_memory_revisions_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."memory_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_source_cursors" ADD CONSTRAINT "memory_source_cursors_source_id_memory_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."memory_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_previous_id_memory_sources_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."memory_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serving_events" ADD CONSTRAINT "serving_events_serving_id_servings_id_fk" FOREIGN KEY ("serving_id") REFERENCES "public"."servings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serving_events" ADD CONSTRAINT "serving_events_source_id_memory_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."memory_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_contexts_project_idx" ON "memory_contexts" USING btree ("project_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_contexts_lifecycle_idx" ON "memory_contexts" USING btree ("lifecycle_key") WHERE lifecycle_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_deletions_journal_idx" ON "memory_deletions" USING btree ("journal_id","sequence");--> statement-breakpoint
CREATE INDEX "memory_deletions_state_idx" ON "memory_deletions" USING btree ("state","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_dependencies_key_idx" ON "memory_dependencies" USING btree ("dependency_key");--> statement-breakpoint
CREATE INDEX "memory_dependencies_input_revision_idx" ON "memory_dependencies" USING btree ("input_revision_id");--> statement-breakpoint
CREATE INDEX "memory_dependencies_input_source_idx" ON "memory_dependencies" USING btree ("input_source_id");--> statement-breakpoint
CREATE INDEX "memory_dependencies_dependent_revision_idx" ON "memory_dependencies" USING btree ("dependent_revision_id");--> statement-breakpoint
CREATE INDEX "memory_dependencies_dependent_serving_idx" ON "memory_dependencies" USING btree ("dependent_serving_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_revisions_object_rev_idx" ON "memory_revisions" USING btree ("kind","object_id","rev");--> statement-breakpoint
CREATE INDEX "memory_revisions_object_idx" ON "memory_revisions" USING btree ("kind","object_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_revisions_scope_idx" ON "memory_revisions" USING btree ("scope_kind","scope_ref","created_at");--> statement-breakpoint
CREATE INDEX "memory_source_cursors_purpose_idx" ON "memory_source_cursors" USING btree ("purpose","state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_sources_stream_idx" ON "memory_sources" USING btree ("stream_key","generation");--> statement-breakpoint
CREATE INDEX "memory_sources_status_idx" ON "memory_sources" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "serving_events_serving_idx" ON "serving_events" USING btree ("serving_id","observed_at");--> statement-breakpoint
CREATE INDEX "serving_events_source_idx" ON "serving_events" USING btree ("source_id","byte_offset");--> statement-breakpoint
CREATE UNIQUE INDEX "serving_events_event_key_idx" ON "serving_events" USING btree ("event_key") WHERE event_key is not null;--> statement-breakpoint
ALTER TABLE "servings" ADD CONSTRAINT "servings_context_id_memory_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."memory_contexts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servings" ADD CONSTRAINT "servings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "servings_context_idx" ON "servings" USING btree ("context_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "servings_request_key_idx" ON "servings" USING btree ("request_key") WHERE request_key is not null;--> statement-breakpoint
-- The rows that predate the word keep the meaning the schema gave them: a null identity was
-- "every project" and a non-null one was that project. Written down as a baseline, never invented.
UPDATE "beliefs" SET "scope_kind" = CASE WHEN "identity" IS NULL THEN 'global' ELSE 'project' END;--> statement-breakpoint
UPDATE "decision_episodes" SET "scope_kind" = CASE WHEN "identity" IS NULL THEN 'global' ELSE 'project' END;--> statement-breakpoint
ALTER TABLE "beliefs" ADD CONSTRAINT "beliefs_memory_rev_check" CHECK ("beliefs"."memory_rev" > 0);--> statement-breakpoint
ALTER TABLE "beliefs" ADD CONSTRAINT "beliefs_delivery_policy_rev_check" CHECK ("beliefs"."delivery_policy_rev" > 0);--> statement-breakpoint
ALTER TABLE "beliefs" ADD CONSTRAINT "beliefs_scope_kind_check" CHECK ("beliefs"."scope_kind" in ('global', 'project', 'unresolved'));--> statement-breakpoint
ALTER TABLE "beliefs" ADD CONSTRAINT "beliefs_scope_identity_check" CHECK (("beliefs"."scope_kind" <> 'global' or "beliefs"."identity" is null) and ("beliefs"."scope_kind" <> 'project' or "beliefs"."identity" is not null));--> statement-breakpoint
ALTER TABLE "beliefs" ADD CONSTRAINT "beliefs_delivery_mode_check" CHECK ("beliefs"."delivery_mode" in ('core', 'contextual'));--> statement-breakpoint
ALTER TABLE "decision_episodes" ADD CONSTRAINT "decision_episodes_memory_rev_check" CHECK ("decision_episodes"."memory_rev" > 0);--> statement-breakpoint
ALTER TABLE "decision_episodes" ADD CONSTRAINT "decision_episodes_scope_kind_check" CHECK ("decision_episodes"."scope_kind" in ('global', 'project', 'unresolved'));--> statement-breakpoint
ALTER TABLE "decision_episodes" ADD CONSTRAINT "decision_episodes_scope_identity_check" CHECK (("decision_episodes"."scope_kind" <> 'global' or "decision_episodes"."identity" is null) and ("decision_episodes"."scope_kind" <> 'project' or "decision_episodes"."identity" is not null));--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_memory_rev_check" CHECK ("notes"."memory_rev" > 0);--> statement-breakpoint
ALTER TABLE "servings" ADD CONSTRAINT "servings_schema_version_check" CHECK ("servings"."schema_version" in (0, 2));--> statement-breakpoint
ALTER TABLE "servings" ADD CONSTRAINT "servings_serialized_bytes_check" CHECK ("servings"."serialized_bytes" is null or "servings"."serialized_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "servings" ADD CONSTRAINT "servings_v2_complete_check" CHECK ("servings"."schema_version" <> 2 or "servings"."purged_at" is not null or (
        "servings"."payload" is not null and "servings"."content_hash" is not null and "servings"."rendered" is not null
        and "servings"."rendered_hash" is not null and "servings"."unit_manifest" is not null
        and "servings"."serialized_bytes" is not null and "servings"."channel" is not null and "servings"."policy_snapshot" is not null
      ));