import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import { getProject, saveBuildCheck, type BuildCheckVerdict } from "./queries";

/**
 * The build verdict lives in `decisions`, like the accounts and for the same reason: it was
 * conquered by a real execution and has to survive what a scan does to the row derived from the
 * disk. Two promises: it is saved and the token reads it, and rechecking replaces the previous
 * verdict instead of accumulating history.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-veredicto-"));
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

const PROJECT = "proj_veredicto";

function verdict(extra: Partial<BuildCheckVerdict> = {}): BuildCheckVerdict {
  return {
    status: "ok",
    at: "2026-08-18T12:00:00.000Z",
    durationMs: 41_000,
    command: "pnpm run build",
    isolation: "hardened",
    summary: "Compila.",
    ...extra,
  };
}

beforeEach(async () => {
  await db.delete(t.decisions);
  await db.delete(t.projects);
  await db.insert(t.projects).values({
    id: PROJECT,
    name: "prueba",
    slug: "prueba",
    root: "/tmp/prueba",
    identity: "identidad_prueba",
  });
});

describe("el veredicto de build", () => {
  it("se guarda por identidad y la ficha lo lee", async () => {
    await saveBuildCheck(db, PROJECT, verdict());
    const data = await getProject(db, "prueba");
    const saved = data?.decision?.buildCheck as BuildCheckVerdict;
    expect(saved.status).toBe("ok");
    expect(saved.command).toBe("pnpm run build");
  });

  it("comprobar de nuevo reemplaza el veredicto, no acumula", async () => {
    await saveBuildCheck(db, PROJECT, verdict());
    await saveBuildCheck(db, PROJECT, verdict({ status: "failed", reason: "se rompió" }));
    const data = await getProject(db, "prueba");
    const saved = data?.decision?.buildCheck as BuildCheckVerdict;
    expect(saved.status).toBe("failed");
    expect(saved.reason).toBe("se rompió");
  });

  it("sin identidad no se guarda nada, en silencio", async () => {
    await db.update(t.projects).set({ identity: null });
    await saveBuildCheck(db, PROJECT, verdict());
    const data = await getProject(db, "prueba");
    expect(data?.decision?.buildCheck ?? null).toBeNull();
  });
});
