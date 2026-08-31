import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileIndex } from "./types";
import { extensionOf } from "./discover";

/**
 * Look for images and other resources that no one references.
 *
 * The risk here is not finding nothing: it's **over-asserting**. If this says a file is not used
 * and it turns out it is, the user deletes it and breaks their app — and finds out in production.
 * An asset detector that makes a mistake once every twenty times is worse than not having a
 * detector, because after that scare no one trusts it again.
 *
 * Hence the three decisions that govern everything:
 *
 * 1. **Search is by file name, not by path.** `'assets/images/logo.png'`, `url(../img/logo.png)`,
 * and `import logo from "./logo.png"` are the same reference written in three ways; the name is
 * the only thing they share.
 * 2. **Routes built in pieces disable the entire folder.** As soon as a `'assets/icons/$name.png'`
 * appears, any file of `assets/icons/` can be referenced without its name appearing written
 * anywhere. That folder can no longer be analyzed, it is said.
 * 3. **What the platform manages is not touched.** The icons of `android/app/src/main/res` or of a
 * `Assets.xcassets` are referenced by convention (`@mipmap/ic_launcher`), not by file name.
 * Looking at them would give a beautiful list of false positives.
 */

const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".svg",
  ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".mov",
  ".ttf", ".otf", ".woff", ".woff2",
  ".riv", ".lottie", ".json5", ".glb", ".gltf",
]);

/** Extensions where a reference can be written. */
const SOURCE_EXTENSIONS = new Set([
  ".dart", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro",
  ".py", ".rb", ".go", ".rs", ".php", ".java", ".kt", ".kts", ".swift", ".m", ".mm",
  ".html", ".htm", ".css", ".scss", ".sass", ".less", ".styl",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".plist", ".md", ".mdx", ".txt", ".env",
  ".gradle", ".pro", ".cfg", ".ini", ".sh",
]);

/**
 * Folders whose resources are referenced by the platform by convention and not by name. They are
 * compared as path segments, so they are valid both at the root and nested.
 */
const PLATFORM_OWNED = [
  "android/app/src/main/res",
  "ios/runner/assets.xcassets",
  "macos/runner/assets.xcassets",
  "assets.xcassets",
  "web/icons",
  "windows/runner/resources",
  "linux/flutter",
  ".github",
];

/** Reading limit per file and in total, so that this doesn't turn into an endless scan. */
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

export interface UnusedAsset {
  path: string;
  bytes: number;
  /** Why we believe it is not used, in the user's language. */
  reason: string;
}

export interface AssetReport {
  /** Analyzable resources: total found minus those managed by the platform. */
  analyzed: number;
  /** Resources that the platform references by convention; they are not analyzed. */
  skippedPlatform: number;
  unused: UnusedAsset[];
  unusedBytes: number;
  /**
   * Folders where the code builds paths from chunks. Their files are not analyzed because nothing
   * can be said about them.
   */
  dynamicDirs: string[];
  /** Code files read to search for references. */
  sourcesRead: number;
  truncated: boolean;
}

