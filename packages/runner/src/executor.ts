import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Step } from "./steps";
import { resolveExecutable } from "@panoma/core";

/**
 * Where the commands of a proposal are executed.
 *
 * The worktree isolates **the changes**: nothing that the pull request does touches your folder.
 * But the commands still run on your machine, and a `postinstall` from a dependency runs with your
 * permissions, your network, and your credentials. That is a real hole, and the answer is not a
 * single thing but rather a scale:
 *
 * | level | protects | cost |
 * |---|---|---|
 * | `local` | nothing; only the changes | none |
 * | `hardened` | your environment variables, and on macOS your entire personal folder | none |
 * | `container` | also the network, the rest of the disk, processes and resources | Docker or
 * Podman |
 *
 * `hardened` closes your personal folder with `sandbox-exec` when it exists — that is, on macOS.
 * On Linux and Windows it stays in cleaning the environment, and **it says it**: the level does
 * not promise the same everywhere, and pretending that it does would be worse than the difference.
 *
 * And there is a step that is not of the dependency but of the repository itself: `npm run test`
 * executes whatever `scripts.test` specifies, which in a cloned project was written by a stranger.
 * The installation already goes without dashes; the tests, by definition, cannot. Outside of a
 * container, that is someone else's code running with your user, and that is why it is recorded in
 * the execution record.
 *
 * Each execution records the level it ran at, because a proposal verified inside a container
 * deserves more trust than one verified on the host, and hiding it would make the two seem the
 * same.
 */
export type Isolation = "local" | "hardened" | "container";

export interface ExecRequest {
  name: string;
  command: string;
  args: string[];
  /** Relative path to the working directory within the environment. */
  timeoutMs?: number;
  env?: Record<string, string>;
  /** This step needs to go online. Only `container` can deny it. */
  needsNetwork?: boolean;
}

export interface Executor {
  readonly isolation: Isolation;
  /** Short phrase for the interface: what it really protects. */
  readonly describe: string;
  run(request: ExecRequest): Promise<Step>;
  dispose(): Promise<void>;
  /**
   * What was requested and could not be fulfilled during execution.
   *
   * Different from `describe`, which states what the level promises **before** starting. This is
   * filled in when something fails halfway and the promise stops being valid: for example, denying
   * the network to the tests and the disconnection order fails. Without this channel, the
   * execution was saved as 'container, tests without network' having run with network, which is
   * exactly the lie that isolation exists to avoid telling.
   */
  unmetPromise?(): string | undefined;
}

const MAX_OUTPUT = 16_000;

/** Launch a process and capture everything. Shared by the executors who use the host. */
function spawnStep(
  request: ExecRequest,
  cwd: string,
  env: NodeJS.ProcessEnv,
  command = request.command,
  args = request.args,
): Promise<Step> {
  const started = Date.now();

  return new Promise((resolve) => {
    /*
      What is launched may not be called the same as what was requested: in Windows `npm` it is a
      `npm.cmd`, which is not a program but a script that only `cmd.exe` knows how to read. What
      is **saved** further below is still the original command: whoever reads the execution wants
      to see `npm test`, not the `cmd.exe` line that was needed to start it.
     */
    const launch = resolveExecutable(command, args);
    const child = spawn(launch.file, launch.args, { cwd, env, shell: false });

    let output = "";
    const append = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString();
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timer = setTimeout(() => child.kill("SIGKILL"), request.timeoutMs ?? 300_000);

    const finish = (exitCode: number | null, extra = "") => {
      clearTimeout(timer);
      resolve({
        name: request.name,
        command: `${request.command} ${request.args.join(" ")}`.trim(),
        exitCode,
        durationMs: Date.now() - started,
        output: (output + extra).slice(0, MAX_OUTPUT),
      });
    };

    child.on("error", (error) => finish(null, `\n${error.message}`));
    child.on("close", (code) => finish(code));
  });
}

/** Without process isolation: what we were doing until now. */
export class LocalExecutor implements Executor {
  readonly isolation = "local" as const;
  readonly describe = "en tu máquina, con tu entorno";

  constructor(private readonly cwd: string) {}

  run(request: ExecRequest): Promise<Step> {
    return spawnStep(request, this.cwd, { ...process.env, ...request.env });
  }

  async dispose(): Promise<void> {}
}

/**
 * Variables that should never reach third-party code.
 *
 * A `postinstall` that runs during the installation has access to the process environment. If your
 * npm or GitHub token travels there, it already has it. This does not prevent the script from
 * running — it prevents it from taking something.
 */
const SECRET_PATTERN = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION|COOKIE/i;

