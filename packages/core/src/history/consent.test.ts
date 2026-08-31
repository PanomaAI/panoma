import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consentState,
  isAllowed,
  publishesInferred,
  readConsent,
  setConsent,
  setInferredConsent,
  type TwinConsent,
} from "./consent";
import type { HistorySourceId } from "./inventory";

/**
 * This module is the gateway to what reads the most intimate file on the disk, so what needs to be
 * upheld here is not that it stores and retrieves a boolean—anyone can do that—but the three
 * promises for which it exists:
 *
 * 1. **Anything that is not an explicit yes is a no.** Without a file, unreadable, corrupt, with a
 * value that is not boolean or with a JSON that isn't even an object: false. Corruption is the
 * dangerous case, because it is the only one in which a hastily written module could end up
 * granting what no one granted.
 * 2. **The permission is from each source.** Saying yes to one does not say anything about the
 * other four, nor does it delete them when saving.
 * 3. **The decision can be read and erased by hand**, in `twin.json` within `PANOMA_HOME`, and
 * only its owner can touch it.
 *
 * The tests use the environment variable and not a hidden parameter: `PANOMA_HOME` is the same as
 * what separates two real catalogs, so testing there also tests the path that people use.
 */

const SOURCES: HistorySourceId[] = ["claude-code", "codex", "cursor", "aider"];

let root = "";
let cases = 0;
let previous: string | undefined;

beforeAll(() => {
  // `realpathSync` because on macOS `/var` is a link to `/private/var`, and here manually written
  // paths are compared to those resolved by the module.
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-consentimiento-")));
  previous = process.env["PANOMA_HOME"];
});

afterAll(() => {
  // Return the variable as it was, do not delete it: the vitest process is just one, and the next
  // test file inherits the environment we leave.
  if (previous === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previous;
  rmSync(root, { recursive: true, force: true });
});

/**
 * A new Panoma house for each case, marked with `PANOMA_HOME`.
 *
 * The folder **is not created** unless a file needs to be placed inside: thus the common case for
 * tests is that of a newly installed machine, where `~/.panoma` does not yet exist and the first
 * permission is the first thing written there.
 */
function newHome(contents?: string): string {
  cases += 1;
  const home = join(root, `caso-${cases}`, ".panoma");
  process.env["PANOMA_HOME"] = home;

  if (contents !== undefined) {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "twin.json"), contents, "utf8");
  }

  return home;
}

/** What is saved on the disk, just as it is, without going through the module's reader. */
function onDisk(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, "twin.json"), "utf8")) as Record<string, unknown>;
}

function niAUnaFuente(consent: TwinConsent): void {
  for (const source of SOURCES) {
    expect(isAllowed(consent, source), `${source} salió concedida`).toBe(false);
  }
}

/**
 * That only the owner can touch the file, in each system's language. It is the same check as
 * `access.json` and for the same reason, although here what is inside is not a secret: whoever can
 * **write** this grants themselves the reading of the history without the permission screen ever
 * being drawn.
 */
async function soloSuDueno(path: string): Promise<void> {
  if (process.platform !== "win32") {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    return;
  }

  const { stdout } = await promisify(execFile)("icacls", [path]);
  expect(stdout, stdout).not.toMatch(/\b(Everyone|Todos)\b/i);
  expect(stdout, stdout).not.toMatch(/BUILTIN\\(Users|Usuarios)/i);
}

describe("lo que no es un sí explícito", () => {
  it("sin fichero no hay permiso para nada", async () => {
    newHome();

    const consent = await readConsent();

    expect(consent.sources).toEqual({});
    expect(consent.updatedAt).toBeUndefined();
    niAUnaFuente(consent);
  });

  it("un JSON cortado por la mitad no concede nada", async () => {
    // What is left by a process that dies writing, which is what renaming protects. If it were also
    // read as a yes, corruption would be a permission.
    newHome('{\n  "sources": {\n    "claude-code": tr');

    niAUnaFuente(await readConsent());
  });

  it("un JSON válido que no es un objeto tampoco", async () => {
    for (const body of ["[]", '["claude-code"]', "42", '"claude-code"', "null"]) {
      newHome(body);
      niAUnaFuente(await readConsent());
    }
  });

  it("un fichero ilegible se responde con un no, no con un error", async () => {
    // A directory where there should have been a file: it is `EISDIR` which can occur in all three
    // systems, without depending on `chmod 000` meaning anything.
    const home = newHome();
    mkdirSync(join(home, "twin.json"), { recursive: true });

    niAUnaFuente(await readConsent());
  });

  it("un valor que no es booleano no es una decisión", async () => {
    newHome('{"sources":{"claude-code":"sí","codex":1,"cursor":null,"aider":{}}}');

    const consent = await readConsent();

    expect(consent.sources).toEqual({});
    niAUnaFuente(consent);
  });

  it("las fuentes que el fichero no nombra empiezan en no", async () => {
    // It is the property that makes it unnecessary to migrate anything when a new reader comes in:
    // what is not written is a no, not a 'ask again'.
    newHome('{"sources":{"claude-code":true}}');

    const consent = await readConsent();

    expect(isAllowed(consent, "claude-code")).toBe(true);
    for (const source of SOURCES.filter((id) => id !== "claude-code")) {
      expect(isAllowed(consent, source), `${source} salió concedida`).toBe(false);
    }
  });

  it("una fuente desconocida en el fichero ni rompe ni sobrevive", async () => {
    const home = newHome('{"sources":{"gemini":true,"claude-code":true},"updatedAt":"ayer"}');

    const consent = await readConsent();
    expect(isAllowed(consent, "claude-code")).toBe(true);
    expect(consent.sources).toEqual({ "claude-code": true });

    // And when saving it is lost, on purpose: a yes written by hand for a source that does not
    // exist today cannot become permission the day it exists.
    await setConsent("codex", true);
    expect(onDisk(home)["sources"]).toEqual({ "claude-code": true, codex: true });
  });
});

