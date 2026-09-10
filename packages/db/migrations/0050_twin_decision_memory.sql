CREATE TABLE "decision_episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"identity" text,
	"supersedes_id" text,
	"origin" text NOT NULL,
	"fields" jsonb NOT NULL,
	"model" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narratives" (
	"id" text PRIMARY KEY NOT NULL,
	"identity" text NOT NULL,
	"source" text NOT NULL,
	"session_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"context" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "decision_episodes_identity_idx" ON "decision_episodes" USING btree ("identity","status","created_at");--> statement-breakpoint
CREATE INDEX "narratives_identity_idx" ON "narratives" USING btree ("identity","at");--> statement-breakpoint
CREATE INDEX "narratives_read_idx" ON "narratives" USING btree ("read_at","at");
