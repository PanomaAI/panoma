CREATE TABLE "memory_jobs" (
  "session_id" text PRIMARY KEY REFERENCES "agent_sessions"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "lease_token" text,
  "reason" text,
  "receipt" jsonb,
  CONSTRAINT "memory_jobs_status_check" CHECK ("status" IN ('pending', 'running', 'deferred', 'failed', 'complete')),
  CONSTRAINT "memory_jobs_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "memory_jobs_ready_idx" ON "memory_jobs" ("status", "available_at");
