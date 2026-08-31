import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { detectToolchain } from "./detect";
import { stepFailed, type Step } from "./steps";
import { chooseIsolation, createExecutor, type Executor, type Isolation } from "./executor";
import { createWorktree, hasUncommittedChanges, isGitRepo } from "./worktree";

const git = promisify(execFile);

/**
 * Does this still compile?
 *
 * It is the first question when returning to a project after months, and the only one that static
 * analysis cannot answer: the health of the record *deduces*, this *demonstrates*. The answer is
 * saved with a date so that the record can say 'compiled on August 18 in 41 seconds' or 'broken
 * since May: OPENAI_API_KEY is missing' — which is exactly what one needs to know before deciding
 * whether to resume today or on the weekend.
 *
 * The border that separates this from the orchestrators' graveyard: Panoma **checks and
 * remembers**, it does not manage environments nor watch nor deploy. A verdict with a date, and
 * that's it.
 *
 * Three rules inherited from the proposals (`execute.ts`) and one of its own:
 *
 * - **The user's tree is not touched.** Everything runs in a temporary worktree from HEAD; neither
 * `node_modules`, nor `dist`, nor lockfiles appear in your folder. For that reason, if there are
 * uncommitted changes, the verdict refers to the last commit — and it says so.
 * - **Same isolation as the proposals.** The installation goes without dependency scripts, and the
 * build —which is code from the repository itself— runs at the chosen level: container if there is
 * one, if not the macOS sandbox, and the sheet indicates which one it was.
 * - **Nothing is invented.** Without git, without a known toolchain, or without a declared build
 * script, the verdict says it exactly as it is instead of improvising a plausible command.
 * - **Leaves nothing.** Unlike a proposal, here not even the branch survives: the only product is
 * the verdict.
 */

export type BuildCheckStatus = "ok" | "failed" | "no-git" | "no-toolchain" | "no-build";

export interface BuildCheckOutcome {
  status: BuildCheckStatus;
  /** The isolation level under which it actually ran. */
  isolation: Isolation;
  isolationNote?: string;
  /** The command that proves or disproves, e.g. `pnpm run build`. */
  command?: string;
  durationMs: number;
  /** Only on failure: the tail of the output of the step that broke. */
  reason?: string;
  /** The checked commit (project HEAD when executing). */
  sha?: string;
  /** There were unconfirmed changes: the verdict talks about the last commit, not about your tree. */
  dirty?: boolean;
  summary: string;
  steps: Step[];
}

export interface BuildCheckInput {
  projectRoot: string;
  projectName: string;
  /** Requested level of isolation. Without it, the strongest one on the machine. */
  isolation?: Isolation;
}

const INSTALL_TIMEOUT = 420_000;
const BUILD_TIMEOUT = 600_000;

/** The same names and the same order that `runbook.ts` recognizes as build. */
const BUILD_SCRIPTS = ["build", "compile"];

/** The tail of the output: where the real error lives in a build log. */
function tail(output: string, chars = 700): string {
  const text = output.trim();
  return text.length <= chars ? text : `…${text.slice(-chars)}`;
}

