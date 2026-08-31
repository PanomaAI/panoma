CREATE TABLE "model_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"identity" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"images" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "model_calls_kind_idx" ON "model_calls" USING btree ("kind","created_at");