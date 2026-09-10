-- Only legacy one-segment desktop keys change; app actions keep their two segments.
UPDATE decisions
SET open_plan = jsonb_set(open_plan, '{steps}', (
  SELECT coalesce(jsonb_agg(
    CASE WHEN step->>'key' ~ '^app:[a-z0-9][a-z0-9-]*$'
      THEN jsonb_set(step, '{key}', to_jsonb('desktop:' || substring(step->>'key' from 5)))
      ELSE step END ORDER BY ordinal
  ), '[]'::jsonb)
  FROM jsonb_array_elements(open_plan->'steps') WITH ORDINALITY AS entries(step, ordinal)
))
WHERE jsonb_typeof(open_plan->'steps') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(open_plan->'steps') AS step
    WHERE step->>'key' ~ '^app:[a-z0-9][a-z0-9-]*$'
  );