export async function runBuildCheck(input: BuildCheckInput): Promise<BuildCheckOutcome> {
  const steps: Step[] = [];
  const startedAt = Date.now();
  let isolation: Isolation = input.isolation ?? "hardened";
  let isolationNote: string | undefined;

  const done = (
    status: BuildCheckStatus,
    summary: string,
    extra: Partial<BuildCheckOutcome> = {},
  ): BuildCheckOutcome => ({
    status,
    isolation,
    isolationNote,
    durationMs: Date.now() - startedAt,
    summary,
    steps,
    ...extra,
  });

  if (!(await isGitRepo(input.projectRoot))) {
    return done(
      "no-git",
      "El proyecto no está en git, y sin git no hay worktree: comprobar la build aquí " +
        "significaría ejecutarla dentro de tu carpeta, y eso no se hace.",
    );
  }

  const dirty = await hasUncommittedChanges(input.projectRoot);

  const toolchain = await detectToolchain(input.projectRoot);
  if (!toolchain) {
    return done("no-toolchain", "No sé cómo instalar ni compilar lo que hay en esta ruta.");
  }

  /*
    The build script comes from manifest of the project itself, with the same names recognized by
    the runbook. Flutter is intentionally left out: `flutter build` requires a target (apk, web,
    ios) and choosing it by the project would be making it up.
   */
  if (toolchain.ecosystem !== "npm") {
    return done(
      "no-build",
      `Todavía no sé comprobar la build de un proyecto ${toolchain.ecosystem}: su build necesita decisiones (el destino) que no me toca tomar.`,
    );
  }
  const manifest = await readFile(join(input.projectRoot, "package.json"), "utf8")
    .then((raw) => JSON.parse(raw) as { scripts?: Record<string, string> })
    .catch(() => undefined);
  const scriptName = BUILD_SCRIPTS.find((name) => manifest?.scripts?.[name]);
  if (!scriptName) {
    return done(
      "no-build",
      "El proyecto no declara ningún guion de build (ni `build` ni `compile` en " +
        "package.json). No se inventa uno: un comando plausible que falla cuesta más " +
        "que decir la verdad.",
    );
  }
  const manager = toolchain.install.command;
  const command = `${manager} run ${scriptName}`;

  let sha: string | undefined;
  try {
    const { stdout } = await git("git", ["-C", input.projectRoot, "rev-parse", "--short", "HEAD"], {
      timeout: 15_000,
    });
    sha = stdout.trim() || undefined;
  } catch {
    // A newly created repo without commits: the worktree will later fail with its own reason.
  }

  const choice = await chooseIsolation(input.isolation);
  isolation = choice.kind;
  isolationNote = choice.reason;

  let executor: Executor | undefined;
  let worktree;
  try {
    worktree = await createWorktree(input.projectRoot, "panoma/check", {
      underHome: choice.kind === "container",
    });
  } catch (error) {
    return done("failed", `No se pudo crear el worktree aislado: ${(error as Error).message.trim()}`, {
      command,
      sha,
      dirty,
    });
  }

  try {
    executor = createExecutor(choice, { cwd: worktree.path, image: toolchain.image });

    // ── 1. Install, without dependency dashes ──────────────────────────────
    const install = await executor.run({
      name: "install",
      command: toolchain.install.command,
      args: toolchain.install.args,
      timeoutMs: INSTALL_TIMEOUT,
      needsNetwork: true,
      env: toolchain.install.env,
    });
    steps.push(install);
    if (stepFailed(install)) {
      return done("failed", "La instalación falló antes de llegar a la build.", {
        command,
        sha,
        dirty,
        reason: tail(install.output),
      });
    }

    // ── 1a. Redo the dependencies that the project does allow ───────────────
    if (toolchain.rebuild && toolchain.allowedScripts.length > 0) {
      const rebuild = await executor.run({
        name: "rehacer permitidos",
        command: toolchain.rebuild.command,
        args: [...toolchain.rebuild.args, ...toolchain.allowedScripts],
        timeoutMs: INSTALL_TIMEOUT,
        needsNetwork: true,
      });
      steps.push(rebuild);
      if (stepFailed(rebuild)) {
        return done(
          "failed",
          `Falló al rehacer las dependencias que el proyecto permite (${toolchain.allowedScripts.join(", ")}).`,
          { command, sha, dirty, reason: tail(rebuild.output) },
        );
      }
    }

    // ── 1b. The scripts of the project itself ───────────────────────────────────
    for (const script of toolchain.ownScripts) {
      if (script !== "prepare" && script !== "postinstall") continue;
      const step = await executor.run({
        name: `guion ${script}`,
        command: toolchain.install.command,
        args: ["run", script],
        timeoutMs: INSTALL_TIMEOUT,
        needsNetwork: true,
      });
      steps.push(step);
      if (stepFailed(step)) {
        return done("failed", `El guion '${script}' del propio proyecto falló antes de la build.`, {
          command,
          sha,
          dirty,
          reason: tail(step.output),
        });
      }
    }

    // ── 2. La build ───────────────────────────────────────────────────────────
    const build = await executor.run({
      name: "build",
      command: manager,
      args: ["run", scriptName],
      timeoutMs: BUILD_TIMEOUT,
      // Compiling shouldn't need the internet: denying it is free and closes the most obvious
      // exfiltration path. Only the container can truly fulfill it.
      needsNetwork: false,
      // Avoid interactive modes and observers that would never finish.
      env: { CI: "1" },
    });
    steps.push(build);

    // The build is code from the repository itself, just like the tests of a proposal: outside a
    // container, whoever reads the verdict deserves to know under what conditions it ran.
    if (isolation !== "container") {
      isolationNote = [
        isolationNote,
        `la build es código del propio repositorio y corrió fuera de un contenedor (${executor.describe})`,
      ]
        .filter(Boolean)
        .join(". Además, ");
    }
    const unmetPromise = executor.unmetPromise?.();
    if (unmetPromise) {
      isolationNote = isolationNote ? `${isolationNote}. Además, ${unmetPromise}` : unmetPromise;
    }

    if (stepFailed(build)) {
      const caveat = toolchain.scriptsDisabled
        ? " Ojo: la instalación corrió sin los guiones de las dependencias" +
          (toolchain.allowedScripts.length > 0
            ? ` salvo ${toolchain.allowedScripts.join(", ")}`
            : "") +
          ", así que un paquete que compile algo en su postinstall fallaría aquí por eso y no " +
          "por tu código."
        : "";
      return done("failed", `La build falla con \`${command}\`.${caveat}`, {
        command,
        sha,
        dirty,
        reason: tail(build.output),
      });
    }

    const seconds = Math.round((Date.now() - startedAt) / 1000);
    return done(
      "ok",
      `Compila. \`${command}\` terminó en verde (${seconds}s desde cero, instalación incluida).`,
      { command, sha, dirty },
    );
  } finally {
    await executor?.dispose();
    // Unlike a proposal, nothing survives here: neither worktree nor branch. The only product of a
    // check is the verdict.
    await worktree.dispose();
  }
}
