import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@panoma/db";
import { pendingPatrols, resetPatrolState } from "./memory-patrol";
import { anchorNote, evaluateSentinel, extractAnchors, isLegacyAnchor, patrolSentinels, refreshProjectMemory } from "./sentinels";

/**
 * Against disk and real Postgres, because the sentinel IS the comparison with the disk: a double
 * of `stat` would prove that we call `stat`, not that a disputed note stops being served when its
 * basis disappears.
 */

let home: string;
let root: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = "proj-sentinels-test";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-sentinels-"));
  process.env["PANOMA_HOME"] = home;
  root = await mkdtemp(join(tmpdir(), "panoma-sentinels-root-"));
  await mkdir(join(root, "ops"), { recursive: true });
  await writeFile(join(root, "ops", "migrate.mjs"), "console.log('migrar');\n");
  await writeFile(join(root, "package.json"), `{"scripts":{"build":"tsc"}}\n`);

  const { openDatabase } = await import("@panoma/db/client");
  ({ db, close } = await openDatabase());
  const { schema: t } = await import("@panoma/db");
  await db.insert(t.projects).values({ id: PROJECT, slug: "sentinels-test", name: "sentinels-test", root });
});

afterAll(async () => {
  await close();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  const { schema: t } = await import("@panoma/db");
  await db.delete(t.notes);
});

describe("la aduana: anclas extraídas del propio cuerpo", () => {
  it("preserves literal route groups, dynamic segments and quoted spaces", async () => {
    await mkdir(join(root, "apps", "(app)", "[slug]"), { recursive: true });
    await writeFile(join(root, "apps", "(app)", "[slug]", "page.tsx"), "");
    await writeFile(join(root, "ops", "local check.mjs"), "");
    const anchors = await extractAnchors("Check apps/(app)/[slug]/page.tsx and `ops/local check.mjs`.", root);
    expect(anchors.map((anchor) => anchor.target).sort()).toEqual(["apps/(app)/[slug]/page.tsx", "ops/local check.mjs"]);
  });
  it("una ruta mencionada que existe se vuelve centinela; la que no existe es solo prosa", async () => {
    const anchors = await extractAnchors(
      "La base se rescata con ops/migrate.mjs, no con ops/inventado.sh.",
      root,
    );
    expect(anchors).toEqual([{ kind: "path_exists", target: "ops/migrate.mjs", expected: true }]);
  });

  it("la puntuación de la prosa no ensucia el ancla", async () => {
    const anchors = await extractAnchors("El arreglo vive en (ops/migrate.mjs).", root);
    expect(anchors[0]?.target).toBe("ops/migrate.mjs");
  });

  it("una nota no puede poner a panoma a vigilar fuera de su proyecto", async () => {
    await writeFile(join(home, "secreto.txt"), "x");
    const fuera = `../${home.split("/").at(-1)}/secreto.txt`;
    expect(await extractAnchors(`Mira ${fuera} y también ops/../../etc/passwd.`, root)).toEqual([]);
  });

  it("tres anclas como mucho: más es una nota que se impugnaría por cualquier cosa", async () => {
    await writeFile(join(root, "a.ts"), "");
    await writeFile(join(root, "b.ts"), "");
    const body = "Tocan ops/migrate.mjs, ops/../a.ts, ops/../b.ts y ops/migrate.mjs otra vez.";
    const anchors = await extractAnchors(body, root);
    expect(anchors.length).toBeLessThanOrEqual(3);
    // And without duplicates: the same route twice is a single basis.
    expect(new Set(anchors.map((a) => a.target)).size).toBe(anchors.length);
  });
});

