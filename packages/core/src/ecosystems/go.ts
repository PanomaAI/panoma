import type { Dependency, EcosystemReport, FileIndex } from "../types";
import { readTextAt } from "../fs-utils";

/**
 * go.mod is a format of its own lines, not TOML or YAML. Its two forms:
 *
 * require github.com/x/y v1.0.0 require ( github.com/a/b v1.2.3 github.com/c/d v0.4.0 // indirect
 * )
 *
 * Advantage over other ecosystems: the go.mod versions are already exact, so a lockfile is not
 * needed to resolve them.
 */
export async function analyzeGo(index: FileIndex): Promise<EcosystemReport | undefined> {
  if (!index.fileSet.has("go.mod")) return undefined;

  const text = await readTextAt(index.root, "go.mod");
  if (!text) return undefined;

  const dependencies: Dependency[] = [];
  let inRequireBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    if (inRequireBlock) {
      if (line === ")") {
        inRequireBlock = false;
        continue;
      }
      const parsed = parseRequire(line);
      if (parsed) dependencies.push(parsed);
      continue;
    }

    if (line === "require (") {
      inRequireBlock = true;
      continue;
    }

    if (line.startsWith("require ")) {
      const parsed = parseRequire(line.slice("require ".length));
      if (parsed) dependencies.push(parsed);
    }
  }

  return {
    ecosystem: "go",
    manifestPath: "go.mod",
    lockfilePath: index.fileSet.has("go.sum") ? "go.sum" : undefined,
    packageManager: "go",
    dependencies,
  };
}

function parseRequire(line: string): Dependency | undefined {
  const withoutComment = line.split("//")[0]?.trim();
  if (!withoutComment) return undefined;

  const [name, version] = withoutComment.split(/\s+/);
  if (!name || !version) return undefined;

  return {
    ecosystem: "go",
    name,
    constraint: version,
    // In go.mod the declared version is already the exact one that is compiled.
    resolvedVersion: version.replace(/^v/, ""),
    isDev: false,
    // `// indirect` marks transitive dependencies that Go notes in manifest.
    isDirect: !line.includes("// indirect"),
  };
}

/** Module name, useful as the project name when there is no other manifest. */
export async function readGoModule(root: string): Promise<string | undefined> {
  const text = await readTextAt(root, "go.mod");
  const match = text ? /^module\s+(\S+)/m.exec(text) : undefined;
  const path = match?.[1];
  return path ? path.split("/").pop() : undefined;
}
