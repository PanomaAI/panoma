import { detectToolchain } from "./detect";
import { applyBump, type BumpRequest } from "./recipes/bump";
import { stepFailed, type Step } from "./steps";
import { chooseIsolation, createExecutor, type Executor, type Isolation } from "./executor";
import {
  commitWorktree,
  createWorktree,
  diffWorktree,
  hasUncommittedChanges,
  isGitRepo,
} from "./worktree";

/**
 * Execution of a limited task.
 *
 * The plan says it straight: this is not a Devin, it is a dispatcher of small and verifiable
 * tasks. The three properties that make it acceptable:
 *
 * - **Measurable**: the tests pass or do not pass.
 * - **Reversible**: the result is a branch and a patch, never an applied change.
 * - **Isolated**: work is done in a temporary worktree; the user's tree is not touched.
 *
 * And one that is not in the result but in what it *doesn't* do: it doesn't publish. Neither push,
 * nor PR, nor anything that comes out of the machine. That is decided by a person looking at the
 * diff.
 */

export type RunStatus = "proposed" | "failed" | "no-changes";

export interface RunOutcome {
  status: RunStatus;
  /** With what level of isolation was it actually executed. */
  isolation: Isolation;
  /** If a higher level was requested and it was not possible, the reason. */
  isolationNote?: string;
  /** true only if there were tests and they passed. */
  verified: boolean;
  summary: string;
  branch?: string;
  patch?: string;
  commitSha?: string;
  steps: Step[];
}

export interface BumpRunInput extends BumpRequest {
  projectRoot: string;
  projectName: string;
  /** Requested level of isolation. Without it, the strongest one on the machine. */
  isolation?: Isolation;
}

const INSTALL_TIMEOUT = 420_000;
const TEST_TIMEOUT = 420_000;

