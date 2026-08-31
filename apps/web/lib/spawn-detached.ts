import { spawn } from "node:child_process";
import { resolveExecutable } from "@panoma/core";

/**
 * Starts something and lets it go, checking only whether it fails immediately.
 *
 * They share opening a terminal and opening an agent because both open a window that can still be
 * alive tomorrow: waiting for it would tie the server to it. The 400 ms is the time it takes for
 * an ENOENT to arrive, and the exit code counts the same — `open -a Terminal` starts without
 * problems and returns 1 when the application is no longer there.
 */
export async function spawnDetached(
  command: string,
  args: string[],
  cwd?: string,
): Promise<Error | undefined> {
  const launch = resolveExecutable(command, args);

  return new Promise<Error | undefined>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(launch.file, launch.args, {
        ...(cwd ? { cwd } : {}),
        detached: true,
        stdio: "ignore",
      });
    } catch (error) {
      resolve(error as Error);
      return;
    }
    child.on("error", (error) => resolve(error));
    /*
      Exiting with a code is not the same as failing to start, and it also counts.
      `open -a Terminal` starts without any problem and returns 1 when the application is no
      longer present: without looking at the code, that would be answered as "open" and nothing
      would have been opened. The terminals that remain alive do not appear within this window, so
      here a non-zero code can only be an immediate failure.
     */
    child.on("exit", (code) => {
      if (code !== null && code !== 0) resolve(new Error(`salió con ${code}`));
    });
    child.unref();
    setTimeout(() => resolve(undefined), 400);
  });
}
