CREATE TABLE "beliefs" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"classified" boolean DEFAULT true NOT NULL,
	"statement" text NOT NULL,
	"identity" text,
	"state" text NOT NULL,
	"supersedes" text,
	"citations" jsonb NOT NULL,
	"support" jsonb NOT NULL,
	"model" text NOT NULL,
	"signed_at" timestamp with time zone,
	"vetoed_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" text PRIMARY KEY NOT NULL,
	"identity" text,
	"topic" text NOT NULL,
	"classified" boolean DEFAULT false NOT NULL,
	"statement" text NOT NULL,
	"citations" jsonb NOT NULL,
	"model" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "beliefs_topic_idx" ON "beliefs" USING btree ("topic","created_at");--> statement-breakpoint
CREATE INDEX "beliefs_state_idx" ON "beliefs" USING btree ("state");--> statement-breakpoint
CREATE INDEX "observations_topic_idx" ON "observations" USING btree ("topic","at");--> statement-breakpoint
CREATE INDEX "observations_classified_idx" ON "observations" USING btree ("classified");--> statement-breakpoint
-- Nothing in `taste_entries` is lost: it is distributed between the two new tables.
--
-- Unreviewed and accepted entries become **evidence**. Rejected entries do not: a "no" means this
-- reading of your words was wrong, and returning it to the source material would ask synthesis to
-- infer it again. They go to the cemetery, where synthesis can see them and avoid repeating them.
--
-- `distinct on` because the old `id` included the section, so the same sentence could be saved
-- twice under two different surfaces; as evidence, it was only one.
INSERT INTO "observations" ("id", "identity", "topic", "classified", "statement", "citations", "model", "at", "created_at")
SELECT DISTINCT ON ("identity", "statement")
  "id",
  "identity",
  'other',
  false,
  "statement",
  CASE WHEN jsonb_typeof("citations") = 'array' THEN "citations" ELSE '[]'::jsonb END,
  "model",
  COALESCE(
    CASE WHEN jsonb_typeof("citations") = 'array' THEN (
      SELECT max((c->>'at')::timestamptz) FROM jsonb_array_elements("citations") c
      WHERE c->>'at' IS NOT NULL
    ) END,
    "created_at"
  ),
  "created_at"
FROM "taste_entries"
WHERE "accepted" IS DISTINCT FROM false
ORDER BY "identity", "statement", "created_at" DESC;--> statement-breakpoint
-- Accepted entries become **signed** beliefs: the person really signed them, one by one. Rejected
-- entries become vetoed beliefs: the cemetery is negative evidence, not deletion.
INSERT INTO "beliefs" ("id", "topic", "classified", "statement", "identity", "state", "citations", "support", "model", "signed_at", "vetoed_at", "updated_at", "created_at")
SELECT
  md5('belief' || "id"),
  'other',
  false,
  "statement",
  CASE WHEN "scoped" THEN "identity" END,
  CASE WHEN "accepted" THEN 'signed' ELSE 'vetoed' END,
  CASE WHEN jsonb_typeof("citations") = 'array' THEN (
    SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM (
      SELECT c FROM jsonb_array_elements("citations") c LIMIT 12
    ) x
  ) ELSE '[]'::jsonb END,
  jsonb_build_object(
    'observations', 1,
    'projects', CASE WHEN "identity" IS NULL THEN 0 ELSE 1 END,
    'days', CASE WHEN jsonb_typeof("citations") = 'array' THEN (
      SELECT count(DISTINCT left(c->>'at', 10)) FROM jsonb_array_elements("citations") c
      WHERE c->>'at' IS NOT NULL
    ) ELSE 0 END
  ),
  "model",
  CASE WHEN "accepted" THEN COALESCE("decided_at", "created_at") END,
  CASE WHEN NOT "accepted" THEN COALESCE("decided_at", "created_at") END,
  COALESCE("decided_at", "created_at"),
  "created_at"
FROM "taste_entries"
WHERE "accepted" IS NOT NULL AND "merged_into" IS NULL;