export async function runDependencyBump(input: BumpRunInput): Promise<RunOutcome> {
  const steps: Step[] = [];
  // Before creating anything, we already know what we are going to run it with, so that even the
  // early failures indicate under what conditions they occurred.
  let isolation: Isolation = input.isolation ?? "hardened";
  // `chooseIsolation` is fine-tuned as soon as it is known whether there is a container; until
  // then, this value is only used if something fails before getting there.
  let isolationNote: string | undefined;

  const fail = (summary: string): RunOutcome => ({
    status: "failed",
    isolation,
    isolationNote,
    verified: false,
    summary,
    steps,
  });

  if (!(await isGitRepo(input.projectRoot))) {
    return fail(
      "El proyecto no es un repositorio git. Sin git no hay forma de aislar el cambio ni de deshacerlo.",
    );
  }

  if (await hasUncommittedChanges(input.projectRoot)) {
    return fail(
      "Hay cambios sin confirmar en el proyecto. Guárdalos primero: si no, el parche mezclaría tu trabajo con el nuestro.",
    );
  }

  const toolchain = await detectToolchain(input.projectRoot);
  if (!toolchain || toolchain.ecosystem !== input.ecosystem) {
    return fail(`No sé cómo instalar ni probar un proyecto ${input.ecosystem} en esta ruta.`);
  }

  const branch = `panoma/bump-${slug(input.packageName)}-${input.targetVersion}`;

  /*
    The level of isolation is decided **before** creating the worktree, because it determines
    where the worktree goes: the container needs it under the home and the macOS sandbox needs it
    outside. See `worktreeRoot` and `chooseIsolation`.
   */
  const choice = await chooseIsolation(input.isolation);
  isolation = choice.kind;
  isolationNote = choice.reason;

  let executor: Executor | undefined;
  let worktree;
  try {
    worktree = await createWorktree(input.projectRoot, branch, {
      underHome: choice.kind === "container",
    });
  } catch (error) {
    // The real reason matters: 'it couldn't be done' by itself forces debugging blindly.
    return fail(`No se pudo crear el worktree aislado: ${(error as Error).message.trim()}`);
  }

  // The branch only survives if the execution manages to produce a reviewable commit.
  let keepBranch = false;

  try {
    // ── 1. Editar el manifiesto ───────────────────────────────────────────────
    const edit = await applyBump(worktree.path, toolchain.manifest, input);

    // Two very different causes that were previously summarized in the same ambiguous phrase, and
    // that made it impossible to know whether the problem was with the catalog or with the
    // manifest.
    if (edit === "ya-en-destino") {
      return {
        status: "no-changes",
        isolation,
        verified: false,
        summary: `${input.packageName} ya está en ${input.targetVersion}.`,
        steps,
      };
    }
    if (edit === "no-declarado") {
      return {
        status: "no-changes",
        isolation,
        verified: false,
        summary: `${input.packageName} no aparece en ningún ${toolchain.manifest} del proyecto, o se declara como dependencia de git, ruta o SDK — que no se pueden subir de versión.`,
        steps,
      };
    }
    steps.push({
      name: "editar manifiesto",
      command: `${edit.file}: ${input.packageName} ${edit.before} → ${edit.after}`,
      exitCode: 0,
      durationMs: 0,
      output: "",
    });

    // ── 2. Instalar ───────────────────────────────────────────────────────────
    executor = createExecutor(choice, { cwd: worktree.path, image: toolchain.image });

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
      return fail(
        `La instalación falló al subir ${input.packageName} a ${input.targetVersion}. Probablemente hay un conflicto de versiones.`,
      );
    }

    /*
      ── 2a. Redo the dependencies that the project does allow ───────────────
      The list comes from what the project itself already declares for its manager —`allowBuilds`,
      `trustedDependencies`, `dependenciesMeta.built` — so there is nothing new to learn and the
      decision is versioned and reviewed in the diffs.
      It is done after installation and not during, because this way the permission is for a
      closed set of names instead of 'the whole tree.' The practical difference: a transient
      package that appears when the version is raised does not get in through the back door.
     */
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
        return fail(
          `Falló al rehacer las dependencias que el proyecto permite ` +
            `(${toolchain.allowedScripts.join(", ")}) tras subir ${input.packageName} a ` +
            `${input.targetVersion}.`,
        );
      }
    }

    /*
      ── 2b. The scripts of the project itself ───────────────────────────────────
      The installation ran with `--ignore-scripts`, which turns off the dashes of *all*
      dependencies — which is what we wanted — and along the way those of the project, which we
      didn't. Here, only theirs are recovered: their code was going to be run anyway when
      launching their tests, so it doesn't add any risk, and without them a project with
      `prepare`.
      (Husky, a previous build) skips some tests that pass on the host machine.
     */
    for (const script of toolchain.ownScripts) {
      // `preinstall` and `install` describe how to install, not how to prepare the already
      // installed tree; relaunching them here would cause strange things. `prepare` and
      // `postinstall` are the ones that leave the project ready to run.
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
        return fail(
          `El guion '${script}' del proyecto falló tras subir ${input.packageName} a ` +
            `${input.targetVersion}. Es código del propio proyecto, así que el cambio de ` +
            `versión puede no tener nada que ver.`,
        );
      }
    }

    // ── 3. Verificar ──────────────────────────────────────────────────────────
    let verified = false;
    if (toolchain.test) {
      const test = await executor.run({
        name: "tests",
        command: toolchain.test.command,
        args: toolchain.test.args,
        timeoutMs: TEST_TIMEOUT,
        // Tests should not need the internet: denying it is free and closes the most obvious
        // exfiltration path. Only the container can truly fulfill it.
        needsNetwork: false,
        // Avoid interactive modes and observers that would never finish.
        env: { CI: "1" },
      });
      steps.push(test);
      if (stepFailed(test)) {
        /*
          Here it is easy to lie without meaning to.
          With `--ignore-scripts`, a dependency that compiles a native binary in its `postinstall`
          (sharp, better-sqlite3, esbuild) gets stuck halfway, and its tests fail because of that
          and not because of the version we just uploaded. Saying "the update breaks something"
          would be a false accusation that is also recorded as a known issue and blocks the retry.
         */
        const caveat = toolchain.scriptsDisabled
          ? " Ojo: la instalación corrió sin los guiones de las dependencias" +
            (toolchain.allowedScripts.length > 0
              ? ` salvo ${toolchain.allowedScripts.join(", ")}`
              : "") +
            ", así que un paquete que compile algo en su postinstall fallaría aquí por eso " +
            "y no por la versión. Si es el caso, añádelo a la lista del gestor " +
            "(allowBuilds, trustedDependencies, dependenciesMeta.built) o a " +
            "panoma.guionesPermitidos, y vuelve a intentarlo."
          : "";
        return fail(
          `Los tests fallan con ${input.packageName} ${input.targetVersion}. La actualización rompe algo.${caveat}`,
        );
      }
      verified = true;
    }

    // What the executor could not accomplish is added to the note, it is not lost: the execution
    // record must be able to say 'verified, but the tests ran over the network.'
    const unmetPromise = executor.unmetPromise?.();
    if (unmetPromise) {
      isolationNote = isolationNote ? `${isolationNote}. Además, ${unmetPromise}` : unmetPromise;
    }

    // Let it be noted in the execution record: whoever reviews the patch has to know under what
    // conditions it was tested, and 'without running the postinstalls' changes the meaning of a
    // green as much as a red would.
    /*
      The project's tests are code of the project.
      `npm run test` runs whatever `scripts.test` specifies, and in a cloned repository that was
      written by someone else. The installation now comes with `--ignore-scripts`; the tests, by
      definition, cannot: running them *is* the verification. Outside of a container, that is
      someone else's code with your user and your disk, and anyone who reads 'verified' has to be
      able to know under what conditions it was verified.
     */
    if (verified && isolation !== "container") {
      /*
        The sentence comes from `executor.describe` and not from a table written here.
        The first version said 'with the environment clean but seeing your disk' for everything
        that wasn't a container, and as soon as `hardened` started closing the personal folder
        with the macOS sandbox, that phrase became false — the opposite of usual, promising *less*
        than what is given, but just as false. A description of isolation that lives far from
        isolation becomes unsynchronized the day one changes.
       */
      isolationNote = [
        isolationNote,
        `los tests son código del propio repositorio y corrieron fuera de un contenedor ` +
          `(${executor.describe})`,
      ]
        .filter(Boolean)
        .join(". Además, ");
    }

    if (toolchain.scriptsDisabled) {
      const bits = ["se instaló sin ejecutar los guiones de las dependencias"];
      if (toolchain.allowedScripts.length > 0) {
        bits.push(`salvo los que el proyecto permite (${toolchain.allowedScripts.join(", ")})`);
      }
      /*
        The case that needs to be said out loud: the package being uploaded is on the list, so
        **its own script ran**, and in the new version. That the project trusts a package is not
        the same as trusting any future version of it, and whoever reviews the patch deserves to
        know it without having to deduce it.
       */
      if (toolchain.allowedScripts.includes(input.packageName)) {
        bits.push(
          `OJO: ${input.packageName} está en esa lista, así que se ejecutó su guion de ` +
            `instalación ya en la versión ${input.targetVersion}`,
        );
      }
      if (toolchain.ownScripts.length > 0) {
        bits.push(`los del propio proyecto (${toolchain.ownScripts.join(", ")}) se lanzaron aparte`);
      }
      const note = bits.join("; ");
      isolationNote = isolationNote ? `${isolationNote}. Además, ${note}` : note;
    }

    // ── 4. Empaquetar la propuesta ────────────────────────────────────────────
    const patch = await diffWorktree(worktree.path);
    const message =
      `chore(deps): subir ${input.packageName} a ${input.targetVersion}\n\n` +
      (verified
        ? "Los tests del proyecto pasan con esta versión.\n"
        : "Sin tests que ejecutar: este cambio NO está verificado.\n") +
      "\nPropuesto por panoma.\n";
    const commitSha = await commitWorktree(worktree.path, message);
    keepBranch = commitSha !== undefined;

    return {
      status: "proposed",
      isolation,
      isolationNote,
      verified,
      summary: verified
        ? `${input.packageName} ${edit.before} → ${edit.after}, con los tests en verde.`
        : `${input.packageName} ${edit.before} → ${edit.after}. El proyecto no tiene tests, así que nadie ha comprobado que siga funcionando.`,
      branch,
      patch,
      commitSha,
      steps,
    };
  } finally {
    await executor?.dispose();
    // The temporary worktree is always destroyed —leaving it would be a disk leak on each run— but
    // the branch with the commit remains in the repository if there was a proposal. Without that,
    // the CLI would promise a branch that does not exist.
    await worktree.dispose({ keepBranch });
  }
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