export async function findUnusedAssets(index: FileIndex): Promise<AssetReport> {
  const candidates: string[] = [];
  let skippedPlatform = 0;

  for (const path of index.files) {
    const ext = extensionOf(path);
    if (!ext || !ASSET_EXTENSIONS.has(ext)) continue;
    if (isPlatformOwned(path)) {
      skippedPlatform++;
      continue;
    }
    candidates.push(path);
  }

  // `index.sizes` only brings the files that count for language statistics, so the weights of the
  // resources must be requested here. Without this, the list comes out entirely at zero bytes and
  // loses exactly what makes it actionable: how much the remaining takes up.
  const assets = await Promise.all(
    candidates.map(async (path) => ({
      path,
      bytes: await stat(join(index.root, path))
        .then((info) => info.size)
        .catch(() => 0),
    })),
  );

  if (assets.length === 0) {
    return {
      analyzed: 0,
      skippedPlatform,
      unused: [],
      unusedBytes: 0,
      dynamicDirs: [],
      sourcesRead: 0,
      truncated: false,
    };
  }

  const { names, words, dynamicDirs, sourcesRead, truncated } = await scanSources(index);

  const unused: UnusedAsset[] = [];
  for (const asset of assets) {
    const base = basenameOf(asset.path).toLowerCase();
    const stem = base.slice(0, base.lastIndexOf("."));

    if (names.has(base)) continue;
    // The name without extension captures the cases where it is referenced without it: iOS
    // catalogs, `Image.asset` with the extension separately, or a constant named like the file. It
    // prefers not to report rather than report too much.
    if (stem.length >= 3 && words.has(stem)) continue;
    // And without the density suffix: the alternative iOS icons are called
    // `AppIcon-american@3x.png` on disk and `AppIcon-american` in the Info.plist. Without removing
    // the `@3x`, it was reported that six icons that the app does use were extra — exactly the
    // error that makes a tool like this stop being trustworthy.
    const density = stripDensity(stem);
    if (density !== stem && density.length >= 3 && words.has(density)) continue;
    if (inDynamicDir(asset.path, dynamicDirs)) continue;

    unused.push({
      path: asset.path,
      bytes: asset.bytes,
      reason: "su nombre no aparece en ningún fichero de código del proyecto",
    });
  }

  unused.sort((a, b) => b.bytes - a.bytes);

  return {
    analyzed: assets.length,
    skippedPlatform,
    unused,
    unusedBytes: unused.reduce((sum, item) => sum + item.bytes, 0),
    dynamicDirs,
    sourcesRead,
    truncated,
  };
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `appicon-american@3x` → `appicon-american`. Apple convention for densities. */
function stripDensity(stem: string): string {
  return stem.replace(/@[\d.]+x$/, "");
}

function isPlatformOwned(path: string): boolean {
  const lower = path.toLowerCase();
  return PLATFORM_OWNED.some((dir) => lower.includes(dir));
}

function inDynamicDir(path: string, dynamicDirs: string[]): boolean {
  return dynamicDirs.some((dir) => path.toLowerCase().startsWith(dir));
}

/** Anything that looks like a resource file name. */
const FILENAME_PATTERN =
  /[\w@$%{}.\-/]*\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg|mp3|wav|ogg|m4a|mp4|webm|mov|ttf|otf|woff2?|riv|lottie|glb|gltf)\b/gi;

/** Loose words, to rescue references without extension. */
const WORD_PATTERN = /[a-z0-9_-]{3,}/gi;

/** Marks that the route is composed at runtime. */
const INTERPOLATION = /[$%{]|\+\s*$|\$\{/;

async function scanSources(index: FileIndex): Promise<{
  names: Set<string>;
  words: Set<string>;
  dynamicDirs: string[];
  sourcesRead: number;
  truncated: boolean;
}> {
  const names = new Set<string>();
  const words = new Set<string>();
  const dynamic = new Set<string>();
  let sourcesRead = 0;
  let total = 0;
  let truncated = false;

  for (const path of index.files) {
    const ext = extensionOf(path);
    if (!ext || !SOURCE_EXTENSIONS.has(ext)) continue;
    if (total >= MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }

    let text: string;
    try {
      text = await readFile(join(index.root, path), "utf8");
    } catch {
      continue;
    }
    if (text.length > MAX_FILE_BYTES) {
      text = text.slice(0, MAX_FILE_BYTES);
      truncated = true;
    }
    total += text.length;
    sourcesRead++;

    for (const match of text.matchAll(FILENAME_PATTERN)) {
      const token = match[0]!.toLowerCase();
      const base = basenameOf(token);

      // `'assets/icons/$name.png'` does not name a file: it names an entire folder.
      if (INTERPOLATION.test(base)) {
        const dir = token.slice(0, token.lastIndexOf("/") + 1);
        if (dir.length > 1) dynamic.add(dir.replace(/^[./]+/, ""));
        continue;
      }
      names.add(base);
    }

    for (const match of text.matchAll(WORD_PATTERN)) words.add(match[0]!.toLowerCase());
  }

  return { names, words, dynamicDirs: [...dynamic].sort(), sourcesRead, truncated };
}
