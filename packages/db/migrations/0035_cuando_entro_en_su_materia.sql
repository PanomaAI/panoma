ALTER TABLE "observations" ADD COLUMN "topic_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- And the backfill, which is the half that matters. Without it, all existing observations would be
-- born on the date of this migration and every topic would become "freshly moved" at once: the next
-- pass would resynthesize the entire portrait without a single new citation. With it, each row
-- inherits the time it was distilled, the closest written approximation available —and
-- unclassified observations will update their date as soon as classification places them.
UPDATE "observations" SET "topic_at" = "created_at";
