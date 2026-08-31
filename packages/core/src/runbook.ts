import type { FileIndex } from "./types";
import { readJsonAt, readTextAt, readYamlAt } from "./fs-utils";
import type { PackageJson } from "./ecosystems/npm";

/**
 * How to get a project started again.
 *
 * It is what is missing when you open a folder you haven't touched in fourteen months: not what
 * technology it uses —that is visible— but what is written to start it, what version of what
 * runtime is needed, and which environment variables it expects and are not set.
 *
 * Everything comes from files that already exist in the project. Nothing is invented and nothing
 * is executed: if a project does not declare how it is started, no plausible command appears here,
 * a blank list appears. An invented command that fails in the terminal costs more time than not
 * having offered any.
 */

export interface RunCommand {
  /** What it is for: starting, tests, compiling, installing. */
  purpose: "install" | "start" | "tests" | "build";
  command: string;
  /** Where it came from, literally. */
  source: string;
}

export interface RuntimeNeed {
  /** Identifier with which what is installed is checked: `node`, `flutter`, `python`… */
  id: string;
  name: string;
  /** The restriction as it is written in the draft. */
  required: string;
  source: string;
}

export interface Runbook {
  commands: RunCommand[];
  runtimes: RuntimeNeed[];
  /**
   * Keys declared in the sample file that do not appear in the actual `.env`.
   *
   * It is the number one cause of an old project starting and failing on the first screen, and the
   * one that gives the worst error message.
   */
  missingEnv: string[];
  /** Example file from which those keys come. */
  envExample?: string;
  /** Documentation to start with, the shortest first. */
  docs: string[];
}

/** Npm scripts that mean something, in the order in which they are usually needed. */
const NPM_SCRIPTS: { names: string[]; purpose: RunCommand["purpose"] }[] = [
  { names: ["dev", "start", "serve", "develop"], purpose: "start" },
  { names: ["test", "tests"], purpose: "tests" },
  { names: ["build", "compile"], purpose: "build" },
];

const ENV_EXAMPLES = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
  "env.example",
];

const DOC_FILES = ["README.md", "readme.md", "README", "CONTRIBUTING.md", "AGENTS.md", "CLAUDE.md"];

