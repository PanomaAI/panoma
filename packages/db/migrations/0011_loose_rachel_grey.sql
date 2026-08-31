ALTER TABLE "projects" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "summary_source" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "summary_readme" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "summary_composed" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ai_summary_model" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ai_summary_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "origin_kind" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "origin_started_by" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "origin_share" real;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "origin_evidence" jsonb;