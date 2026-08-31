import type { FileIndex, ProjectAnalysis } from "./types";
import { readTextAt } from "./fs-utils";

/**
 * What a project is about.
 *
 * There are three sources and they are preferred in this order, because that is the order in which
 * they cease to be the author's words:
 *
 * 1. **The description of the manifest.** Someone wrote it on purpose.
 * 2. **The first paragraph of README.** Also, although with more noise around.
 * 3. **A compound sentence with what the engine already knows.** Nobody wrote it, but nothing is
 * made up either: 'Mobile app in Flutter with Firebase and Stripe, published on the App Store and
 * Google Play'.
 *
 * What none of the three do is fill the gap with something plausible. And there is a fourth case
 * that matters more than it seems: **the template text**. The description of `qrchat` today is
 * "This is a Next.js project bootstrapped with create-next-app," which says nothing about the
 * project and even takes the place of what would actually say something. A template text is worse
 * than no text, so it is detected and discarded.
 */

/**
 * What this project **is**, as an identifier and not as a phrase.
 *
 * Before this, it was Spanish inside the engine —'Mobile app', 'Web application'— and that string
 * would reach the screen intact. As an identifier, it can be translated where it belongs:
 * whoever designs chooses the words, and the engine only says what it is about.
 */
export type ProjectKind =
  | "mobile-app"
  | "web-app"
  | "cli"
  | "package"
  | "backend"
  | "container"
  | "project";

/**
 * The compound sentence, **before being a sentence**.
 *
 * It is the one taught from the worst documented projects, which in a real disk are the majority:
 * those that have no description in the manifest nor a README with prose. It was written in
 * Spanish within the engine and appeared as such on the terminal —English monolingual— and on a
 * card in English.
 *
 * What comes out of here is data, and the words are put by whoever has a reader in front of them.
 * Proper names are not touched: `Flutter`, `Stripe`, and `App Store` are called the same in both
 * languages, and translating them would be inventing a product.
 */
export interface Composition {
  kind: ProjectKind;
  /** Languages and frameworks, by their name. Up to two. */
  stack: string[];
  /** External services that the project actually uses. Up to three. */
  services: string[];
  /** Where is it published. Up to two. */
  stores: string[];
  /** The agent who wrote a recognizable part of the history, if any. */
  topAgent?: { name: string; share: number };
}

export interface Summary {
  /**
   * The phrase that is taught, when it was written by a person.
   *
   * For composite projects, it is the backup in English of `composition`, and it is what the
   * terminal, the MCP server, and the assignments to the agents read — all three monolingual. The
   * website does not use it in that case: it displays `composition` in the language of the viewer.
   */
  text: string;
  /** Where did it come from: `manifiesto`, `readme`, or `compuesta`. */
  source: "manifest" | "readme" | "composed";
  /** The paragraph of README, even if it is not the chosen sentence. */
  readme?: string;
  /** The compound sentence in English, always, in order to be able to teach it along with the author's. */
  composed: string;
  /** And its loose pieces, for whoever knows in which language they have to write it. */
  composition: Composition;
  /** Template texts that were discarded, with what they were. They are not taught anywhere. */
  discarded: string[];
}

/**
 * Phrases with which generators fill in the description.
 *
 * They appear identical in thousands of repositories, which is exactly what gives them away: they
 * describe the tool created by the project, not the project.
 */
const BOILERPLATE: RegExp[] = [
  /bootstrapped with .{0,20}create-next-app/i,
  /^this is a .{0,30}next\.js.{0,20}project/i,
  /getting started with create react app/i,
  /^a new flutter (project|application|plugin|package)/i,
  /^a new dart (project|package)/i,
  /^the official .{0,30}starter/i,
  /^my (awesome )?(app|project)\.?$/i,
  /^todo:?\s*(add|write)/i,
  /^describe your project here/i,
  /^project description/i,
  /^\s*$/,
  /^(hello|test|prueba|demo)\.?$/i,
  /created with (expo|vite|astro)/i,
  /^starter template/i,
];

function isBoilerplate(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return true;
  return BOILERPLATE.some((pattern) => pattern.test(trimmed));
}

/** What kind of project is this. It returns the identifier; someone else provides the words. */
function kindOf(analysis: ProjectAnalysis): ProjectKind {
  const has = (id: string) => analysis.technologies.some((tech) => tech.id === id);
  const dist = (kind: string) => analysis.distributions.some((d) => d.kind === kind);

  if (dist("app_store") || dist("play_store") || has("flutter") || has("react-native")) {
    return "mobile-app";
  }
  if (has("nextjs") || has("astro") || has("nuxt") || has("sveltekit") || dist("web")) {
    return "web-app";
  }
  if (dist("cli")) return "cli";
  if (dist("npm")) return "package";
  if (has("express") || has("fastapi") || has("django") || has("rails") || has("nestjs")) {
    return "backend";
  }
  if (dist("docker")) return "container";
  return "project";
}

/**
 * What the engine knows how to say about a project, in pieces.
 *
 * It only states proven things, and each piece is optional: from a project about which little is
 * known comes a short composition instead of a filler sentence.
 */
