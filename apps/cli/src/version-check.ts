import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { panomaPath } from "@panoma/core";
import { say } from "./messages";

/**
 * If there is a newer version of Panoma, and say it once a day.
 *
 * **Why it is necessary.** Whoever installs via `npx` doesn't actually install anything: npm keeps
 * the package in its cache and reuses it, **and that cache does not update itself**. This happened
 * to create-react-app for years — people running a version from months ago without any reason to
 * suspect it. Here it is worse than a nuisance: database migrations only look forward, so an old
 * binary against a new catalog stops counting things without giving an error (see the guard in
 * `@panoma/db` ). The warning is the cheap way to prevent that from happening.
 *
 * **Why it does not contradict what the landing page promises.** The npm registry is queried for
 * the name «Panoma», which is literally the truth that the page already states about the
 * dependencies: «the only thing that comes up are names of public packages.» npm sees the request,
 * not us. **There is no telemetry here, and the difference is not one of degree**: if this asked a
 * server of ours, its logs would be a counter of active users and «Panoma has no server to send
 * anything to» would become false. That is why it queries npm and not Panoma.ai, and that is why
 * it is not changed without rereading this paragraph.
 *
 * **How it behaves.** It never blocks —two seconds of ceiling and onto the next thing—, it never
 * fails outward, and it doesn't ask more than once a day. It shuts down with
 * `PANOMA_NO_UPDATE_CHECK=1` for those who don't want it and for continuous integration
 * environments, where a network call per execution is noise and sometimes there is no output at
 * all.
 */

const CADA = 24 * 60 * 60 * 1000;
const TECHO_MS = 2_000;

function fichero(): string {
  return panomaPath("version.json");
}

type Memoria = { visto: number; ultima?: string };

async function leer(): Promise<Memoria | undefined> {
  const crudo = await readFile(fichero(), "utf8").catch(() => undefined);
  if (!crudo) return undefined;
  try {
    return JSON.parse(crudo) as Memoria;
  } catch {
    return undefined;
  }
}

async function guardar(memoria: Memoria): Promise<void> {
  await mkdir(dirname(fichero()), { recursive: true }).catch(() => undefined);
  await writeFile(fichero(), `${JSON.stringify(memoria, null, 2)}\n`, "utf8").catch(() => undefined);
}

/**
 * Is `candidata` after `actual`?
 *
 * Comparison by numeric parts and nothing else. A semver is not brought in from outside for a
 * twelve-line function, and what needs to be decided here is exactly that: whether the number on
 * the right is greater. Any prerelease suffix (`-rc.1`) is ignored when comparing, which is
 * correct: someone at `0.2.0-rc.1` should not get a notice to go to `0.2.0` as if it were
 * something else, and someone at `0.1.0` should see it.
 */
export function esMasNueva(candidata: string, actual: string): boolean {
  const partes = (v: string) =>
    v
      .split("-")[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));

  const a = partes(candidata);
  const b = partes(actual);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** What the record says is the last one. `undefined` if it could not be determined. */
async function preguntarANpm(): Promise<string | undefined> {
  try {
    const respuesta = await fetch("https://registry.npmjs.org/panoma/latest", {
      signal: AbortSignal.timeout(TECHO_MS),
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!respuesta.ok) return undefined;
    const cuerpo = (await respuesta.json()) as { version?: string };
    return typeof cuerpo.version === "string" ? cuerpo.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The notice, already composed, or `undefined` if there is nothing to say.
 *
 * `actual` is received instead of being read here to be able to test this without setting up a
 * package.
 */
export async function avisoDeVersion(
  actual: string | undefined,
  ): Promise<string | undefined> {
  if (!actual) return undefined;
  if (process.env["PANOMA_NO_UPDATE_CHECK"] === "1") return undefined;

  const memoria = await leer();
  const ahora = Date.now();

  let ultima = memoria?.ultima;
  if (!memoria || ahora - memoria.visto > CADA) {
    /*
      The visit is logged **even if the query fails**. Otherwise, a machine without a network
      would ask on each execution: two seconds of waiting each time, for nothing.
     */
    ultima = (await preguntarANpm()) ?? memoria?.ultima;
    await guardar({ visto: ahora, ...(ultima ? { ultima } : {}) });
  }

  if (!ultima || !esMasNueva(ultima, actual)) return undefined;
  /*
    The placeholders go in English like the rest of the identifiers; local variables keep their
    name because there is no contract with anyone there.
   */
  return say("version.newer", { latest: ultima, current: actual });
}
