/*
  Separate what the person decided from what the machine deduced.
  `projects` is derived from the disk and its key is the sha1 of the path, so renaming a folder
  created a new project, removed the old one, and wiped out what the user had written: if it was
  hidden and the description they had asked from a model. The ingestion took care not to overwrite
  those columns one by one, and that caution was useless as soon as the path changed.
  Handwritten and not generated: `drizzle-kit` cannot know that the columns that disappear from
  `projects` **are moved** instead of deleted, so the copy of the data has to be written by
  someone who knows it. The order matters — create, copy, and only then delete.
 */
CREATE TABLE "decisions" (
	"identity" text PRIMARY KEY NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"ai_summary" text,
	"ai_summary_model" text,
	"ai_summary_at" timestamp with time zone,
	"last_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "projects" ADD COLUMN "identity" text;--> statement-breakpoint

/*
  Provisional identity for the rows that already exist: the id, which is unique.
  The definitive one is distributed by `assignIdentities` in the first intake, when it can see the
  entire catalog and detect which copies share the root commit. Until then, each project keeps its
  decisions and no one shares them with anyone, which is the safe behavior while the distribution
  has not occurred.
 */
UPDATE "projects" SET "identity" = "id" WHERE "identity" IS NULL;--> statement-breakpoint

-- The data, before throwing away the columns.
INSERT INTO "decisions" ("identity", "hidden", "ai_summary", "ai_summary_model", "ai_summary_at", "last_name")
SELECT "identity", "hidden", "ai_summary", "ai_summary_model", "ai_summary_at", "name"
FROM "projects"
WHERE "hidden" = true OR "ai_summary" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "projects" DROP COLUMN "hidden";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "ai_summary";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "ai_summary_model";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "ai_summary_at";
