import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { createRun, findRunningRun, getRun, reapStaleRuns } from "./runs";
import * as t from "./schema";

/**
 * Against a real Postgres, not against a double.
 *
 * What is verified here —what happens with a row that no one will touch again— depends on the
 * `where` and the dates, which is exactly what a database double does not reproduce. PGlite is
 * Postgres compiled to WASM, so the same SQL runs the same.
 *
 * The catalog goes to a temporary directory via `PANOMA_HOME`, which is exactly what it was made
 * for: without it, this test would write to the real catalog of whoever runs it.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-runs-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

const PROJECT = "proj_prueba";

beforeEach(async () => {
  await db.delete(t.runs);
  await db.delete(t.projects);
  await db.insert(t.projects).values({
    id: PROJECT,
    name: "prueba",
    slug: "prueba",
    root: "/tmp/prueba",
  });
});

/** Age an execution by so many minutes, without touching the process clock. */
async function age(id: string, minutes: number) {
  await db
    .update(t.runs)
    .set({ createdAt: sql`now() - interval '${sql.raw(String(minutes))} minutes'` })
    .where(eq(t.runs.id, id));
}

function newRun() {
  return createRun(db, {
    projectId: PROJECT,
    kind: "dependency-bump",
    target: { packageName: "zod", targetVersion: "4.0.0" },
  });
}

describe("una ejecución que nadie va a cerrar", () => {
  /*
    `createRun` marks 'running' and `finishRun` changes it when it finishes. Between the two there
    is an installation and a batch of tests: restarting the server, a Ctrl-C, or an OOM leave the
    queue in 'running' forever, because there is no one to look at it again.
   */
  it("se cierra cuando ha pasado de largo el tiempo máximo", async () => {
    const id = await newRun();
    await age(id, 25);

    expect(await reapStaleRuns(db)).toBe(1);
    const run = await getRun(db, id);
    expect(run?.status).toBe("failed");
    expect(run?.finishedAt).not.toBeNull();
  });

  it("no dice que el paquete esté roto: dice que no se sabe", async () => {
    // The difference matters. A 'failure' that claims the upgrade breaks something is saved as a
    // known failure and blocks the retry with a conclusion that no one checked.
    const id = await newRun();
    await age(id, 25);
    await reapStaleRuns(db);

    const run = await getRun(db, id);
    expect(run?.summary).toContain("Interrumpida");
    expect(run?.summary).toContain("no se puede afirmar nada");
  });

  it("no toca una que acaba de empezar", async () => {
    const id = await newRun();
    expect(await reapStaleRuns(db)).toBe(0);
    expect((await getRun(db, id))?.status).toBe("running");
  });

  it("no toca las que ya terminaron", async () => {
    const id = await newRun();
    await db.update(t.runs).set({ status: "proposed" }).where(eq(t.runs.id, id));
    await age(id, 500);

    expect(await reapStaleRuns(db)).toBe(0);
    expect((await getRun(db, id))?.status).toBe("proposed");
  });

  it("dos barridos a la vez no cuentan la misma dos veces", async () => {
    const id = await newRun();
    await age(id, 25);
    // The `status` goes in the `where`, so the second one doesn't find anything to update.
    const [one, dos] = await Promise.all([reapStaleRuns(db), reapStaleRuns(db)]);
    expect(one + dos).toBe(1);
  });
});

describe("una sola ejecución viva por proyecto", () => {
  /*
    Two at the same time on the same repository fight over the worktree: `createWorktree` deletes
    the branch `panoma/…` before creating it, so the second one takes the branch from the first
    and both end up with a result that is not theirs.
   */
  it("la encuentra mientras está en marcha", async () => {
    const id = await newRun();
    expect((await findRunningRun(db, PROJECT))?.id).toBe(id);
  });

  it("deja de verla en cuanto termina", async () => {
    const id = await newRun();
    await db.update(t.runs).set({ status: "proposed" }).where(eq(t.runs.id, id));
    expect(await findRunningRun(db, PROJECT)).toBeUndefined();
  });

  it("una colgada deja de bloquear el proyecto tras el barrido", async () => {
    // Without this, an execution dead for weeks was blocking the project forever.
    const id = await newRun();
    await age(id, 25);
    expect(await findRunningRun(db, PROJECT)).toBeDefined();

    await reapStaleRuns(db);
    expect(await findRunningRun(db, PROJECT)).toBeUndefined();
  });
});
