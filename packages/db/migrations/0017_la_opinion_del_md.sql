ALTER TABLE "decisions" ADD COLUMN "md_review" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "md_review_model" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "md_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "md_review_hash" text;