-- The agents' instruction file, reviewed against the disk.
--
-- A single new column. Handwritten for the same reason as 0014 and 0015: snapshot 0013 was a copy
-- of 0012, and `drizzle-kit generate` could not differentiate without asking for renames that do
-- not exist. This migration adds the column and its snapshot (0016_snapshot.json, generated from
-- the actual schema) settles that debt: from here on, the diff is trustworthy again.
ALTER TABLE "projects" ADD COLUMN "agents_md" jsonb;