describe("guardar una decisión", () => {
  it("se escribe donde se puede leer y borrar a mano", async () => {
    const home = newHome();

    const saved = await setConsent("claude-code", true);

    expect(saved.sources["claude-code"]).toBe(true);
    // The folder Panoma did not exist: the first permission is the first thing that is saved.
    expect(existsSync(join(home, "twin.json"))).toBe(true);
    expect(onDisk(home)["sources"]).toEqual({ "claude-code": true });
  });

  it("y se vuelve a encontrar en una lectura nueva", async () => {
    newHome();

    await setConsent("codex", true);
    const consent = await readConsent();

    expect(isAllowed(consent, "codex")).toBe(true);
    expect(isAllowed(consent, "claude-code")).toBe(false);
    expect(Date.parse(consent.updatedAt ?? "")).not.toBeNaN();
  });

  it("el segundo permiso no borra el primero", async () => {
    const home = newHome();

    await setConsent("claude-code", true);
    await setConsent("codex", true);

    // The five decisions live in the same file: saying yes to Codex cannot withdraw the yes that
    // was given to Claude Code last week.
    const consent = await readConsent();
    expect(isAllowed(consent, "claude-code")).toBe(true);
    expect(isAllowed(consent, "codex")).toBe(true);
    expect(onDisk(home)["sources"]).toEqual({ "claude-code": true, codex: true });
  });

  it("revocar deja un no escrito, y solo el de esa fuente", async () => {
    const home = newHome();

    await setConsent("claude-code", true);
    await setConsent("cursor", true);
    await setConsent("claude-code", false);

    const consent = await readConsent();
    expect(isAllowed(consent, "claude-code")).toBe(false);
    expect(isAllowed(consent, "cursor")).toBe(true);
    // The refusal is saved instead of deleting the key: whoever reads it later sees that a
    // decision was made, not that it was never asked.
    expect(onDisk(home)["sources"]).toEqual({ "claude-code": false, cursor: true });
  });

  it("sella la fecha en cada cambio", async () => {
    newHome();

    const first = await setConsent("aider", true);
    const second = await setConsent("aider", false);

    expect(Date.parse(first.updatedAt ?? "")).not.toBeNaN();
    // Both timestamps are ISO 8601, so comparing strings is comparing instants. It is not required
    // that the second one is greater: two consecutive writes can fit in the same millisecond, and
    // the Windows clock jumps by fifteen at a time.
    expect((second.updatedAt ?? "") >= (first.updatedAt ?? "")).toBe(true);
  });

  it("no deja temporales por medio", async () => {
    const home = newHome();

    await setConsent("aider", true);

    expect(readdirSync(home).filter((name) => name.includes(".tmp"))).toEqual([]);
    expect(readdirSync(home)).toEqual(["twin.json"]);
  });

  it("solo lo puede tocar su dueño", async () => {
    const home = newHome();

    await setConsent("claude-code", true);

    await soloSuDueno(join(home, "twin.json"));
  });

  it("el parámetro `home` manda sobre la variable", async () => {
    // Whoever already has their catalog folder resolved should not have to touch the process
    // environment to tell a function.
    const variable = newHome();
    const aparte = join(root, `aparte-${cases}`);

    await setConsent("codex", true, aparte);

    expect(existsSync(join(variable, "twin.json"))).toBe(false);
    expect(onDisk(aparte)["sources"]).toEqual({ codex: true });
    expect(isAllowed(await readConsent(aparte), "codex")).toBe(true);
    expect(isAllowed(await readConsent(), "codex")).toBe(false);
  });
});

describe("isAllowed", () => {
  it("responde sobre lo ya leído, sin volver al disco", async () => {
    const home = newHome();
    await setConsent("cursor", true);
    const consent = await readConsent();

    // The entire catalog disappears and the answer remains the same: whoever renders the screen asks
    // about the four sources on a single object.
    rmSync(home, { recursive: true, force: true });

    expect(isAllowed(consent, "cursor")).toBe(true);
    expect(isAllowed(consent, "aider")).toBe(false);
  });

  it("un consentimiento a medio construir es un no", () => {
    // It receives whatever the caller provides, including a hand-made object from the layer above. Only
    // `true` grants it.
    expect(isAllowed({ sources: {} }, "claude-code")).toBe(false);
    expect(isAllowed({} as TwinConsent, "claude-code")).toBe(false);
    expect(isAllowed({ sources: { "claude-code": false } }, "claude-code")).toBe(false);
    expect(isAllowed({ sources: { "claude-code": true } }, "claude-code")).toBe(true);
  });
});

