ALTER TABLE "memory_jobs" ADD COLUMN "storage_reserved_bytes" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "memory_jobs" ADD CONSTRAINT "memory_jobs_storage_reserved_check" CHECK ("memory_jobs"."storage_reserved_bytes" >= 0 and "memory_jobs"."storage_reserved_bytes" <= 9007199254740991);
