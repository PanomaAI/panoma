import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { isNewerVersion, panomaPath } from "@panoma/core";
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
 * What the record says is the last one. `undefined` if it could not be determined.
 *
 * **The `accept` is `application/json` and not npm's abbreviated format**, and that is not a
 * detail. The abbreviated document (`application/vnd.npm.install-v1+json`) is defined for the
 * package's full packument, not for `/<name>/latest`, and the registry answers **406 Not
 * Acceptable** to that combination — measured three times out of three on 7-Sep-2026, from Node
 * and from curl. Every non-200 comes back here as "no answer", so the failure was invisible: the
 * visit was stamped, nothing was learnt, and nobody was ever told about a release. It had worked
 * earlier the same day, which is the worst version of the bug — the edge tolerates it sometimes,
 * so it does not fail in a way anyone would notice.
 *
 * Asking `/latest` for plain JSON is the supported shape and returns a few kilobytes.
 */
async function preguntarANpm(): Promise<string | undefined> {
  try {
    const respuesta = await fetch("https://registry.npmjs.org/panoma/latest", {
      signal: AbortSignal.timeout(TECHO_MS),
      headers: { accept: "application/json" },
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
  /**
   * Whether anybody asked for this run.
   *
   * `panoma up --on-boot` starts at every login with its output going to a log, to the journal or
   * appended on Windows: the notice was printed where nobody would ever read it and —worse— it
   * spent the machine's one question of the day doing it, usually before the Wi-Fi was up. That
   * stamps the visit with no answer and silences every command typed afterwards until tomorrow. A
   * notice nobody can read is not worth a question.
   *
   * The signal is the mark the boot service carries (`PANOMA_ON_BOOT`, written by `on-boot.ts`)
   * and **not** `process.stdout.isTTY`. The terminal test would have covered this case and taken
   * the notice away from a real person in Git Bash on Windows, where a Node process sees a pipe
   * and not a console. This one is exact: it is true of the run nobody asked for and of no other.
   *
   * And the catalog covers what this stops covering: it asks once a day on its own while it is up
   * (`apps/web/lib/version-refresh.ts`), sharing this same file and this same clock.
   */
  watched: boolean = process.env["PANOMA_ON_BOOT"] !== "1",
): Promise<string | undefined> {
  if (!actual || !watched) return undefined;
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

  if (!ultima || !isNewerVersion(ultima, actual)) return undefined;
  /*
    The placeholders go in English like the rest of the identifiers; local variables keep their
    name because there is no contract with anyone there.
   */
  return say("version.newer", { latest: ultima, current: actual });
}
