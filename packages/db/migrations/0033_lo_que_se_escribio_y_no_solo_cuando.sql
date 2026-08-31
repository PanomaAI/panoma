-- What was written in `TASTE.md`, and not just when.
--
-- A date distinguishes 'never was' from 'was and is no longer.' The third is missing, which is the
-- one most traveled: 'its line is old because the machine changed the row.' Without it, a belief
-- that the synthesis refines stops matching with its own line and the reconciliation reads it as
-- handwritten —it vetoes the belief, sends it to the cemetery, and leaves the old line in the file. Each pass
-- killed what it had just improved.
ALTER TABLE "beliefs" ADD COLUMN "published_as" jsonb;--> statement-breakpoint
-- Fill previously published beliefs with what each row says **today**, which is the best available
-- answer. In the normal case —nothing changed between the last write and this migration— it is
-- exactly what the file contains. If someone edited it by hand, the first reconciliation will see
-- the difference and trust the file, which is the correct side.
UPDATE "beliefs"
   SET "published_as" = jsonb_build_object('topic', "topic", 'statement', "statement")
 WHERE "published_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "beliefs" DROP COLUMN "published_at";
