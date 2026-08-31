-- A proposal can replace several signed beliefs, not just one.
--
-- The conversion goes with `using` and manually: `alter ... set data type jsonb` over a `text` that
-- contains an identifier would wrap it in a **string** JSON, not in a list, and reading it back
-- would encounter a `"abc"` where it expects a `["abc"]`. What existed were lists of one.
ALTER TABLE "beliefs"
  ALTER COLUMN "supersedes" SET DATA TYPE jsonb
  USING CASE WHEN "supersedes" IS NULL THEN NULL ELSE jsonb_build_array("supersedes") END;