describe("el gatillo de una dormida se vigila como un ancla más", () => {
  async function planted(id: string, trigger: string | null): Promise<void> {
    const { schema: t } = await import("@panoma/db");
    await db.insert(t.notes).values({
      id,
      projectId: PROJECT,
      body: "Una señal sin rutas en el cuerpo.",
      status: "approved",
      createdBy: "claude",
      trigger,
    });
  }

  it("la base de una zona existente queda anclada con path_exists", async () => {
    const { listSentinels } = await import("@panoma/db");
    await planted("nota-zona", "ops/**");
    await anchorNote(db, { noteId: "nota-zona", body: "Una señal sin rutas en el cuerpo.", root, trigger: "ops/**" });

    const [guarded] = await listSentinels(db, PROJECT);
    expect(guarded?.sentinels).toEqual([{ kind: "path_exists", target: "ops", expected: true }]);
  });

  it("un gatillo sobre una ruta que aún no existe se queda esperando, sin vigilante", async () => {
    // “If one day you create this, don’t…” is a legitimate trigger: anchoring it would challenge it
    // for waiting, which is exactly its own.
    const { listSentinels } = await import("@panoma/db");
    await planted("nota-futura", "src/legacy.ts");
    await anchorNote(db, { noteId: "nota-futura", body: "Una señal sin rutas en el cuerpo.", root, trigger: "src/legacy.ts" });

    expect(await listSentinels(db, PROJECT)).toHaveLength(0);
  });

  it("y la patrulla impugna a la dormida cuya zona desapareció", async () => {
    const { listProjectNotes, schema: t } = await import("@panoma/db");
    await db.insert(t.notes).values({
      id: "nota-zona-rota",
      projectId: PROJECT,
      body: "Cuidado en esta zona.",
      status: "approved",
      createdBy: "claude",
      trigger: "zona-borrada/**",
      sentinels: [{ kind: "path_exists", target: "zona-borrada", expected: true }],
    });

    const result = await patrolSentinels(db, { id: PROJECT, root });
    expect(result.challenged.map((c) => c.noteId)).toEqual(["nota-zona-rota"]);
    expect((await listProjectNotes(db, PROJECT, ["challenged"])).map((n) => n.id)).toEqual(["nota-zona-rota"]);
  });
});

describe("el evaluador, contra el disco", () => {
  it("path_exists distingue existir de faltar", async () => {
    expect(await evaluateSentinel(root, { kind: "path_exists", target: "ops/migrate.mjs", expected: true })).toEqual({
      holds: true,
      observed: "exists",
    });
    expect(await evaluateSentinel(root, { kind: "path_exists", target: "ops/borrado.mjs", expected: true })).toEqual({
      holds: false,
      observed: "missing",
    });
  });

  it("file_contains lee el fichero de verdad", async () => {
    expect(
      await evaluateSentinel(root, { kind: "file_contains", target: "package.json", expected: '"build"' }),
    ).toMatchObject({ holds: true });
    expect(
      await evaluateSentinel(root, { kind: "file_contains", target: "package.json", expected: '"deploy"' }),
    ).toMatchObject({ holds: false, observed: "absent" });
  });

  it("file_hash caza el cambio de contenido, no solo la ausencia", async () => {
    const first = await evaluateSentinel(root, { kind: "file_hash", target: "package.json", expected: "?" });
    const pinned = await evaluateSentinel(root, {
      kind: "file_hash",
      target: "package.json",
      expected: first.observed,
    });
    expect(pinned.holds).toBe(true);

    await writeFile(join(root, "package.json"), `{"scripts":{"build":"vite build"}}\n`);
    const after = await evaluateSentinel(root, {
      kind: "file_hash",
      target: "package.json",
      expected: first.observed,
    });
    expect(after.holds).toBe(false);
  });

  it("un symlink que apunta fuera del proyecto no se lee: manda la ruta real", async () => {
    // The lexical prefix comparison was papel: stat and readFile follow links, and a symlink
    // committed in a cloned project could make Panoma read ~/.ssh.
    const { symlink } = await import("node:fs/promises");
    await writeFile(join(home, "fuera.txt"), "secreto");
    await symlink(join(home, "fuera.txt"), join(root, "colado.txt"));

    expect(
      await evaluateSentinel(root, { kind: "file_contains", target: "colado.txt", expected: "secreto" }),
    ).toEqual({ holds: false, observed: "target escapes the project root" });
  });

  it("un fichero por encima del tope no se pasea por la memoria, y su veredicto lo dice", async () => {
    await writeFile(join(root, "gigante.bin"), Buffer.alloc(1_000_001));
    expect(
      await evaluateSentinel(root, { kind: "file_contains", target: "gigante.bin", expected: "x" }),
    ).toEqual({ holds: false, observed: "unreadable: too large" });
  });

  it("un objetivo que se escapa de la raíz no se evalúa: cae, siempre", async () => {
    const reading = await evaluateSentinel(root, { kind: "path_exists", target: "../../etc", expected: true });
    expect(reading.holds).toBe(false);
  });
});