/**
 * The only question that Twin asks no one, and the promise that sustains it.
 *
 * When closing the review queue, something happened that must be faced head-on: **something that
 * no one has signed cannot speak on behalf of the person** in each session of each agent. Before,
 * there were hundreds of decisions; now there is one. And a question that has not been answered
 * cannot be read as answered — that is exactly what a permission screen exists to prevent.
 */
describe("el permiso de lo que la máquina deduce sola", () => {
  it("sin contestar no concede nada, y eso no es lo mismo que un no", async () => {
    newHome();
    const consent = await readConsent();
    expect(consent.inferred, "no hay respuesta").toBeUndefined();
    expect(publishesInferred(consent), "y sin respuesta no baja nada").toBe(false);
  });

  it("un sí se guarda y se lee", async () => {
    newHome();
    await setInferredConsent(true);
    expect(publishesInferred(await readConsent())).toBe(true);
  });

  it("y se puede retirar", async () => {
    newHome();
    await setInferredConsent(true);
    await setInferredConsent(false);
    const consent = await readConsent();
    expect(consent.inferred, "el no queda escrito, que no es lo mismo que borrarlo").toBe(false);
    expect(publishesInferred(consent)).toBe(false);
  });

  /*
    The permissions of the stories and this one live in the same file, so replying to one cannot
    delete the others. It is the same as what is already requested from `setConsent` among
    sources.
   */
  it("contestar no toca los permisos de las historias", async () => {
    newHome();
    await setConsent("claude-code", true);
    await setInferredConsent(true);

    const consent = await readConsent();
    expect(isAllowed(consent, "claude-code")).toBe(true);
    expect(publishesInferred(consent)).toBe(true);
  });

  it("ni al revés", async () => {
    newHome();
    await setInferredConsent(true);
    await setConsent("codex", true);

    const consent = await readConsent();
    expect(publishesInferred(consent)).toBe(true);
    expect(isAllowed(consent, "codex")).toBe(true);
  });

  /* Anything that is not a boolean is a half-file, and nothing comes out of a half-file. */
  it("cualquier cosa que no sea un booleano no concede", async () => {
    for (const raro of ['"sí"', "1", "null", "{}"]) {
      newHome(`{"sources":{},"inferred":${raro}}`);
      expect(publishesInferred(await readConsent()), raro).toBe(false);
    }
  });

  /*
    It is removed with `rm`: a permission that can only be removed from the application is not a
    permission.
   */
  it("borrar el fichero lo retira", async () => {
    const home = newHome();
    await setInferredConsent(true);
    rmSync(join(home, "twin.json"));
    expect(publishesInferred(await readConsent())).toBe(false);
  });
});

/**
 * The situation of each story, which is what decides what is offered and what is not.
 *
 * It is the ruler that reads the screen one looks at **before** saying yes, so it is the one that
 * cannot lie in any direction: it cannot hide that a story does not yet have permission — whoever
 * sees it measured at 3.63 GB will assume it is going to be read — and it cannot grant permission
 * for Cursor, which is measured with `stat` but whose format still has no reader. Asking for a yes
 * in exchange for nothing is worse than not asking for it.
 *
 * It lives here since it is asked by two surfaces —the terminal and the web—, and that is why it
 * is tested here: copied in both, the day a new reader enters one would say ‘grant permission’ and
 * the other ‘we still don't know how to read this’ about the same folder.
 */
describe("la situación de una historia respecto del permiso", () => {
  it("sin lector gana a todo lo demás, aunque la carpeta esté llena y permitida", () => {
    expect(consentState({ present: true }, true, false)).toBe("noReader");
    expect(consentState({ present: true }, false, false)).toBe("noReader");
  });

  /*
    A granted permission is still visible even if the tool is no longer on the disk: it lives in
    `twin.json` and not in the folder, so hiding it would leave a living yes that cannot be
    removed from the screen that requested it. A permission that cannot be seen cannot be revoked.
   */
  it("un sí concedido se ve aunque la historia ya no esté en el disco", () => {
    expect(consentState({ present: false }, true, true)).toBe("allowed");
  });

  it("y solo lo que no está y nadie ha permitido se queda sin oferta", () => {
    expect(consentState({ present: false }, false, true)).toBe("absent");
    expect(consentState({ present: true }, false, true)).toBe("denied");
  });

  /*
    Aider is absent on every machine and by inventory decision: it writes within each repository,
    so there is no machine figure to give. The absence beats the 'without reader,' which says that
    here it is measured — to lie about the only source that is never measured, and on top of that
    in the line that already said 'not present'.
   */
  it("la que no está y además no tiene lector se queda callada, no medida", () => {
    expect(consentState({ present: false }, false, false)).toBe("absent");
  });
});
