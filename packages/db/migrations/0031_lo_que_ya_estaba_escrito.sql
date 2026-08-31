ALTER TABLE "beliefs" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
-- What came from the old queue **was already written**: `TASTE.md` has contained it since the
-- person accepted it. Leaving the new column blank would say that none had ever been published,
-- and the first reconciliation would treat them all as new —which means manually deleting one of
-- the twenty-seven most-reviewed lines would fail to veto it.
UPDATE "beliefs" SET "published_at" = "created_at" WHERE "state" = 'signed';
