ALTER TABLE "runs" ADD COLUMN "isolation" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "isolation_note" text;