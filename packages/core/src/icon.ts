import type { FileIndex } from "./types";
import { readTextAt } from "./fs-utils";

/**
 * Look for the project icon by order of quality.
 *
 * The App Store-type grid *is* the product, so this matters more than it seems: a real icon turns
 * a list of repos into something you’re proud to show.
 */
const CANDIDATES: { pattern: RegExp; label: string }[] = [
  // Flutter / Android — the highest density mipmap first.
  { pattern: /^android\/app\/src\/main\/res\/mipmap-xxxhdpi\/.*\.png$/, label: "Android launcher" },
  { pattern: /^android\/app\/src\/main\/res\/mipmap-xxhdpi\/.*\.png$/, label: "Android launcher" },
  // iOS — the appiconset sorted by file size at the end.
  { pattern: /^ios\/.*AppIcon\.appiconset\/.*\.png$/, label: "iOS app icon" },
  { pattern: /AppIcon\.appiconset\/.*\.png$/, label: "iOS app icon" },
  // Web
  { pattern: /^(public|static|www)\/apple-touch-icon.*\.png$/, label: "apple-touch-icon" },
  { pattern: /^(public|static|www)\/icon(-\d+)?\.(png|svg)$/, label: "web icon" },
  { pattern: /^(public|static|www)\/logo\.(png|svg)$/, label: "logo" },
  { pattern: /^(app|src\/app)\/(icon|apple-icon)\.(png|svg|ico)$/, label: "Next.js icon" },
  { pattern: /^(public|static|www)\/favicon\.(svg|png)$/, label: "favicon" },
  // Convenciones generales
  { pattern: /^assets\/(icon|logo|app_icon)[^/]*\.(png|svg)$/, label: "assets" },
  { pattern: /^(docs|\.github)\/(logo|icon|banner)[^/]*\.(png|svg)$/, label: "repo asset" },
  { pattern: /^logo\.(png|svg)$/, label: "raíz" },
  { pattern: /^(public|static|www)\/favicon\.ico$/, label: "favicon.ico" },
  /*
    The logo with the product name in front, in the usual image folder.
    The patterns above require that the file be named exactly `logo.png` and that it reside in
    `assets`, `public`, `static`, or `www`. It is a convention of scaffolded projects; whoever
    sets up their website manually keeps `frontend/img/travocato-logo.png` and ends up without an
    icon in the catalog despite having a perfectly good one on the disk.
    The last one goes on purpose: if there is a truly declared icon —Android, iOS, Next— that one
    wins, because it is the one the operating system shows. This is the network below.
   */
  {
    pattern: /^(img|images|imagenes|assets|public|static|www|media)\/[^/]*\b(logo|icon|isotipo)[^/]*\.(png|svg|jpe?g)$/i,
    label: "imagen con nombre de logo",
  },
];

export interface IconMatch {
  path: string;
  source: string;
}

/**
 * Depth at which we accept a nested icon.
 *
 * In a monorepo, the web app icon lives in `apps/web/app/icon.png`, not in the root; and in a
 * container repo, in `mi-app/ios/…`. Without this, precisely the best-organized projects end up
 * without an icon — the ones that deserve it the most.
 */
const NESTED_DEPTH = 2;

function matchesPath(path: string, pattern: RegExp): boolean {
  if (pattern.test(path)) return true;

  const parts = path.split("/");
  for (let skip = 1; skip <= Math.min(NESTED_DEPTH, parts.length - 1); skip++) {
    if (pattern.test(parts.slice(skip).join("/"))) return true;
  }
  return false;
}

/**
 * What icon does the app declare in its `AndroidManifest.xml`.
 *
 * Guessing by the file name doesn't work and it has already failed in both directions:
 * `flutter_launcher_icons` generates `launcher_icon.png` and leaves the `ic_launcher.png` from the
 * template intact, while an app with alternative icons has half a dozen `ic_launcher_*.png` next
 * to the correct one. Choosing the longest name is right in the first case and wrong in the
 * second; the shortest one, the opposite.
 *
 * The manifest is not a heuristic: it is the file where the app says what its icon is.
 */
async function declaredAndroidIcon(index: FileIndex): Promise<string | undefined> {
  const manifest = index.files.find((path) =>
    path.endsWith("android/app/src/main/AndroidManifest.xml"),
  );
  if (!manifest) return undefined;

  const text = await readTextAt(index.root, manifest);
  const match = text ? /android:icon="@mipmap\/([\w.-]+)"/.exec(text) : null;
  return match?.[1];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findIcon(index: FileIndex): Promise<IconMatch | undefined> {
  const declared = await declaredAndroidIcon(index);

  // The declared icon goes in front of everything else, and in order of density.
  const name = declared ? escapeRegex(declared) : undefined;
  const candidates = name
    ? [
        {
          pattern: new RegExp(`^android/app/src/main/res/mipmap-xxxhdpi/${name}\\.png$`),
          label: "declarado en AndroidManifest",
        },
        {
          pattern: new RegExp(`^android/app/src/main/res/mipmap-xxhdpi/${name}\\.png$`),
          label: "declarado en AndroidManifest",
        },
        ...CANDIDATES,
      ]
    : CANDIDATES;

  for (const candidate of candidates) {
    const found = index.files.filter((path) => matchesPath(path, candidate.pattern));
    if (found.length === 0) continue;

    // Given equal patterns, the less nested one wins. To break ties between files in the same
    // folder, "the longest name" was a bad rule: it worked on the web
    // (`icon-512.png` beats `icon.png` ) and failed on Android, where all the files
    // of a `mipmap-xxxhdpi` have the same density and a longer name is not more resolution but
    // **another icon** — a `cabeman` showed in the catalog its variant
    // `ic_launcher_nitro_gold_premium.png` instead of its logo.
    //
    // So the tiebreaker first looks at the number that the name carries, which is what really
    // indicates size, and in the absence of a number it prefers the shorter name, which is the
    // canonical one: `ic_launcher.png` before any variant.
    found.sort((a, b) => {
      const depth = a.split("/").length - b.split("/").length;
      if (depth !== 0) return depth;
      const size = largestNumberIn(b) - largestNumberIn(a);
      if (size !== 0) return size;
      return baseName(a).length - baseName(b).length;
    });
    return { path: found[0]!, source: candidate.label };
  }
  return undefined;
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** The largest number that appears in the name; 0 if there is none. */
function largestNumberIn(path: string): number {
  const numbers = baseName(path).match(/\d+/g);
  return numbers ? Math.max(...numbers.map(Number)) : 0;
}

/**
 * Deterministic background color for projects without an icon. The same name always gives the same
 * color, so the grid looks stable between scans.
 */
export function fallbackColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 65% 55%)`;
}
