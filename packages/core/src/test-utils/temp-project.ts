import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A fake project in a temporary directory.
 *
 * `realpathSync` is not optional: on macOS `/var` is a symbolic link to `/private/var`, so
 * `mkdtemp` returns a path and `process.cwd()` inside it returns another. Without resolving it,
 * any comparison of paths —and Panoma compares many: `repoRoot` against the project root, the
 * scope of cleaning, the deduplication of families— fails only on this operating system, which
 * happens to be the one in which development takes place.
 */
export function createProject(
  files: Record<string, string>,
  options: { git?: boolean; commit?: string } = {},
): { root: string; cleanup: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-test-")));

  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }

  if (options.git) {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-q", "-b", "main");
    // Explicit identity: the developer's global would turn the test result into something that
    // depends on who runs it.
    git("config", "user.email", "test@panoma.ai");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    git("add", "-A");
    git("commit", "-q", "-m", options.commit ?? "primer commit");
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
