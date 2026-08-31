import { relative } from "node:path";
import type { ProjectAnalysis } from "./types";

/**
 * An identity that survives moving the folder.
 *
 * The identifier of a project today is the sha1 of its absolute path, and that is correct for
 * everything that Panoma **deduces** from the disk: if you move the folder, the old analysis no
 * longer describes anything and is rebuilt by scanning. The problem is what Panoma **does not**
 * deduce: that you hid a project, or the description you asked a model for. You wrote that, it
 * costs money or requires a decision, and it disappeared in cascade when renaming a folder.
 *
 * Hence the separation: `projects` is derived from the disk and is disposable; the user's
 * decisions hang on this identity and survive.
 *
 * The candidate comes from the first stable data available:
 *
 * 1. **The root commit of the repository**, plus the relative path within it. It is the
 * fingerprint that `duplicates.ts` already uses to recognize copies: it survives renaming, moving
 * the folder, and changing the remote. The relative path distinguishes subprojects of a monorepo
 * from each other without depending on where the monorepo is.
 * 2. **Nothing**, if there is no repository. Then it falls back to the route, which is what there
 * was, and it is clearly stated that there is nothing to preserve there.
 *
 * What this module **cannot** solve on its own: two copies of the same repository in different
 * folders share a root commit, so they would share identity. Solving it requires seeing the entire
 * catalog, and that is why the final distribution lives in the ingestion.
 */

export interface IdentityCandidate {
  /** The candidate, or `undefined` if there is no stable signal. */
  value?: string;
  /** Why. It is saved in order to be able to explain it on the card. */
  reason: string;
}

export function identityCandidate(analysis: ProjectAnalysis): IdentityCandidate {
  const git = analysis.git;

  if (git?.rootCommitSha) {
    const repoRoot = git.repoRoot ?? analysis.root;
    const inner = relative(repoRoot, analysis.root);
    // `relative` gives "" when the project **is** the root of the repository.
    const suffix = inner && !inner.startsWith("..") ? `:${inner}` : "";
    return {
      value: `git:${git.rootCommitSha}${suffix}`,
      reason: suffix
        ? `commit raíz del repositorio que lo contiene, más su ruta dentro (${inner})`
        : "commit raíz de su repositorio",
    };
  }

  return { reason: "sin repositorio: no hay ninguna señal que sobreviva a mover la carpeta" };
}
