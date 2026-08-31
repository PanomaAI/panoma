import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Upgrade a dependency to a specific version by editing the manifest.
 *
 * Editing is a targeted replacement on the text, not a `JSON.parse` + `stringify`. Rewriting the
 * entire file would change quotes, indents, and key order, and the diff —which is the product that
 * the human reviews— would be full of noise in which to hide a real change. A one-line patch is
 * reviewed in ten seconds; a two-hundred-line one is not reviewed.
 */

export interface BumpRequest {
  ecosystem: "npm" | "pub";
  packageName: string;
  targetVersion: string;
}

export interface BumpEdit {
  file: string;
  before: string;
  after: string;
}

/** Why couldn't it be edited. Distinguishing it matters: they are different problems. */
export type BumpFailure = "ya-en-destino" | "no-declarado";

/** How far to search manifests for members of a workspace. */
const MAX_DEPTH = 3;
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".dart_tool", "Pods"]);

export async function applyBump(
  root: string,
  manifest: string,
  request: BumpRequest,
): Promise<BumpEdit | BumpFailure> {
  // In a monorepo, the dependency is almost never in the root manifest: it lives in the package
  // that uses it. The catalog already does a roll-up of the members, so if here we only looked at
  // the root, Panoma would say 'you depend on this' and immediately after 'I don't know where it
  // is' — a contradiction that is costly to debug.
  const candidates = [manifest, ...(await findMemberManifests(root, manifest))];
  let sawDeclaration = false;

  for (const relative of candidates) {
    const path = join(root, relative);
    let original: string;
    try {
      original = await readFile(path, "utf8");
    } catch {
      continue;
    }

    const edit =
      request.ecosystem === "npm"
        ? editPackageJson(original, request)
        : editPubspec(original, request);

    if (edit === "no-declarado") continue;
    sawDeclaration = true;
    if (edit === "ya-en-destino") continue;

    await writeFile(path, edit.content, "utf8");
    return { file: relative, before: edit.before, after: edit.after };
  }

  return sawDeclaration ? "ya-en-destino" : "no-declarado";
}

/** manifests of the same type in subdirectories: the members of the workspace. */
async function findMemberManifests(root: string, manifest: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      if (entry.isFile() && entry.name === manifest && prefix) {
        found.push(`${prefix}${manifest}`);
      } else if (entry.isDirectory()) {
        await walk(join(dir, entry.name), `${prefix}${entry.name}/`, depth + 1);
      }
    }
  }

  await walk(root, "", 0);
  return found;
}

interface EditResult {
  content: string;
  before: string;
  after: string;
}

type Edit = EditResult | BumpFailure;

/** `"react": "^18.2.0"` → `"react": "^19.0.0"`, keeping the prefix of the range. */
function editPackageJson(content: string, request: BumpRequest): Edit {
  const escaped = escapeRegex(request.packageName);
  const pattern = new RegExp(`("${escaped}"\\s*:\\s*")([^"]+)(")`);
  const match = pattern.exec(content);
  if (!match) return "no-declarado";

  const current = match[2]!;
  // We respect how the project declares its ranges: if it used `^`, it continues to use `^`.
  // Changing it to an exact version would be a policy decision that is not up to us.
  const prefix = /^[\^~>=<]*/.exec(current)?.[0] ?? "";
  const next = `${prefix}${request.targetVersion}`;
  if (current === next) return "ya-en-destino";

  return {
    content: content.replace(pattern, `$1${next}$3`),
    before: current,
    after: next,
  };
}

/** `  dio: ^5.3.2` → `  dio: ^5.4.0`, respecting the YAML indentation. */
function editPubspec(content: string, request: BumpRequest): Edit {
  const escaped = escapeRegex(request.packageName);
  // Only dependencies with text restriction: the map ones (`sdk:`, `git:`, `path:` ) are not
  // touched, because they do not come from the register and uploading them means nothing.
  const pattern = new RegExp(`^(\\s+${escaped}:\\s*)(["']?)([\\^~>=<\\d][^\\n"']*)(["']?)\\s*$`, "m");
  const match = pattern.exec(content);
  if (!match) return "no-declarado";

  const current = match[3]!.trim();
  const prefix = /^[\^~>=<\s]*/.exec(current)?.[0] ?? "";
  const next = `${prefix}${request.targetVersion}`;
  if (current === next) return "ya-en-destino";

  return {
    content: content.replace(pattern, `$1$2${next}$4`),
    before: current,
    after: next,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
