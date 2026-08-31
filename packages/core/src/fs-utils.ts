import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "smol-toml";

/**
 * No legitimate manifest weighs more than this; the stopper prevents a blob from being read by
 * mistake.
 */
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

export async function readTextAt(root: string, relativePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(join(root, relativePath), "utf8");
    if (content.length > MAX_MANIFEST_BYTES) return undefined;
    /*
      The byte order mark goes here, once, and not in every parser.
      A `\uFEFF` in front is invisible and knocks down all three: `smol-toml` throws "Invalid TOML
      document", `JSON.parse` complains about an unexpected character at position 0, and the
      result in both cases is a perfectly readable file that is considered unreadable. Windows and
      some editors write it without warning.
     */
    return content.replace(/^\uFEFF/, "");
  } catch {
    return undefined;
  }
}

export async function readJsonAt<T = unknown>(
  root: string,
  relativePath: string,
): Promise<T | undefined> {
  const text = await readTextAt(root, relativePath);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function readYamlAt<T = unknown>(
  root: string,
  relativePath: string,
): Promise<T | undefined> {
  const text = await readTextAt(root, relativePath);
  if (text === undefined) return undefined;
  try {
    return parseYaml(text) as T;
  } catch {
    return undefined;
  }
}

export async function readTomlAt<T = unknown>(
  root: string,
  relativePath: string,
): Promise<T | undefined> {
  const text = await readTextAt(root, relativePath);
  if (text === undefined) return undefined;
  try {
    return parseToml(text) as T;
  } catch {
    return undefined;
  }
}

/** Read a nested route like `dependencies.next` from an already parsed object. */
export function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