describe("la patrulla", () => {
  it("impugna la nota cuyo fundamento desapareció, y la sana sigue sirviéndose", async () => {
    const { addHumanNote, listProjectNotes, setSentinels } = await import("@panoma/db");
    await writeFile(join(root, "efimero.txt"), "aquí estoy");

    const sana = await addHumanNote(db, { projectId: PROJECT, body: "El build vive en ops/migrate.mjs." });
    const condenada = await addHumanNote(db, { projectId: PROJECT, body: "Mira efimero.txt antes de nada." });
    if (!("id" in sana) || !("id" in condenada)) throw new Error("no creó");
    await setSentinels(db, sana.id, [{ kind: "path_exists", target: "ops/migrate.mjs", expected: true }]);
    await setSentinels(db, condenada.id, [{ kind: "path_exists", target: "efimero.txt", expected: true }]);

    await rm(join(root, "efimero.txt"));
    const result = await patrolSentinels(db, { id: PROJECT, root });

    expect(result.checked).toBe(2);
    expect(result.challenged).toHaveLength(1);
    expect(result.challenged[0]?.noteId).toBe(condenada.id);

    // The challenged one stopped serving itself; the lawsuit travels with its evidence.
    const served = await listProjectNotes(db, PROJECT);
    expect(served.map((n) => n.id)).toEqual([sana.id]);
    const [pleito] = await listProjectNotes(db, PROJECT, ["challenged"]);
    expect(pleito?.challenge).toMatchObject({ observed: "missing", sentinel: { target: "efimero.txt" } });
  });

  it("re-aprobar cierra el pleito y la nota vuelve a servirse limpia", async () => {
    const { addHumanNote, decideNote, listProjectNotes, setSentinels } = await import("@panoma/db");
    await writeFile(join(root, "temporal.txt"), "x");
    const note = await addHumanNote(db, { projectId: PROJECT, body: "Cuenta con temporal.txt." });
    if (!("id" in note)) throw new Error("no creó");
    await setSentinels(db, note.id, [{ kind: "path_exists", target: "temporal.txt", expected: true }]);

    await rm(join(root, "temporal.txt"));
    await patrolSentinels(db, { id: PROJECT, root });
    expect(await listProjectNotes(db, PROJECT)).toHaveLength(0);

    const verdict = await decideNote(db, note.id, "approved");
    expect(verdict).toMatchObject({ decided: true, body: "Cuenta con temporal.txt." });
    const [back] = await listProjectNotes(db, PROJECT);
    expect(back?.id).toBe(note.id);
    expect(back?.challenge).toBeNull();
  });

  it("una propuesta no se impugna: aún no se sirve a nadie", async () => {
    const { challengeNote, proposeNote } = await import("@panoma/db");
    const p = await proposeNote(db, { projectId: PROJECT, body: "todavía sin sí", createdBy: "claude" });
    if (!("id" in p)) throw new Error("no propuso");
    expect(
      await challengeNote(db, p.id, {
        at: new Date().toISOString(),
        sentinel: { kind: "path_exists", target: "x", expected: true },
        observed: "missing",
      }),
    ).toBe(false);
  });

  /*
    Since delivery C the column holds two generations. The anchors of the first are this
    patrol's; a check with a purpose and a `chk_` id is the worker patrol's (`memory-patrol.ts`),
    and reading it with the three-kind reader above would call a `manifest_script` «absent» and
    challenge a healthy note — which is what this case pins.
   */
  it("C01: a new-shape check beside a legacy anchor is left to the patrol, and the visit asks for its turn", async () => {
    const { addHumanNote, listProjectNotes, putCheck, setSentinels } = await import("@panoma/db");
    resetPatrolState();
    const added = await addHumanNote(db, { projectId: PROJECT, body: "The build is package.json's build script." });
    if (!("id" in added)) throw new Error("did not create the note");
    await setSentinels(db, added.id, [{ kind: "path_exists", target: "package.json", expected: true }]);
    const [note] = await listProjectNotes(db, PROJECT);
    // A check that fails today: the manifest defines no `deploy` script.
    const put = await putCheck(db, "note", added.id, { purpose: "grounds", kind: "manifest_script", target: "package.json", expected: { name: "deploy" } }, { memoryRev: note!.memoryRev });
    expect("checkId" in put).toBe(true);
    const [guarded] = await listProjectNotes(db, PROJECT);
    expect((guarded!.sentinels as unknown[]).map(isLegacyAnchor)).toEqual([true, false]);

    const result = await refreshProjectMemory(db, { id: PROJECT, root });
    expect(result).toEqual({ checked: 1, challenged: [] });
    expect((await listProjectNotes(db, PROJECT)).map((n) => n.id)).toEqual([added.id]);
    expect(await listProjectNotes(db, PROJECT, ["challenged"])).toHaveLength(0);
    expect(pendingPatrols()).toEqual([{ projectId: PROJECT, reason: "refresh" }]);
    resetPatrolState();
  });
});