export async function readRunbook(index: FileIndex): Promise<Runbook> {
  const commands: RunCommand[] = [];
  const runtimes: RuntimeNeed[] = [];

  const [packageJson, pubspec, envPairs] = await Promise.all([
    index.fileSet.has("package.json")
      ? readJsonAt<PackageJson & { engines?: Record<string, string>; packageManager?: string }>(
          index.root,
          "package.json",
        )
      : undefined,
    index.fileSet.has("pubspec.yaml")
      ? readYamlAt<{ environment?: { sdk?: string; flutter?: string } }>(
          index.root,
          "pubspec.yaml",
        )
      : undefined,
    readEnv(index),
  ]);

  // ── npm ─────────────────────────────────────────────────────────────────────
  if (packageJson) {
    const manager = packageManagerOf(index, packageJson.packageManager);
    commands.push({
      purpose: "install",
      command: `${manager} install`,
      source: lockfileOf(index) ?? "package.json",
    });

    const scripts = (packageJson as { scripts?: Record<string, string> }).scripts ?? {};
    for (const group of NPM_SCRIPTS) {
      const name = group.names.find((candidate) => scripts[candidate]);
      if (!name) continue;
      commands.push({
        purpose: group.purpose,
        command: `${manager} run ${name}`,
        source: `scripts.${name}: ${truncate(scripts[name]!)}`,
      });
    }

    const engineNode = packageJson.engines?.["node"];
    if (engineNode) {
      runtimes.push({
        id: "node",
        name: "Node.js",
        required: engineNode,
        source: "engines.node en package.json",
      });
    }
  }

  const nvmrc = index.fileSet.has(".nvmrc")
    ? (await readTextAt(index.root, ".nvmrc"))?.trim()
    : undefined;
  if (nvmrc) {
    runtimes.push({ id: "node", name: "Node.js", required: nvmrc, source: ".nvmrc" });
  }

  // ── Flutter y Dart ──────────────────────────────────────────────────────────
  if (pubspec) {
    const flutter = index.dirSet.has("lib") && index.fileSet.has("pubspec.yaml");
    commands.push({
      purpose: "install",
      command: flutter ? "flutter pub get" : "dart pub get",
      source: "pubspec.yaml",
    });
    if (flutter) {
      commands.push({ purpose: "start", command: "flutter run", source: "pubspec.yaml" });
      commands.push({ purpose: "tests", command: "flutter test", source: "pubspec.yaml" });
    }
    if (pubspec.environment?.sdk) {
      runtimes.push({
        id: "dart",
        name: "Dart SDK",
        required: pubspec.environment.sdk,
        source: "environment.sdk en pubspec.yaml",
      });
    }
    if (pubspec.environment?.flutter) {
      runtimes.push({
        id: "flutter",
        name: "Flutter",
        required: pubspec.environment.flutter,
        source: "environment.flutter en pubspec.yaml",
      });
    }
  }

  // ── Python ──────────────────────────────────────────────────────────────────
  if (index.fileSet.has("requirements.txt")) {
    commands.push({
      purpose: "install",
      command: "pip install -r requirements.txt",
      source: "requirements.txt",
    });
  }
  if (index.fileSet.has("pyproject.toml") && index.fileSet.has("poetry.lock")) {
    commands.push({ purpose: "install", command: "poetry install", source: "poetry.lock" });
  }
  const pythonVersion = index.fileSet.has(".python-version")
    ? (await readTextAt(index.root, ".python-version"))?.trim()
    : undefined;
  if (pythonVersion) {
    runtimes.push({
      id: "python",
      name: "Python",
      required: pythonVersion,
      source: ".python-version",
    });
  }

  // ── Otros ecosistemas ───────────────────────────────────────────────────────
  if (index.fileSet.has("Cargo.toml")) {
    commands.push({ purpose: "start", command: "cargo run", source: "Cargo.toml" });
    commands.push({ purpose: "tests", command: "cargo test", source: "Cargo.toml" });
  }
  if (index.fileSet.has("go.mod")) {
    commands.push({ purpose: "start", command: "go run .", source: "go.mod" });
    commands.push({ purpose: "tests", command: "go test ./...", source: "go.mod" });
  }
  if (index.fileSet.has("Gemfile")) {
    commands.push({ purpose: "install", command: "bundle install", source: "Gemfile" });
  }
  if (index.fileSet.has("composer.json")) {
    commands.push({ purpose: "install", command: "composer install", source: "composer.json" });
  }
  if (index.fileSet.has("Podfile")) {
    commands.push({ purpose: "install", command: "pod install", source: "Podfile" });
  }
  const compose = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"].find((file) =>
    index.fileSet.has(file),
  );
  if (compose) {
    commands.push({ purpose: "start", command: "docker compose up", source: compose });
  }

  return {
    // A Flutter project within an npm monorepo declares both things; leaving both is correct,
    // repeating the same two twice is not.
    commands: dedupe(commands, (command) => command.command),
    runtimes: dedupe(runtimes, (runtime) => `${runtime.id}:${runtime.required}`),
    missingEnv: envPairs.missing,
    envExample: envPairs.example,
    docs: DOC_FILES.filter((file) => index.fileSet.has(file)),
  };
}

/**
 * Keys from the example file that are missing in the actual `.env`.
 *
 * It is read from the disk and not from the index because the index respects `.gitignore`, and
 * `.env` is ignored in all serious projects. It is the same reason why links to services read
 * their identifiers raw.
 */
async function readEnv(index: FileIndex): Promise<{ missing: string[]; example?: string }> {
  for (const candidate of ENV_EXAMPLES) {
    const example = await readTextAt(index.root, candidate);
    if (example === undefined) continue;

    const declared = keysIn(example);
    if (declared.length === 0) return { missing: [], example: candidate };

    // The first one that exists of the three usual names.
    const actual =
      (await readTextAt(index.root, ".env")) ??
      (await readTextAt(index.root, ".env.local")) ??
      (await readTextAt(index.root, ".env.development"));

    // Without `.env`, **all** are missing: it is exactly the case of a freshly cloned folder, and
    // saying "12 variables are missing" is more useful than saying nothing.
    const present = new Set(actual ? keysIn(actual) : []);
    return { missing: declared.filter((key) => !present.has(key)), example: candidate };
  }
  return { missing: [] };
}

function keysIn(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) keys.push(match[1]!);
  }
  return [...new Set(keys)];
}

/** The manager that the project actually uses, according to its lockfile. */
function packageManagerOf(index: FileIndex, declared?: string): string {
  if (declared) return declared.split("@")[0]!;
  if (index.fileSet.has("pnpm-lock.yaml")) return "pnpm";
  if (index.fileSet.has("yarn.lock")) return "yarn";
  if (index.fileSet.has("bun.lockb") || index.fileSet.has("bun.lock")) return "bun";
  return "npm";
}

function lockfileOf(index: FileIndex): string | undefined {
  return ["pnpm-lock.yaml", "yarn.lock", "bun.lockb", "package-lock.json"].find((file) =>
    index.fileSet.has(file),
  );
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function truncate(value: string): string {
  return value.length > 70 ? `${value.slice(0, 69)}…` : value;
}
