import { execFile } from "node:child_process";
import { chmod } from "node:fs/promises";
import { promisify } from "node:util";
import { resolveExecutable } from "./exec";

const run = promisify(execFile);

/**
 * Leave a file readable only by its owner, no matter what the system says.
 *
 * In macOS and Linux this is `chmod 0600` and that's it. In Windows POSIX permissions do not
 * exist: `chmod` there it only moves the read-only bit, so a file created with `mode: 0o600`
 * inherits the permissions of its folder and `stat().mode` happily returns 0666. The two things
 * that Panoma stores like this —the access key to the catalog and the keys of the AI providers—
 * are exactly the ones that can inherit nothing.
 *
 * `icacls` with `/inheritance:r` cuts the inheritance and `/grant:r` leaves a single entry: the
 * owner's, with total control. There is neither `Usuarios` nor `Todos` left, which is what 0600
 * means on the other side.
 *
 * Return whether it succeeded instead of swallowing it. Whoever holds a credential has the right
 * to know that it could not be protected; deciding what to do with that news is up to the caller,
 * not here.
 */
export async function restrictToOwner(path: string): Promise<boolean> {
  if (process.platform !== "win32") {
    try {
      await chmod(path, 0o600);
      return true;
    } catch {
      return false;
    }
  }

  // Without a username there is no one to grant: better not to touch the permissions than to leave
  // them worse than they were.
  const owner = process.env["USERNAME"];
  if (!owner) return false;

  const domain = process.env["USERDOMAIN"];
  const account = domain ? `${domain}\\${owner}` : owner;

  try {
    const launch = resolveExecutable("icacls", [path, "/inheritance:r", "/grant:r", `${account}:F`]);
    await run(launch.file, launch.args, { timeout: 15_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
