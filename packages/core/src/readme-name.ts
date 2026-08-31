import { fold } from "./fold";

/**
 * What does a project call itself in its README.
 *
 * The case that led to this function: a folder called `humo_check` whose README starts with "# Travocato —
 * the honest backtester for trading strategies." In the catalog it appeared as "humo_check," so
 * its author searched for the product name and could not find it — they thought Panoma had not
 * detected it, when it was right in front of them under another name.
 *
 * This goes **between** the manifest and the name of the folder, and that order is the whole
 * argument: if there is a `package.json` with `name`, that is what the author declared and wins;
 * if there is none, the title of the README is the closest thing to a declaration that exists; and
 * the folder is the last resort, because a folder name was chosen by the file system as much as by
 * its owner.
 *
 * It is deliberately skeptical. A README can start with '# Getting Started', and calling the
 * project that would be worse than leaving it with the name of its folder: a bad name spreads to
 * the slug, to the URL, and to the search. When in doubt, nothing is returned.
 */

/**
 * Titles that are not names.
 *
 * They go out to look at real READMEs: half of personal projects start with the title that the
 * template put. It is compared in lowercase and without accents.
 */
const NOT_NAMES = new Set([
  "readme",
  "getting started",
  "introduction",
  "introduccion",
  "documentation",
  "documentacion",
  "docs",
  "overview",
  "about",
  "acerca de",
  "installation",
  "instalacion",
  "usage",
  "uso",
  "todo",
  "notes",
  "notas",
  "project",
  "proyecto",
  "my project",
  "mi proyecto",
  "untitled",
  "sin titulo",
  "app",
  "api",
  "backend",
  "frontend",
  "server",
  "client",
  "web",
  "demo",
  "test",
  "example",
  "ejemplo",
  "template",
  "template",
  "starter",
  "boilerplate",
  "changelog",
  "contributing",
  "license",
  "licencia",
]);

/** Longer than this is a sentence, not a name. */
const MAX = 32;

/**
 * Take the title name from README, or `undefined` if there is no reliable one.
 *
 * `folder` is used to avoid repeating what is already known: if the title says the same as the
 * folder, there is nothing to add and returning it would only create work for the rest of the
 * chain.
 */
export function readmeName(
  text: string | undefined,
  folder: string,
  children: string[] = [],
): string | undefined {
  if (!text) return undefined;

  const title = firstHeading(text);
  if (!title) return undefined;

  /*
    From the title, you take what comes before the separator.
    «Travocato — the honest backtester for trading strategies» is the most common pattern of
    README well written: name, separator, what it does.
    The dash, the hyphen, and the slash require space **on both sides**: without this condition,
    «humo-check» and «create-react-app» would be split at the hyphen of their own name. The colon
    is different because it is written attached to the word —«Panoma: the App Store»— and
    requiring a space before it would leave them out.
   */
  const name = title.split(/(?:\s+[—–\-|]\s+|:\s+)/)[0]?.trim();
  if (!name) return undefined;

  if (name.length > MAX) return undefined;
  // At least one letter: a title that is only symbols or numbers names nothing.
  if (!/\p{L}/u.test(name)) return undefined;
  // More than four words is already a sentence no matter if it fits in thirty-two characters.
  if (name.split(/\s+/).length > 4) return undefined;
  if (NOT_NAMES.has(normalize(name))) return undefined;

  // The same as the folder already says, with another box or another divider, it doesn't add
  // anything.
  if (comparable(name) === comparable(folder)) return undefined;

  /*
    And if the title is the name of a folder inside, the README talks about it.
    `design templates/README.md` starts with «# Pandaka», which is the app that lives in
    `design templates/pandaka`. Taking it left two cards —«Pandaka» the container and «pandaka»
    the app— with the same name, the same icon, and no way to know which was which. A container
    whose README talks about one of its children is not named like it.
   */
  if (children.some((child) => comparable(child) === comparable(name))) return undefined;

  return name;
}

/**
 * The first level one header, in the two forms that Markdown supports.
 *
 * They skip badges, HTML and comments because almost all modern READMEs open with a row of shields
 * of CI before saying anything.
 */
function firstHeading(text: string): string | undefined {
  const clean = text
    .replace(/^---[\s\S]*?^---/m, "") // Metadata cover, if it has one.
    .replace(/<!--[\s\S]*?-->/g, "");

  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const hashTitle = /^#\s+(.+)$/.exec(line);
    if (hashTitle) return stripOrnaments(hashTitle[1]!);

    // The other way of Markdown: the title with a row of `=` underneath.
    const next = lines[i + 1]?.trim();
    if (next && /^=+$/.test(next) && !line.startsWith("#")) {
      return stripOrnaments(line);
    }
    // Anything else before the first title means that no title is worth it.
    if (!line.startsWith("[") && !line.startsWith("<") && !line.startsWith("!")) return undefined;
  }
  return undefined;
}

/** Remove links, images, emphasis, emojis, and quotation marks: the adornment of almost all titles. */
function stripOrnaments(title: string): string {
  return title
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // Images, and the logo usually goes in front of the name.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // Links: the text remains.
    .replace(/[*_`~]/g, "")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/^["'«»]+|["'«»]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Folder names that do not identify anything by themselves.
 *
 * `linkaloud/server` appeared in the catalog as 'server', next to another 'server' from another
 * project: two cards with the same name and no way to know which was which. They are the folders
 * into which a project is split, not projects with that name.
 */
const GENERIC_NAMES = new Set([
  "app",
  "apps",
  "server",
  "servers",
  "backend",
  "frontend",
  "api",
  "client",
  "web",
  "site",
  "www",
  "src",
  "core",
  "main",
  "lib",
  "libs",
  "packages",
  "tools",
  "scripts",
  "service",
  "services",
  "mobile",
  "desktop",
  "admin",
  "dashboard",
  "ui",
]);

/**
 * It puts in front the name of the folder that contains it when its own says nothing.
 *
 * `linkaloud/server` → «linkaloud server». Nothing else is touched: a project called `dricopilot`
 * continues to be called that, and if the parent is also generic —`app/server`— there is nothing
 * to add that clarifies anything.
 */
/**
 * Add afterwards the role that the folder plays, when the name does not indicate it.
 *
 * The case: `linkaloud/server` has a README that says «LinkAloud», so it was called LinkAloud —
 * just like the app that lives in `linkaloud/app`. Two almost identical cards for two different
 * things: a Flutter app and a Python server. «LinkAloud server» separates them without taking away
 * from either the product name, which is what its owner is looking for.
 */
export function qualifyWithFolder(name: string, folder: string): string {
  if (!GENERIC_NAMES.has(normalize(folder))) return name;
  // If the name already says it —"my-api" in a `api` folder— repeating it is unnecessary.
  if (comparable(name).endsWith(comparable(folder))) return name;
  return `${name} ${folder}`;
}

export function qualifyWithParent(name: string, padre: string): string {
  if (!GENERIC_NAMES.has(normalize(name))) return name;
  const clean = padre.trim();
  if (!clean || GENERIC_NAMES.has(normalize(clean))) return name;
  // As the father says: `server/server` does not improve with 'server server'.
  if (comparable(clean) === comparable(name)) return name;
  return `${clean} ${name}`;
}

function normalize(value: string): string {
  return fold(value).trim();
}

/** To compare name and folder ignoring case, accents, and separators. */
function comparable(value: string): string {
  return normalize(value).replace(/[\s_-]+/g, "");
}
