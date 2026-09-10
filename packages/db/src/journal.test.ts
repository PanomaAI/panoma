import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { LOG_DETAILS_MAX, LOG_SUMMARY_MAX, logActivity, openSession, readJournalEntry, searchJournal, searchJournalPage } from "./agents";
import { sessionMemoryWindow } from "./memory-jobs";
import type { Database } from "./client";
import * as t from "./schema";

/**
 * Against a real Postgres, because what is being tested IS the Postgres: `to_tsvector`,
 * `websearch_to_tsquery` and the GIN index from migration 0042 do not exist in a duplicate.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = "proj-journal-test";
let session: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-journal-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());

  await db.insert(t.projects).values({
    id: PROJECT,
    slug: "journal-test",
    name: "journal-test",
    root: "/tmp/journal-test",
  });
  await db.insert(t.agents).values({ id: "ag-j", name: "claude", apiKeyHash: "h-journal" });

  session = await openSession(db, "ag-j", PROJECT);
  /*
    Manually set watches: three consecutive writes fall in the same millisecond, and there the
    tie-break by id—which is random—does not preserve the arrival. It is the same race documented
    in the context tasks; here the order being tested is by dates.
   */
  let tick = 0;
  const write = async (summary: string, details?: string) => {
    const logged = await logActivity(db, { agentId: "ag-j", projectId: PROJECT, sessionId: session, kind: "change", summary, details });
    if ("refused" in logged) throw new Error("la bitácora rechazó la siembra");
    await db
      .update(t.agentActivities)
      .set({ createdAt: new Date(Date.now() - 1_000 + tick++ * 100) })
      .where(eq(t.agentActivities.id, logged.id));
  };

  await write("Arreglado el catálogo roto", "La base no se cerraba nunca y PGlite corrompía el WAL.");
  await write("Migrada la base a PG18", "db.pglite02 era PG16 y se rescata con el script de ops.");
  await write("Renombrada una variable");
});

