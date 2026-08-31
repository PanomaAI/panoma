ALTER TABLE "notes" ADD COLUMN "sentinels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "challenge" jsonb;