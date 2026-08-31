ALTER TABLE "projects" ADD COLUMN "disk_total_bytes" bigint;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "disk_reclaimable_bytes" bigint;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "disk_dirs" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "disk_measured_at" timestamp with time zone;