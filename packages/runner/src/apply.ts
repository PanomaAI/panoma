import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hasUncommittedChanges, isGitRepo } from "./worktree";

const run = promisify(execFile);

/**
 * Accept or reject a proposal.
 *
 * This is where the change finally enters the user's repository, so the previous checks are not
 * bureaucracy: they are what separates 'applying a proposal' from 'overwriting someone's work.' If
 * something doesn't fit, it is rejected with the exact reason instead of forcing the operation.
 *
 * There still hasn't been a push. Apply leaves a local merge commit that is undone with a
 * `git reset --hard HEAD~1`; publishing it is another decision and is up to the user.
 */

export interface ApplyResult {
  ok: boolean;
  detail: string;
  mergeSha?: string;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", root, ...args], {
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  try {
    await git(root, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function applyProposal(
  root: string,
  branch: string,
  summary: string,
): Promise<ApplyResult> {
  if (!(await isGitRepo(root))) {
    return { ok: false, detail: "El proyecto ya no es un repositorio git." };
  }

  if (!(await branchExists(root, branch))) {
    return {
      ok: false,
      detail: `La rama ${branch} ya no existe. Puede que la borraras a mano, o que se descartara antes.`,
    };
  }

  // With unconfirmed changes, a merge mixes ours with yours and leaves a state that is difficult to
  // get out of. Better to stop here.
  if (await hasUncommittedChanges(root)) {
    return {
      ok: false,
      detail: "Tienes cambios sin confirmar. Guárdalos o descártalos antes de aplicar.",
    };
  }

  const current = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "");
  if (current === branch) {
    return { ok: false, detail: `Ya estás en ${branch}: no hay nada que fusionar.` };
  }

  try {
    await git(root, [
      "merge",
      "--no-ff",
      branch,
      "-m",
      `Aplicar propuesta de Panoma: ${summary}`,
    ]);
    const mergeSha = await git(root, ["rev-parse", "HEAD"]);

    // The branch is already merged; leaving it just clutters the list.
    await git(root, ["branch", "-d", branch]).catch(() => {});

    return {
      ok: true,
      detail: `Fusionada en ${current}. Para deshacerlo: git reset --hard HEAD~1`,
      mergeSha,
    };
  } catch (error) {
    // A half-finished merge is worse than not having started: it is aborted and the repository is
    // left as it was.
    await git(root, ["merge", "--abort"]).catch(() => {});
    const message = (error as Error).message.split("\n").slice(0, 3).join(" ").trim();
    return {
      ok: false,
      detail: `El merge dio conflictos y se ha abortado; tu repositorio queda como estaba. ${message}`,
    };
  }
}

export async function discardProposal(root: string, branch: string): Promise<ApplyResult> {
  if (!(await isGitRepo(root))) {
    return { ok: false, detail: "El proyecto ya no es un repositorio git." };
  }
  if (!(await branchExists(root, branch))) {
    return { ok: true, detail: "La rama ya no existía." };
  }

  await git(root, ["branch", "-D", branch]);
  return { ok: true, detail: `Rama ${branch} eliminada.` };
}
