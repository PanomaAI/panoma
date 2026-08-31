-- The saved values go into English, just like the code that writes them.
--
-- Without this, an existing catalog is left disconnected without saying anything: the engine starts
-- writing `own` and the interface keeps asking for `propio`, so the 56 projects that were yours
-- stop being counted as yours, the warnings lose their severity, and the stalled proposals
-- disappear from the tray. Nothing fails; it just stops being true.
--
-- It is done with UPDATE and not by deleting and rescanning because there are things that a scan
-- cannot reconstruct: the tasks you wrote, the proposals that are waiting for your yes or no, and
-- the history of what the agents did.

UPDATE "projects" SET "origin_kind" = CASE "origin_kind"
  WHEN 'propio' THEN 'own'
  WHEN 'bifurcado' THEN 'forked'
  WHEN 'ajeno' THEN 'foreign'
  WHEN 'plantilla' THEN 'template'
  WHEN 'sin-señales' THEN 'no-signals'
  ELSE "origin_kind" END;
--> statement-breakpoint
UPDATE "projects" SET "summary_source" = CASE "summary_source"
  WHEN 'manifiesto' THEN 'manifest'
  WHEN 'compuesta' THEN 'composed'
  ELSE "summary_source" END;
--> statement-breakpoint
UPDATE "advisories" SET "severity" = CASE "severity"
  WHEN 'crítica' THEN 'critical'
  WHEN 'alta' THEN 'high'
  WHEN 'media' THEN 'medium'
  WHEN 'baja' THEN 'low'
  WHEN 'desconocida' THEN 'unknown'
  ELSE "severity" END;
--> statement-breakpoint
UPDATE "runs" SET "status" = CASE "status"
  WHEN 'pendiente' THEN 'pending'
  WHEN 'ejecutando' THEN 'running'
  WHEN 'propuesto' THEN 'proposed'
  WHEN 'fallido' THEN 'failed'
  WHEN 'sin-cambios' THEN 'no-changes'
  WHEN 'aplicado' THEN 'applied'
  WHEN 'descartado' THEN 'discarded'
  ELSE "status" END;
--> statement-breakpoint
UPDATE "runs" SET "kind" = CASE "kind"
  WHEN 'bump-dependencia' THEN 'dependency-bump'
  WHEN 'arreglo-vulnerabilidad' THEN 'vulnerability-fix'
  ELSE "kind" END;
--> statement-breakpoint
UPDATE "runs" SET "requested_by" = 'human' WHERE "requested_by" = 'humano';
--> statement-breakpoint
UPDATE "tasks" SET "status" = CASE "status"
  WHEN 'abierta' THEN 'open'
  WHEN 'en curso' THEN 'in-progress'
  WHEN 'hecha' THEN 'done'
  WHEN 'descartada' THEN 'discarded'
  ELSE "status" END;
--> statement-breakpoint
UPDATE "tasks" SET "created_by" = 'human' WHERE "created_by" = 'humano';
--> statement-breakpoint
UPDATE "agent_activities" SET "kind" = CASE "kind"
  WHEN 'cambio' THEN 'change'
  WHEN 'decisión' THEN 'decision'
  WHEN 'nota' THEN 'note'
  WHEN 'bloqueo' THEN 'blocker'
  ELSE "kind" END;
--> statement-breakpoint
-- And the defaults, which otherwise would be written in Spanish on the next inserted row.
ALTER TABLE "advisories" ALTER COLUMN "severity" SET DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE "agent_activities" ALTER COLUMN "kind" SET DEFAULT 'change';
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_by" SET DEFAULT 'human';
--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "requested_by" SET DEFAULT 'human';
