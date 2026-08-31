import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { panomaPath } from "@panoma/core";

const run = promisify(execFile);

/**
 * Isolation through `git worktree`.
 *
 * Rule that is not negotiable: **we never touch the user's working tree**. A worktree gives a real
 * copy of the repository in a temporary directory, sharing the git object but with its own HEAD
 * and its own index. The user can continue coding in their folder while this runs.
 *
 * In production, this is replaced by an ephemeral container or a job of CI, which also isolates
 * the network and the filesystem. The worktree is the local approach: it isolates the changes, not
 * the process. It is a real difference and it is advisable not to disguise it.
 */
export interface Worktree {
  path: string;
  branch: string;
  /**
   * Unmount the temporary worktree.
   *
   * `keepBranch` decides if the proposal survives: an execution that produced a commit leaves its
   * branch in the repository so you can do `git checkout` or `git push` whenever you want. One
   * that failed leaves nothing — it makes no sense to dirty the repo with failed attempts.
   */
  dispose: (options?: { keepBranch?: boolean }) => Promise<void>;
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      timeout: 10_000,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/** Are there unsaved changes? Working on a dirty tree gives diffs that are impossible to read. */
export async function hasUncommittedChanges(root: string): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["-C", root, "status", "--porcelain"], {
      timeout: 15_000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Where worktrees are created. Two places, and which one is used depends on how it is going to be
 * isolated.
 *
 * **Under the home** when it is going to run in a container. On macOS `os.tmpdir()` returns
 * `/var/folders/…`, which the container VMs (colima, Docker Desktop) **do not mount**: a worktree
 * there is invisible inside the container and the mount fails silently. The home does mount
 * always.
 *
 * **In the system temporary** in other cases, and this is not insignificant either. The macOS
 * sandbox denies the entire home, and Node tools search for `package.json` **going up** the tree:
 * with the worktree inside the home, the corepack shim reaches `/Users/tu/package.json`, gets
 * EPERM instead of the ENOENT it expected, and crashes. Outside of the home, no one goes up that
 * far, and the sandbox profile remains as a single rule with no exceptions. Measured: inside you
 * have to patch the profile and even so pnpm fails; outside, npm and pnpm install on the first
 * try.
 */
export function worktreeRoot(options: { underHome?: boolean } = {}): string {
  return options.underHome ? panomaPath("work") : join(tmpdir(), "panoma-work");
}

async function ensureWorktreeRoot(options: { underHome?: boolean }): Promise<string> {
  const root = worktreeRoot(options);
  await mkdir(root, { recursive: true });
  return root;
}

export async function createWorktree(
  root: string,
  branch: string,
  options: { underHome?: boolean } = {},
): Promise<Worktree> {
  const parent = await mkdtemp(join(await ensureWorktreeRoot(options), "run-"));
  const path = join(parent, "repo");

  // Proposing the same update again replaces the previous proposal instead of failing due to a
  // repeated branch name. We only delete branches from the `panoma/` space, which are ours; we
  // would never touch a user's branch.
  if (branch.startsWith("panoma/")) {
    await run("git", ["-C", root, "branch", "-D", branch], { timeout: 30_000 }).catch(() => {});
  }

  // `--detach` no: we want a branch with a name so that the diff and the future PR are readable.
  // `-b` creates it from HEAD without touching the user's current branch.
  await run("git", ["-C", root, "worktree", "add", "-b", branch, path, "HEAD"], {
    timeout: 120_000,
  });

  return {
    path,
    branch,
    dispose: async (options = {}) => {
      // Order matters: first the worktree is unregistered, then the directory is deleted. The other
      // way around, git is left with a broken reference in .git/worktrees.
      await run("git", ["-C", root, "worktree", "remove", "--force", path], {
        timeout: 60_000,
      }).catch(() => {});

      if (!options.keepBranch) {
        await run("git", ["-C", root, "branch", "-D", branch], { timeout: 30_000 }).catch(() => {});
      }

      await rm(parent, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** The complete patch of what has changed in the worktree. */
export async function diffWorktree(path: string): Promise<string> {
  const { stdout } = await run("git", ["-C", path, "diff", "HEAD"], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
}

export async function commitWorktree(path: string, message: string): Promise<string | undefined> {
  await run("git", ["-C", path, "add", "-A"], { timeout: 30_000 });
  try {
    await run("git", ["-C", path, "commit", "-m", message], { timeout: 30_000 });
    const { stdout } = await run("git", ["-C", path, "rev-parse", "HEAD"], { timeout: 10_000 });
    return stdout.trim();
  } catch {
    // No changes to confirm.
    return undefined;
  }
}
