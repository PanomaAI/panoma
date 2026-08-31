-- The review queue is closing. What was inside is distributed by the previous migration: unchecked
-- and accepted items are evidence in `observations`, signed and rejected items are beliefs in
-- `beliefs`. Here, there is only the table left to throw away.
DROP TABLE "taste_entries" CASCADE;
