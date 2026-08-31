CREATE TABLE "exclusions" (
	"root" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"excluded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
/*
  The duplicate slugs that are already in the table, before requiring them to be unique.
  A uniqueness constraint cannot be added on data that already violates it, and here they violate
  it plenty: ten slugs spread across fifty-three folders. One is left per group —the oldest in the
  catalog, so that the URL that was already working continues to work— and the others are given
  the id, which is unique by design.
  It is a provisional and purposely ugly value: `assignSlugs` distributes the final ones at the
  end of the first intake, and that way you can immediately see if, for some reason, it didn't
  run.
 */
UPDATE "projects" p SET "slug" = p."id"
WHERE EXISTS (
  SELECT 1 FROM "projects" q
  WHERE q."slug" = p."slug"
    AND (q."first_seen_at", q."id") < (p."first_seen_at", p."id")
);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_slug_unique" UNIQUE("slug");
