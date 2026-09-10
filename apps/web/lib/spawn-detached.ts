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
  /**
   * Exit codes that mean "it worked", when zero is not the only one.
   *
   * `explorer.exe` hands the request to the running shell and exits **1** with the window already
   * open, so judging it by its code reported every folder on Windows as a failure that had in fact
   * opened. It is a list and not a boolean because it is a property of the program being launched,
   * and only the caller knows which one it is launching.
   */
  okCodes: number[] = [0],
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
      if (code === null) return;
      /*
        A clean exit resolves too, and that is not only tidiness: `open` on macOS and `rundll32` on
        Windows finish in a few milliseconds, and waiting the whole window for them made every link
        of a plan cost 400 ms. Those that stay alive —the Linux terminals— never reach here and
        still fall through to the timer, which is what catches an ENOENT.
       */
      resolve(okCodes.includes(code) ? undefined : new Error(`exited with ${code}`));
    });
    child.unref();
    setTimeout(() => resolve(undefined), 400);
  });
}
