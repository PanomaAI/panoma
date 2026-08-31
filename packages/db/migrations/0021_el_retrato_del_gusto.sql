CREATE TABLE "taste_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"identity" text,
	"section" text NOT NULL,
	"statement" text NOT NULL,
	"citations" jsonb NOT NULL,
	"model" text NOT NULL,
	"accepted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "taste_entries_identity_idx" ON "taste_entries" USING btree ("identity","created_at");--> statement-breakpoint
CREATE INDEX "taste_entries_accepted_idx" ON "taste_entries" USING btree ("accepted");