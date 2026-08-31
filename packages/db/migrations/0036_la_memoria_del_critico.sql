CREATE TABLE "looks" (
	"id" text PRIMARY KEY NOT NULL,
	"identity" text NOT NULL,
	"digest" text NOT NULL,
	"shot" text,
	"bytes" integer DEFAULT 0 NOT NULL,
	"fired" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"statements" integer DEFAULT 0 NOT NULL,
	"dropped" integer DEFAULT 0 NOT NULL,
	"unreadable" boolean DEFAULT false NOT NULL,
	"findings" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "looks_identity_idx" ON "looks" USING btree ("identity","at");--> statement-breakpoint
CREATE INDEX "looks_digest_idx" ON "looks" USING btree ("identity","digest");