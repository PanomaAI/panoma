CREATE TABLE "distributions" (
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"evidence" text NOT NULL,
	"url" text,
	CONSTRAINT "distributions_project_id_kind_label_pk" PRIMARY KEY("project_id","kind","label")
);
--> statement-breakpoint
CREATE TABLE "families" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"canonical_project_id" text NOT NULL,
	"canonical_reason" text NOT NULL,
	"redundant_bytes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"family_id" text NOT NULL,
	"project_id" text NOT NULL,
	"confidence" real NOT NULL,
	"reason" text NOT NULL,
	"days_behind" integer,
	CONSTRAINT "family_members_family_id_project_id_pk" PRIMARY KEY("family_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" text PRIMARY KEY NOT NULL,
	"ecosystem" text NOT NULL,
	"name" text NOT NULL,
	"latest_version" text,
	"latest_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_agents" (
	"project_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"commits" integer NOT NULL,
	"source" text DEFAULT 'git-trailer' NOT NULL,
	CONSTRAINT "project_agents_project_id_agent_name_pk" PRIMARY KEY("project_id","agent_name")
);
--> statement-breakpoint
CREATE TABLE "project_dependencies" (
	"project_id" text NOT NULL,
	"package_id" text NOT NULL,
	"constraint" text NOT NULL,
	"resolved_version" text,
	"is_dev" boolean DEFAULT false NOT NULL,
	"is_direct" boolean DEFAULT true NOT NULL,
	"source" text,
	CONSTRAINT "project_dependencies_project_id_package_id_pk" PRIMARY KEY("project_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "project_technologies" (
	"project_id" text NOT NULL,
	"technology_id" text NOT NULL,
	"version" text,
	"confidence" real NOT NULL,
	"evidence" jsonb NOT NULL,
	CONSTRAINT "project_technologies_project_id_technology_id_pk" PRIMARY KEY("project_id","technology_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"root" text NOT NULL,
	"description" text,
	"version" text,
	"icon_data_uri" text,
	"primary_language" text,
	"health_score" integer DEFAULT 0 NOT NULL,
	"health_grade" text DEFAULT 'F' NOT NULL,
	"source_bytes" integer DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"git_branch" text,
	"git_remote_url" text,
	"git_commit_count" integer,
	"last_commit_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_root_unique" UNIQUE("root")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"commit_sha" text,
	"engine_version" text NOT NULL,
	"health_score" integer NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technologies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"icon_slug" text
);
--> statement-breakpoint
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_canonical_project_id_projects_id_fk" FOREIGN KEY ("canonical_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_technologies" ADD CONSTRAINT "project_technologies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_technologies" ADD CONSTRAINT "project_technologies_technology_id_technologies_id_fk" FOREIGN KEY ("technology_id") REFERENCES "public"."technologies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_members_project_idx" ON "family_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "packages_ecosystem_idx" ON "packages" USING btree ("ecosystem");--> statement-breakpoint
CREATE INDEX "project_dependencies_package_idx" ON "project_dependencies" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "project_technologies_tech_idx" ON "project_technologies" USING btree ("technology_id");--> statement-breakpoint
CREATE INDEX "projects_health_idx" ON "projects" USING btree ("health_score");--> statement-breakpoint
CREATE INDEX "projects_last_commit_idx" ON "projects" USING btree ("last_commit_at");--> statement-breakpoint
CREATE INDEX "snapshots_project_idx" ON "snapshots" USING btree ("project_id","scanned_at");