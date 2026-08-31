/**
 * What each project is about, for the catalog filters.
 *
 * It lives outside the component because it is pure logic and because this way it can be tested:
 * the bug that brought it here — 'script' nesting inside 'javascript' — was invisible when reading
 * the code and obvious as soon as a real project is passed to it.
 */

/** The minimum required to qualify. A `StoreProject` is more than enough. */
export interface ClassifiableProject {
  name: string;
  primaryLanguage: string | null;
  technologies: { name: string; kind: string }[];
}

/*
  What a project is, according to what the engine detected inside.
  Before this, it was a run of regular expressions over the name, the language, and the
  technologies glued into a single string, and it failed in two ways at once:
  1. **I was looking for pieces of the word.** `script` house inside `javascript`, so any
  JavaScript project without a framework fell into 'Tools.' Two landing pages—the most web there
  is—were classified as tools and disappeared from 'Web'.
  2. **It only gave one category.** A Next.js with PostgreSQL had to choose between web and
  backend, and since the rules were tested in order, the first one always won. Choosing for the
  user is exactly what a filter should not do: if the project is web, it has to appear in «Web»,
  and if it is also backend, also in «Backend».
  Now it is compared with full technology names and with the `kind` that the engine brings, and a
  set is returned. `other` is the only exclusive one, because it means 'none'.
 */
export type Category = "web" | "mobile" | "backend" | "tools" | "ai" | "other";

const MOBILE = new Set(["flutter", "react native", "expo", "android", "ios", "swift", "kotlin", "dart"]);
const WEB = new Set([
  "next.js", "react", "vue", "nuxt", "svelte", "sveltekit", "angular", "astro",
  "remix / react router", "solidjs", "vite", "tailwind css", "shadcn/ui", "electron", "tauri",
]);
const BACKEND = new Set([
  "express", "fastify", "nestjs", "hono", "django", "flask", "fastapi", "ruby on rails",
  "laravel", "symfony", "sinatra", "gin", "echo", "fiber", "axum", "actix web",
]);
/*
  “Tools” is MCP and little else, on purpose.
  Here were GitHub Actions and Turborepo, and that put Travocato —a backtester in Python— and
  freqtrade in the category. Having CI or being a monorepo doesn't say what a project is: it has
  almost everything that is taken seriously, so as a signal it separates nothing. An MCP server is
  a tool: it exists for another program to use it.
 */
const TOOL_TECHS = new Set(["mcp"]);

/** Languages that by themselves already indicate what the project is about. */
const WEB_LANGUAGES = new Set(["html", "css", "scss"]);
const BACKEND_LANGUAGES = new Set(["python", "go", "rust", "ruby", "php", "java", "c#", "elixir"]);
const MOBILE_LANGUAGES = new Set(["dart", "swift", "kotlin", "objective-c"]);

/*
  Databases that involve a server, which are not all.
  Here `kind === "database"` was seen on its own, and that dragged 'Backend' into all Flutter
  apps: SQLite is the local storage of any mobile app, not a backend. The distinction is not the
  type of technology, it's whether there is something listening on the other side.
 */
const SERVER_DATABASES = new Set(["postgresql", "mysql", "mongodb", "redis", "mariadb"]);

/** Web deployment platforms: if something is published on Vercel, it is a website. */
const WEB_PLATFORMS = new Set(["vercel", "netlify", "cloudflare workers"]);

export function projectCategories(project: ClassifiableProject): Set<Category> {
  const found = new Set<Category>();
  const language = (project.primaryLanguage ?? "").toLowerCase();

  for (const technology of project.technologies) {
    const name = technology.name.toLowerCase();
    if (technology.kind === "model") found.add("ai");
    if (MOBILE.has(name)) found.add("mobile");
    if (WEB.has(name) || WEB_PLATFORMS.has(name)) found.add("web");
    if (BACKEND.has(name) || SERVER_DATABASES.has(name)) found.add("backend");
    if (TOOL_TECHS.has(name)) found.add("tools");
  }

  if (MOBILE_LANGUAGES.has(language)) found.add("mobile");
  if (WEB_LANGUAGES.has(language)) found.add("web");
  if (BACKEND_LANGUAGES.has(language)) found.add("backend");

  /*
    A command-line executable leaves no trace in the dependencies, so here the name is looked at —
    but by whole words, which was what was missing before. And it only counts if nothing else has
    been recognized: a `dri-control-panel` with React is a website with the word "control" inside,
    not a tool.
   */
  if (found.size === 0 && /\b(cli|tool|tools|runner|script|scripts|terminal|bot|daemon|agent)\b/.test(project.name.toLowerCase())) {
    found.add("tools");
  }

  /*
    A project with only a server runtime and nothing else is a service.
    The last one goes and only when it hasn't fit into anything because `Node.js` has almost
    everything that a `package.json` carries: if it always counted, 'Backend' would end up being
    the list of everything that is not Flutter, which doesn't filter anything.
   */
  if (
    found.size === 0 &&
    project.technologies.some(
      (technology) =>
        technology.kind === "runtime" &&
        ["node.js", "deno", "bun"].includes(technology.name.toLowerCase()),
    )
  ) {
    found.add("backend");
  }

  if (found.size === 0) found.add("other");
  return found;
}
