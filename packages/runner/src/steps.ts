import { spawn } from "node:child_process";
import { resolveExecutable } from "@panoma/core";

/**
 * A step performed, with its result.
 *
 * Everything a run does stays here: the exact command, the exit code, the output, and how long it
 * took. It's what turns "the agent fixed it" into something that can be checked instead of just
 * believed.
 */
export interface Step {
  name: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  output: string;
  /** true if the failure was expected and does not invalidate the execution. */
  tolerated?: boolean;
}

/** How much output we store per step. A `pnpm install` can write megas. */
const MAX_OUTPUT = 16_000;

export interface RunCommandOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/**
 * Execute a command and capture everything.
 *
 * We intentionally use `spawn` without a shell: the arguments go as an array, so a package name or
 * a version cannot be turned into another command. This function receives data that ultimately
 * comes from a public registry.
 */
export function runCommand(
  name: string,
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<Step> {
  const started = Date.now();

  return new Promise((resolve) => {
    // In Windows, the package manager is a `.cmd`, and `spawn` does not know how to run scripts.
    const launch = resolveExecutable(command, args);
    const child = spawn(launch.file, launch.args, {
      cwd: options.cwd,
      // CI is not forced here: in `pnpm install` it activates --frozen-lockfile, which is exactly
      // the opposite of what an update needs. Each step decides if it wants it: the tests do
      // (avoids interactive mode), the installation does not.
      env: { ...process.env, ...options.env },
      shell: false,
    });

    let output = "";
    const append = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString();
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 300_000);

    const finish = (exitCode: number | null, extra = "") => {
      clearTimeout(timeout);
      resolve({
        name,
        command: `${command} ${args.join(" ")}`.trim(),
        exitCode,
        durationMs: Date.now() - started,
        output: (output + extra).slice(0, MAX_OUTPUT),
      });
    };

    child.on("error", (error) => finish(null, `\n${error.message}`));
    child.on("close", (code) => finish(code));
  });
}

export function stepFailed(step: Step): boolean {
  return !step.tolerated && step.exitCode !== 0;
}