afterAll(async () => {
  await close();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

describe("la sala de lectura", () => {
  it("encuentra por el resumen y por los detalles, que es donde vive la historia", async () => {
    const porResumen = await searchJournal(db, PROJECT, "catálogo roto");
    expect(porResumen).toHaveLength(1);
    expect(porResumen[0]?.summary).toBe("Arreglado el catálogo roto");
    expect(porResumen[0]?.agent).toBe("claude");

    // «WAL» only appears in the details: if this fails, the search looks at half the file.
    const porDetalles = await searchJournal(db, PROJECT, "WAL");
    expect(porDetalles).toHaveLength(1);
    expect(porDetalles[0]?.summary).toBe("Arreglado el catálogo roto");
  });

  it("lo que no está escrito no se encuentra, y la respuesta es vacía, no un error", async () => {
    expect(await searchJournal(db, PROJECT, "kubernetes")).toHaveLength(0);
    expect(await searchJournal(db, PROJECT, "   ")).toHaveLength(0);
  });

  it("texto hostil de consulta no rompe la búsqueda: websearch traga lo que le echen", async () => {
    // With `to_tsquery` any of these would be a syntax error SQL.
    for (const hostil of ["a & b | (c", "!' ; drop table notes; --", "\"frase sin cerrar"]) {
      await expect(searchJournal(db, PROJECT, hostil)).resolves.toBeInstanceOf(Array);
    }
  });

  it("no cruza proyectos: el archivo de uno no contesta por el de otro", async () => {
    await db.insert(t.projects).values({ id: "proj-j2", slug: "j2", name: "j2", root: "/tmp/j2" });
    expect(await searchJournal(db, "proj-j2", "catálogo")).toHaveLength(0);
  });
});

describe("lo que una sesión dejó escrito", () => {
  it("devuelve la visita entera y en orden de llegada, que es como se lee una historia", async () => {
    // The distiller's reader: the newest window, handed back in arrival order so it reads as a story.
    const { activities: historia, omitted } = await sessionMemoryWindow(db, session);
    expect(omitted).toBe(0);
    expect(historia.map((a) => a.summary)).toEqual([
      "Arreglado el catálogo roto",
      "Migrada la base a PG18",
      "Renombrada una variable",
    ]);
  });
});

describe("la boca de la bitácora", () => {
  it("un pegote más largo que el tope es un no con motivo, no un 500 del índice", async () => {
    // The GIN index rejects tsvectors larger than one megabyte: without the limit, the INSERT would
    // crash opaquely. Now it responds like all the limits in the house.
    expect(
      await logActivity(db, {
        agentId: "ag-j",
        projectId: PROJECT,
        sessionId: session,
        kind: "change",
        summary: "x".repeat(LOG_SUMMARY_MAX + 1),
      }),
    ).toEqual({ refused: "tooLong", field: "summary", max: LOG_SUMMARY_MAX });
    expect(
      await logActivity(db, {
        agentId: "ag-j",
        projectId: PROJECT,
        sessionId: session,
        kind: "change",
        summary: "el build entero",
        details: "y".repeat(LOG_DETAILS_MAX + 1),
      }),
    ).toEqual({ refused: "tooLong", field: "details", max: LOG_DETAILS_MAX });
  });

  it("una llave pegada no llega a la base: se tapa en la boca, no al servir", async () => {
    const logged = await logActivity(db, {
      agentId: "ag-j",
      projectId: PROJECT,
      sessionId: session,
      kind: "change",
      summary: "El deploy falló por la clave",
      details: `la petición llevaba sk-ant-api03-${"z".repeat(40)} caducada`,
    });
    if ("refused" in logged) throw new Error("no anotó");

    const [row] = await db.select().from(t.agentActivities).where(eq(t.agentActivities.id, logged.id));
    expect(row?.details).toContain("[secret-redacted]");
    expect(row?.details).not.toContain("sk-ant");
    expect(row?.details, "la prosa alrededor sobrevive").toContain("caducada");
  });
});

describe("journal evidence remains reachable", () => {
  it("returns the matching passage after a long prefix, with a stable original ID", async () => {
    const details = `${"Unrelated setup. ".repeat(100)} The final fix uses evidencepassage here.`;
    const entry = await logActivity(db, { agentId: "ag-j", projectId: PROJECT, sessionId: session, kind: "decision", summary: "A resolved incident", details });
    if ("refused" in entry) throw new Error("Fixture was refused.");
    const page = await searchJournalPage(db, PROJECT, "evidencepassage");
    expect(page.matches).toHaveLength(1);
    expect(page.matches[0]).toMatchObject({ id: entry.id });
    expect(page.matches[0]!.excerpt).toContain("evidencepassage");
    expect(page.matches[0]!.excerpt.length).toBeLessThanOrEqual(1_202);
    expect(page.nextCursor).toBeNull();
  });

  it("pages past twelve entries without losing equal timestamps or accepting a cursor from another search", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `journal_page_${String(i).padStart(2, "0")}`);
    await db.insert(t.agentActivities).values(ids.map((id) => ({
      id, agentId: "ag-j", projectId: PROJECT, sessionId: session, kind: "note", summary: "pageproof",
      createdAt: sql`'2026-09-06T12:00:00.000123Z'::timestamptz`,
    })));
    const first = await searchJournalPage(db, PROJECT, "pageproof");
    expect(first.matches).toHaveLength(12);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchJournalPage(db, PROJECT, "pageproof", first.nextCursor!);
    const third = await searchJournalPage(db, PROJECT, "pageproof", second.nextCursor!);
    expect([...first.matches, ...second.matches, ...third.matches].map((hit) => hit.id)).toEqual(ids);
    expect(third.nextCursor).toBeNull();
    await expect(searchJournalPage(db, PROJECT, "different", first.nextCursor!)).rejects.toThrow("Invalid journal cursor");
    await expect(searchJournalPage(db, "another-project", "pageproof", first.nextCursor!)).rejects.toThrow("Invalid journal cursor");
    await expect(searchJournalPage(db, PROJECT, "pageproof", "invalid")).rejects.toThrow("Invalid journal cursor");
  });

  it("reads every character of the original in bounded segments and refuses a different project's ID", async () => {
    const summary = "Complete original";
    const details = `${"Evidence with context. ".repeat(340)} Final exception: preserve the existing data.`;
    const entry = await logActivity(db, { agentId: "ag-j", projectId: PROJECT, sessionId: session, kind: "decision", summary, details });
    if ("refused" in entry) throw new Error("Fixture was refused.");
    let offset: number | null = 0;
    let original = "";
    while (offset !== null) {
      const segment = await readJournalEntry(db, PROJECT, entry.id, offset);
      expect(segment).toBeDefined();
      expect(segment!.text.length).toBeLessThanOrEqual(4_000);
      original += segment!.text;
      offset = segment!.nextOffset;
    }
    expect(original).toBe(`${summary}\n\n${details}`);
    expect(await readJournalEntry(db, "another-project", entry.id)).toBeUndefined();
    await expect(readJournalEntry(db, PROJECT, entry.id, -1)).rejects.toThrow("offset");
    await expect(readJournalEntry(db, PROJECT, entry.id, original.length + 1)).rejects.toThrow("offset");
  });
});
