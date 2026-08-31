-- The purpose of each command in the runbook was also in Spanish, but inside a JSON.
--
-- It escaped the previous sweep because `projects.runbook` is a column `jsonb`: for the value
-- inventory it is an opaque string, not an enumeration. And the error it caused was not visible
-- from the catalog — you have to open a project's record to get to 'how it is resumed,' which is
-- where it is read. A piece of data that is only looked at occasionally is precisely the one that
-- stays broken for months.

UPDATE "projects"
SET "runbook" = jsonb_set(
  "runbook",
  '{commands}',
  (
    SELECT COALESCE(jsonb_agg(
      CASE command->>'purpose'
        WHEN 'instalar' THEN jsonb_set(command, '{purpose}', '"install"')
        WHEN 'arrancar' THEN jsonb_set(command, '{purpose}', '"start"')
        WHEN 'compilar' THEN jsonb_set(command, '{purpose}', '"build"')
        ELSE command
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements("runbook"->'commands') AS command
  )
)
WHERE "runbook" IS NOT NULL
  AND jsonb_typeof("runbook"->'commands') = 'array';
