CREATE TABLE "synthesis_passes" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"refined" integer DEFAULT 0 NOT NULL,
	"retired" integer DEFAULT 0 NOT NULL,
	"proposed" integer DEFAULT 0 NOT NULL,
	"observations" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "synthesis_passes_at_idx" ON "synthesis_passes" USING btree ("at");