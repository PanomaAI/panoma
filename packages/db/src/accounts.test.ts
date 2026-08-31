import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import { getProject, saveProjectAccounts } from "./queries";

/**
 * The project's accounts and links live in `decisions`, not in `projects`: they were written by a
 * person and have to survive whatever a scan does with the row derived from the disk. These tests
 * check both promises: they are saved and read by the card, and replacing the entire list does not
 * leave duplicates.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-cuentas-"));
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

const PROJECT = "proj_cuentas";

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

describe("las cuentas del proyecto", () => {
  it("se guardan por identidad y la ficha las lee", async () => {
    await saveProjectAccounts(db, PROJECT, [
      { label: "Vercel", email: "yo@ejemplo.dev", url: "https://vercel.com/yo" },
      { label: "Dominio", note: "en Namecheap hasta 2027" },
    ]);
    const data = await getProject(db, "prueba");
    const accounts = data?.decision?.accounts as { label: string }[];
    expect(accounts).toHaveLength(2);
    expect(accounts[0]!.label).toBe("Vercel");
  });

  it("guardar de nuevo reemplaza la lista entera: sin duplicados", async () => {
    await saveProjectAccounts(db, PROJECT, [{ label: "Vercel" }]);
    await saveProjectAccounts(db, PROJECT, [{ label: "Stripe" }]);
    const data = await getProject(db, "prueba");
    const accounts = data?.decision?.accounts as { label: string }[];
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.label).toBe("Stripe");
  });

  it("sin identidad no se guarda nada, en silencio: no hay dónde colgarlo", async () => {
    await db.update(t.projects).set({ identity: null });
    await saveProjectAccounts(db, PROJECT, [{ label: "Vercel" }]);
    const data = await getProject(db, "prueba");
    expect(data?.decision?.accounts ?? null).toBeNull();
  });
});
