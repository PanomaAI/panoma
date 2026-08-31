CREATE TABLE "advisories" (
	"id" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"severity" text DEFAULT 'desconocida' NOT NULL,
	"published_at" timestamp with time zone,
	"url" text,
	"fixed_versions" jsonb
);
--> statement-breakpoint
CREATE TABLE "vulnerabilities" (
	"package_id" text NOT NULL,
	"version" text NOT NULL,
	"advisory_id" text NOT NULL,
	CONSTRAINT "vulnerabilities_package_id_version_advisory_id_pk" PRIMARY KEY("package_id","version","advisory_id")
);
--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "unresolvable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "deprecated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "license" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "direct_deps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "outdated_deps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "major_behind" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "vuln_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "vuln_critical" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_advisory_id_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."advisories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vulnerabilities_package_idx" ON "vulnerabilities" USING btree ("package_id","version");--> statement-breakpoint
CREATE INDEX "packages_checked_idx" ON "packages" USING btree ("latest_checked_at");