/** The minimum for an installation to work. Everything else is discarded. */
const KEEP = new Set([
  "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "SHELL", "USER",
  "NODE_OPTIONS", "CI", "npm_config_registry",
]);

export function scrubEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!KEEP.has(key)) continue;
    if (SECRET_PATTERN.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Clean environment and disposable HOME, without external dependencies.
 *
 * **What it does:** it removes from the environment everything that is not needed for
 * installation, so a token that lived in a variable —`NPM_TOKEN`, `GITHUB_TOKEN` — does not reach
 * the child process. And it puts `HOME` in an empty temporary directory, so the tools that write
 * to `~` do not mess with yours and those that read `~/.npmrc` do not find yours.
 *
 * **And on macOS, moreover, close your personal folder** with `sandbox-exec`. That is new, and
 * comes from checking that the previous measures were far from sufficient: changing `HOME` only
 * changes where the tilde points, not who you are, so `/Users/tu/.ssh/id_rsa` was still there by
 * absolute path. Measured with a repository whose `scripts.test` tried it: it read a canary from
 * the real home, read `~/.panoma/ai.json`, listed `~/.ssh`, **wrote** inside `~/.panoma` and went
 * out to the internet — and the execution was recorded as “verified: true.” With the sandbox,
 * those four attempts return EPERM.
 *
 * The phrase that was here ("without access to your credentials") appeared in the interface
 * without being true. It's the same error as `--read-only` that wasn't there: a promise that the
 * code doesn't deliver turns a review into a confirmation, and this one was signed by Panoma in
 * front of the user. Now the promise exists where there is a sandbox, and where there isn't,
 * `unmetPromise()` states it in the execution record instead of keeping it silent.
 *
 * What remains uncovered in any case: the network and the rest of the disk outside of your folder.
 * That's what the container is for.
 */
export class HardenedExecutor implements Executor {
  readonly isolation = "hardened" as const;
  readonly describe: string;

  private home: string | undefined;
  private profile: string | undefined;

  constructor(private readonly cwd: string) {
    this.describe = seatbeltAvailable()
      ? "entorno sin tus variables, HOME desechable y tu carpeta personal cerrada por el " +
        "sandbox de macOS; el proceso sigue con tu usuario y con red"
      : "entorno sin tus variables y HOME desechable; el proceso sigue siendo tuyo y ve tu disco";
  }

  unmetPromise(): string | undefined {
    return seatbeltAvailable()
      ? undefined
      : "no hay sandbox del sistema en esta plataforma, así que el código ejecutado podía " +
        "leer tu carpeta personal";
  }

  private async ensureHome(): Promise<string> {
    this.home ??= await mkdtemp(join(tmpdir(), "panoma-home-"));
    return this.home;
  }

  /** Write the sandbox profile once per execution. Lives outside the denied home. */
  private async ensureProfile(): Promise<string | undefined> {
    if (!seatbeltAvailable()) return undefined;
    if (this.profile) return this.profile;

    const path = join(await this.ensureHome(), "perfil.sb");
    await writeFile(path, seatbeltProfile(homedir()), "utf8");
    this.profile = path;
    return path;
  }

  async run(request: ExecRequest): Promise<Step> {
    const home = await this.ensureHome();
    const env = { ...scrubEnvironment(process.env), HOME: home, ...request.env };
    const profile = await this.ensureProfile();

    if (!profile) return spawnStep(request, this.cwd, env);

    /*
      The real command becomes an argument of `sandbox-exec`, but `Step` still records the real
      command: the execution record has to say what was executed, not what it was wrapped with.
     */
    return spawnStep(request, this.cwd, env, SEATBELT, [
      "-f",
      profile,
      request.command,
      ...request.args,
    ]);
  }

  async dispose(): Promise<void> {
    if (this.home) await rm(this.home, { recursive: true, force: true }).catch(() => {});
  }
}

const SEATBELT = "/usr/bin/sandbox-exec";

/** Is there a system sandbox? Only macOS, and only if the binary is where it should be. */
function seatbeltAvailable(): boolean {
  return process.platform === "darwin" && existsSync(SEATBELT);
}

/**
 * The profile: everything allowed except your personal folder.
 *
 * It is a single rule, and that brevity is the result of having moved the worktree out of the home
 * (see `worktreeRoot` ). The opposite—denying everything and allowing only what is necessary—is
 * correct in theory and does not work in practice: it was tested, and node does not even start
 * without a long list of dyld paths, `mach-lookup`, and so on, which also changes with each macOS
 * version and with each package manager. A profile that needs to be chased is a profile that one
 * day is 'temporarily' deactivated.
 *
 * What this **gives**: the repository code cannot read `~/.ssh`, `~/.aws`, `~/.panoma/ai.json` nor
 * your documents, nor write anything in your folder. Tested with a hostile repository: all four
 * attempts return EPERM.
 *
 * What **does not** work: it still has network, it still runs with your user, and it still sees
 * the rest of the disk outside the home — `/etc/hosts` can be read without problem —. That's what
 * the container is for. `sandbox-exec` has also been marked as obsolete by Apple for years,
 * although it is still what Chrome and company use; if one day it disappears, `seatbeltAvailable`
 * detects it and the execution reports it instead of pretending.
 */
function seatbeltProfile(home: string): string {
  // Quotation marks within a path would break the profile, and a broken profile causes
  // `sandbox-exec` to not boot anything instead of booting without protection — which is the
  // correct failure of the two, but it is advisable not to provoke it.
  const escapedText = home.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return ["(version 1)", "(allow default)", `(deny file-read* file-write* (subpath "${escapedText}"))`, ""].join("\n");
}

export interface ContainerOptions {
  runtime: string;
  image: string;
}

/**
 * Each command inside an ephemeral container.
 *
 * The container is created once per run and not per step: the installation leaves `node_modules`
 * that the tests need, and with a container per step that state would be lost. Only the worktree
 * is mounted, so the rest of the disk does not exist for the process.
 *
 * The test step runs with `--network none`. The installation cannot: it requires registration.
 * That asymmetry is honest — a malicious `postinstall` runs with the network, and what the
 * container gains over `hardened` is that it doesn't see your disk or your processes, not that it
 * can't access the internet while installing.
 */
export class ContainerExecutor implements Executor {
  readonly isolation = "container" as const;
  readonly describe: string;

  private containerId: string | undefined;
  /** The network is already down: there is no need to try again at every step. */
  private networkCut = false;
  /** It was asked to cut the network and it could not be done. It is told, it is not silenced. */
  private networkFailure: string | undefined;

  unmetPromise(): string | undefined {
    return this.networkFailure;
  }

  constructor(
    private readonly cwd: string,
    private readonly options: ContainerOptions,
  ) {
    this.describe = `contenedor efímero (${options.image}); sin acceso a tu disco`;
  }

  /** Is there a usable runtime? Return its name or undefined. */
  static async findRuntime(): Promise<string | undefined> {
    for (const runtime of ["docker", "podman", "nerdctl", "finch"]) {
      const probe = await spawnStep(
        { name: "probe", command: runtime, args: ["info"], timeoutMs: 15_000 },
        process.cwd(),
        process.env,
      );
      if (probe.exitCode === 0) return runtime;
    }
    return undefined;
  }

  private async ensureContainer(): Promise<string> {
    if (this.containerId) return this.containerId;

    const created = await spawnStep(
      {
        name: "crear contenedor",
        command: this.options.runtime,
        args: [
          "run", "--detach", "--rm",
          "--workdir", "/work",
          "--volume", `${this.cwd}:/work`,
          "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges",
          /*
            The image's file system, in read-only.
            This comment was already written —"read-only except for /work and /tmp: the container
            cannot modify itself"— and the arguments did not provide it. Anyone who read the code
            would have been reassured. A comment that promises a guarantee that the code does not
            give is worse than having no comment: it turns a review into a confirmation.
            `/work` is still writable because it is the worktree volume, which is exactly what the
            execution needs to modify.
           */
          "--read-only",
          "--tmpfs", "/tmp:rw,noexec,nosuid,size=1g",
          // Many managers write their cache in the home; without this, `npm install` fails against
          // the read-only file system for a reason that is not understood.
          "--tmpfs", "/root:rw,size=2g",
          "--env", "HOME=/root",
          /*
            `--init` inserts a real PID 1 that collects orphans. Without it, PID 1 is the
            `sleep 3600` below, which adopts no one: the processes that a test suite leaves
            hanging accumulate as zombies until `--pids-limit` is exhausted, and the failure shows
            up as an incomprehensible test error instead of what it really is.
           */
          "--init",
          "--memory", "4g",
          "--pids-limit", "512",
          this.options.image,
          "sleep", "3600",
        ],
        timeoutMs: 300_000,
      },
      this.cwd,
      process.env,
    );

    if (created.exitCode !== 0) {
      throw new Error(`No se pudo crear el contenedor: ${created.output.trim().slice(0, 400)}`);
    }
    this.containerId = created.output.trim().split("\n").pop()!;
    return this.containerId;
  }

  async run(request: ExecRequest): Promise<Step> {
    const id = await this.ensureContainer();
    const envArgs = Object.entries(request.env ?? {}).flatMap(([k, v]) => ["--env", `${k}=${v}`]);

    /*
      `--network none` in exec does not exist; the network is decided when created. For the step
      without a network, we disconnect the container before executing it.
      **And it is verified that the disconnection worked.** The network is called `bridge` in
      Docker and may have a different name in podman or nerdctl, or the container may be on a
      custom network. Without looking at the exit code, the failure was silent: the tests ran with
      internet and the execution was recorded saying they didn't. Of the four ways failures have
      been found in this project, this was the worst: it didn't give an error, it gave a false and
      signed statement.
     */
    if (request.needsNetwork === false && !this.networkCut) {
      const cut = await spawnStep(
        {
          name: "aislar red",
          command: this.options.runtime,
          args: ["network", "disconnect", "bridge", id],
          timeoutMs: 30_000,
        },
        this.cwd,
        process.env,
      );
      if (cut.exitCode === 0) {
        this.networkCut = true;
      } else {
        this.networkFailure =
          `no se pudo desconectar la red del contenedor (${this.options.runtime} network ` +
          `disconnect salió con ${cut.exitCode}), así que los pasos que pedían correr sin ` +
          "red han corrido con ella";
      }
    }

    const step = await spawnStep(
      request,
      this.cwd,
      process.env,
      this.options.runtime,
      ["exec", ...envArgs, id, request.command, ...request.args],
    );
    return step;
  }

  async dispose(): Promise<void> {
    if (!this.containerId) return;
    await spawnStep(
      { name: "borrar contenedor", command: this.options.runtime, args: ["rm", "-f", this.containerId], timeoutMs: 60_000 },
      this.cwd,
      process.env,
    ).catch(() => {});
  }
}

export interface ResolveOptions {
  requested?: Isolation;
  cwd: string;
  image: string;
}

export interface ResolvedExecutor {
  executor: Executor;
  /** If a level was requested and could not be given, here is the reason. */
  downgradedFrom?: Isolation;
  reason?: string;
}

/**
 * Choose the executor, degrading with explanation instead of failing.
 *
 * **By default, the strongest available on this machine is taken**, not a fixed intermediate
 * level. Previously, the default was `hardened`, and the container only appeared if someone
 * requested it by name, which means that the vast majority of runs were executed with less
 * isolation than available without anyone making that decision. Looking for the runtime takes 0.1
 * s when none is installed — measured — so convenience was not the reason; it was just that no one
 * had changed it.
 *
 * Requesting a level by its name still sends: `--isolation hardened` gives `hardened` even if
 * there is Docker, because the person writing it knows what they want.
 *
 * If a container is requested and there is no runtime, it goes down to `hardened` and the reason
 * is stated. Bringing it down silently would be the worst of all: the execution would be marked
 * with an isolation that it did not have.
 */
export interface IsolationChoice {
  kind: Isolation;
  /** The runtime found, when `kind` is `container`. */
  runtime?: string;
  downgradedFrom?: Isolation;
  reason?: string;
}

/**
 * Decide the level **before** the worktree exists, because the worktree depends on it.
 *
 * It seems like a hassle and it isn't: the container needs the worktree under home (Colima does
 * not mount `/var/folders` ) and the sandbox needs it outside (if it is inside, the tools that
 * look for `package.json` going up collide with the denied home and crash). These are opposite
 * requirements, so you need to know which one applies before creating anything. See
 * `worktreeRoot`.
 */
export async function chooseIsolation(requested?: Isolation): Promise<IsolationChoice> {
  if (requested === "local") return { kind: "local" };
  if (requested === "hardened") return { kind: "hardened" };

  // No level requested, or request `container`: the container is attempted.
  const runtime = await ContainerExecutor.findRuntime();
  if (runtime) return { kind: "container", runtime };

  return {
    kind: "hardened",
    downgradedFrom: "container",
    reason:
      "No hay ningún runtime de contenedores (docker, podman, nerdctl o finch), así que no " +
      "se pudo aislar la red ni el resto del disco",
  };
}

export function createExecutor(choice: IsolationChoice, options: ResolveOptions): Executor {
  if (choice.kind === "local") return new LocalExecutor(options.cwd);
  if (choice.kind === "container") {
    return new ContainerExecutor(options.cwd, { runtime: choice.runtime!, image: options.image });
  }
  return new HardenedExecutor(options.cwd);
}

/** Both things together, for anyone who does not need to decide before having the `cwd`. */
export async function resolveExecutor(options: ResolveOptions): Promise<ResolvedExecutor> {
  const choice = await chooseIsolation(options.requested);
  return {
    executor: createExecutor(choice, options),
    downgradedFrom: choice.downgradedFrom,
    reason: choice.reason,
  };
}