describe("the patrol when the root is not on this disk", () => {
  /*
    The episode: an unmounted volume made every `path_exists` read as `missing`, and one pass
    challenged every anchored note of the project on that evidence. A root nobody can look at is
    "cannot verify", never "the anchor fell" — and the same reading covers the catalog served from
    another machine, which used to switch the delivery-time patrol off wholesale.
   */
  const originalUrl = process.env["DATABASE_URL"];

  async function anchored(body: string, target: string): Promise<string> {
    const { addHumanNote, setSentinels } = await import("@panoma/db");
    const note = await addHumanNote(db, { projectId: PROJECT, body });
    if (!("id" in note)) throw new Error("did not create the note");
    await setSentinels(db, note.id, [{ kind: "path_exists", target, expected: true }]);
    return note.id;
  }

  afterEach(() => {
    if (originalUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = originalUrl;
  });

  it("a missing root challenges nothing and reports every anchored note as unverified", async () => {
    const { listProjectNotes } = await import("@panoma/db");
    const first = await anchored("The build lives in ops/migrate.mjs.", "ops/migrate.mjs");
    const second = await anchored("Read package.json first.", "package.json");

    const gone = join(root, "unmounted-volume");
    const result = await patrolSentinels(db, { id: PROJECT, root: gone });

    expect(result).toEqual({ checked: 0, challenged: [], unverified: 2, skipped: "root-missing" });
    expect((await listProjectNotes(db, PROJECT)).map((n) => n.id).sort()).toEqual([first, second].sort());
    expect(await listProjectNotes(db, PROJECT, ["challenged"])).toHaveLength(0);
  });

  it("a root that is a file, not a directory, cannot be looked at either", async () => {
    await anchored("Count on ops/migrate.mjs.", "ops/migrate.mjs");
    const result = await patrolSentinels(db, { id: PROJECT, root: join(root, "package.json") });
    expect(result).toMatchObject({ checked: 0, challenged: [], unverified: 1, skipped: "root-missing" });
  });

  it("a root that is here keeps the old contract: checked, challenged, and no skip", async () => {
    await anchored("Count on ops/migrate.mjs.", "ops/migrate.mjs");
    const doomed = await anchored("Mind vanished.txt.", "vanished.txt");
    const result = await patrolSentinels(db, { id: PROJECT, root });
    expect(result.checked).toBe(2);
    expect(result.challenged.map((c) => c.noteId)).toEqual([doomed]);
    expect(result.unverified).toBeUndefined();
    expect(result.skipped).toBeUndefined();
  });

  it("with DATABASE_URL and the root on this disk, delivery still patrols and can challenge", async () => {
    const { listProjectNotes } = await import("@panoma/db");
    const doomed = await anchored("Mind vanished.txt.", "vanished.txt");
    process.env["DATABASE_URL"] = "postgres://catalog.invalid:5432/panoma";
    const result = await refreshProjectMemory(db, { id: PROJECT, root });
    expect(result.challenged.map((c) => c.noteId)).toEqual([doomed]);
    expect(result.skipped).toBeUndefined();
    expect((await listProjectNotes(db, PROJECT, ["challenged"])).map((n) => n.id)).toEqual([doomed]);
  });

  it("with DATABASE_URL and no root here, delivery reports the notes as unverified because the catalog is remote", async () => {
    const { listProjectNotes } = await import("@panoma/db");
    const kept = await anchored("Mind vanished.txt.", "vanished.txt");
    process.env["DATABASE_URL"] = "postgres://catalog.invalid:5432/panoma";
    const result = await refreshProjectMemory(db, { id: PROJECT, root: join(root, "elsewhere") });
    expect(result).toEqual({ checked: 0, challenged: [], unverified: 1, skipped: "remote" });
    expect((await listProjectNotes(db, PROJECT)).map((n) => n.id)).toEqual([kept]);
  });

  it("without DATABASE_URL and no root here, delivery names the local cause", async () => {
    await anchored("Mind vanished.txt.", "vanished.txt");
    const result = await refreshProjectMemory(db, { id: PROJECT, root: join(root, "elsewhere") });
    expect(result.skipped).toBe("root-missing");
    expect(result.unverified).toBe(1);
  });
});