export function composeSummary(analysis: ProjectAnalysis): Composition {
  const stack = analysis.technologies
    .filter((tech) => tech.kind === "framework" || tech.kind === "language")
    .filter((tech) => tech.confidence >= 0.6)
    .slice(0, 2)
    .map((tech) => tech.name);

  // External services are what most indicate what a project does: 'with Firebase, Supabase, and
  // Stripe' describes an app better than any adjective.
  const services = analysis.links
    .filter((link) => link.kind === "deep")
    .map((link) => link.service)
    .filter((service) => service !== "GitHub" && service !== "GitLab")
    .slice(0, 3);

  const stores = analysis.distributions
    .filter((d) => d.kind === "app_store" || d.kind === "play_store" || d.kind === "npm")
    .map((d) => d.label)
    .slice(0, 2);

  const composition: Composition = { kind: kindOf(analysis), stack, services, stores };

  const agents = analysis.git?.agentContributors ?? [];
  if (agents.length > 0 && analysis.git?.commitCount) {
    const share = Math.round((agents[0]!.commits / analysis.git.commitCount) * 100);
    // Below one fifth says nothing: in a long history, 3% is noise.
    if (share >= 20) composition.topAgent = { name: agents[0]!.name, share };
  }

  return composition;
}

/** What is the name of each type of project when the reader is a machine, or the terminal. */
const KIND_IN_ENGLISH: Record<ProjectKind, string> = {
  "mobile-app": "Mobile app",
  "web-app": "Web app",
  cli: "Command-line tool",
  package: "Publishable package",
  backend: "Backend service",
  container: "Containerized service",
  project: "Project",
};

/**
 * The written composition, in English.
 *
 * In English and not in Spanish because the one reading this is a machine or the terminal: the MCP
 * server, the tasks assigned to an agent, and `panoma scan`, who has been speaking English since
 * 25-Aug-2026. The web does not go through here — it has the composition and its dictionary, and
 * writes the same sentence in the language of whoever is viewing.
 */
export function composedText(composition: Composition): string {
  const parts: string[] = [];
  const kind = KIND_IN_ENGLISH[composition.kind];

  parts.push(composition.stack.length > 0 ? `${kind} in ${list(composition.stack)}` : kind);
  if (composition.services.length > 0) parts.push(`uses ${list(composition.services)}`);
  if (composition.stores.length > 0) parts.push(`published on ${list(composition.stores)}`);
  if (composition.topAgent) {
    parts.push(`${composition.topAgent.share}% of the history written by ${composition.topAgent.name}`);
  }

  return `${parts.join(", ")}.`;
}

export async function readSummary(
  index: FileIndex,
  analysis: Omit<ProjectAnalysis, "summary">,
): Promise<Summary> {
  const composition = composeSummary(analysis as ProjectAnalysis);
  const composed = composedText(composition);
  const discarded: string[] = [];

  const readme = await readReadmeParagraph(index);
  if (readme && isBoilerplate(readme)) {
    discarded.push(`README: «${truncate(readme, 60)}»`);
  }
  const usableReadme = readme && !isBoilerplate(readme) ? readme : undefined;

  const declared = analysis.description?.trim();
  if (declared && isBoilerplate(declared)) {
    discarded.push(`manifiesto: «${truncate(declared, 60)}»`);
  }
  const usableDeclared = declared && !isBoilerplate(declared) ? declared : undefined;

  if (usableDeclared) {
    return { text: usableDeclared, source: "manifest", readme: usableReadme, composed, composition, discarded };
  }
  if (usableReadme) {
    return { text: usableReadme, source: "readme", readme: usableReadme, composed, composition, discarded };
  }
  return { text: composed, source: "composed", readme: usableReadme, composed, composition, discarded };
}

/**
 * The first paragraph of prose of the README.
 *
 * It skips titles, badges, HTML, blocks of code, and quotes, which is almost everything that comes
 * before the real text in a modern README. If nothing remains after cleaning, it returns nothing
 * instead of a piece of a table.
 */
async function readReadmeParagraph(index: FileIndex): Promise<string | undefined> {
  const file = ["README.md", "readme.md", "README", "README.markdown", "README.txt"].find(
    (candidate) => index.fileSet.has(candidate),
  );
  if (!file) return undefined;

  const text = await readTextAt(index.root, file);
  if (!text) return undefined;

  // Remove the entire code blocks before splitting into paragraphs: one of them may contain blank
  // lines and would split the text where it shouldn't.
  const withoutCode = text.replace(/```[\s\S]*?```/g, "\n\n");

  for (const block of withoutCode.split(/\n\s*\n/)) {
    const cleaned = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^#{1,6}\s/.test(line) && !/^[>|]/.test(line) && !/^[-*_]{3,}$/.test(line))
      .join(" ")
      // Badges and image links: `[![build](…)](…)`
      .replace(/\[!\[[^\]]*]\([^)]*\)]\([^)]*\)/g, "")
      .replace(/!\[[^\]]*]\([^)]*\)/g, "")
      // Markdown links: the text is preserved, the URL is thrown away.
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length < 25) continue;
    // A line with five «·» or «|» is a table or a row of badges, not a sentence.
    if ((cleaned.match(/[|·]/g)?.length ?? 0) > 4) continue;
    return truncate(cleaned, 400);
  }

  return undefined;
}

/** "a, b and c." In English, like everything that comes out of `composedText`. */
function list(items: string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`;
}
