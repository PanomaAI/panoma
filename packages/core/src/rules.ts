import type { Ecosystem, TechKind } from "./types";

/**
 * Catalog of identification rules.
 *
 * Each rule accumulates confidence from independent signals. We store the *evidence* of each match
 * so that the interface can explain why it detected something — and so that the user can correct
 * us when we make a mistake.
 */

export type Matcher =
  /** Ruta relativa exacta. */
  | { type: "file"; path: string }
  /** Any of these routes. */
  | { type: "anyFile"; paths: string[] }
  /** Directorio existente. */
  | { type: "dir"; path: string }
  /** Pattern against any route of the index. */
  | { type: "glob"; pattern: RegExp }
  /** Content of a text file. */
  | { type: "content"; path: string; pattern: RegExp }
  /** Declared dependency. It also provides the detected version. */
  | { type: "dep"; ecosystem: Ecosystem; name: string | RegExp }
  /** Script de package.json. */
  | { type: "script"; pattern: RegExp };

export interface Rule {
  id: string;
  name: string;
  kind: TechKind;
  /** simple-icons slug to render the logo. */
  iconSlug?: string;
  /** If detected, these other rules are discarded (e.g., Next.js implies React as the root framework). */
  supersedes?: string[];
  matchers: (Matcher & { weight: number })[];
}

const m = {
  file: (path: string, weight: number) => ({ type: "file" as const, path, weight }),
  anyFile: (paths: string[], weight: number) => ({ type: "anyFile" as const, paths, weight }),
  dir: (path: string, weight: number) => ({ type: "dir" as const, path, weight }),
  glob: (pattern: RegExp, weight: number) => ({ type: "glob" as const, pattern, weight }),
  content: (path: string, pattern: RegExp, weight: number) => ({
    type: "content" as const,
    path,
    pattern,
    weight,
  }),
  dep: (ecosystem: Ecosystem, name: string | RegExp, weight: number) => ({
    type: "dep" as const,
    ecosystem,
    name,
    weight,
  }),
  script: (pattern: RegExp, weight: number) => ({ type: "script" as const, pattern, weight }),
};

export const RULES: Rule[] = [
  // ─── Runtimes y lenguajes ──────────────────────────────────────────────────
  {
    id: "node",
    name: "Node.js",
    kind: "runtime",
    iconSlug: "nodedotjs",
    matchers: [m.file("package.json", 0.8), m.anyFile([".nvmrc", ".node-version"], 0.2)],
  },
  {
    id: "deno",
    name: "Deno",
    kind: "runtime",
    iconSlug: "deno",
    supersedes: ["node"],
    matchers: [m.anyFile(["deno.json", "deno.jsonc", "deno.lock"], 0.95)],
  },
  {
    id: "bun",
    name: "Bun",
    kind: "runtime",
    iconSlug: "bun",
    matchers: [m.anyFile(["bun.lockb", "bun.lock", "bunfig.toml"], 0.9)],
  },
  {
    id: "typescript",
    name: "TypeScript",
    kind: "language",
    iconSlug: "typescript",
    matchers: [
      m.anyFile(["tsconfig.json", "tsconfig.base.json"], 0.7),
      m.dep("npm", "typescript", 0.3),
    ],
  },
  {
    id: "dart",
    name: "Dart",
    kind: "language",
    iconSlug: "dart",
    matchers: [m.file("pubspec.yaml", 0.9), m.file("analysis_options.yaml", 0.1)],
  },
  {
    id: "python",
    name: "Python",
    kind: "language",
    iconSlug: "python",
    matchers: [
      m.anyFile(["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], 0.8),
      m.glob(/\.py$/, 0.2),
    ],
  },
  { id: "go", name: "Go", kind: "language", iconSlug: "go", matchers: [m.file("go.mod", 0.95)] },
  {
    id: "rust",
    name: "Rust",
    kind: "language",
    iconSlug: "rust",
    matchers: [m.file("Cargo.toml", 0.95)],
  },
  {
    id: "ruby",
    name: "Ruby",
    kind: "language",
    iconSlug: "ruby",
    matchers: [m.anyFile(["Gemfile", ".ruby-version"], 0.9)],
  },
  {
    id: "php",
    name: "PHP",
    kind: "language",
    iconSlug: "php",
    matchers: [m.file("composer.json", 0.9)],
  },
  {
    id: "swift",
    name: "Swift",
    kind: "language",
    iconSlug: "swift",
    matchers: [m.file("Package.swift", 0.8), m.glob(/\.swift$/, 0.3)],
  },
  {
    id: "kotlin",
    name: "Kotlin",
    kind: "language",
    iconSlug: "kotlin",
    matchers: [m.glob(/\.kts?$/, 0.6)],
  },
  {
    id: "csharp",
    name: "C#",
    kind: "language",
    iconSlug: "dotnet",
    matchers: [m.glob(/\.csproj$/, 0.9), m.glob(/\.sln$/, 0.3)],
  },

  // ─── Frameworks web ────────────────────────────────────────────────────────
  {
    id: "nextjs",
    name: "Next.js",
    kind: "framework",
    iconSlug: "nextdotjs",
    supersedes: ["react"],
    matchers: [
      m.dep("npm", "next", 0.9),
      m.glob(/^next\.config\.(js|mjs|ts|cjs)$/, 0.3),
      m.dir("app", 0.05),
    ],
  },
  {
    id: "react",
    name: "React",
    kind: "framework",
    iconSlug: "react",
    matchers: [m.dep("npm", "react", 0.85), m.glob(/\.tsx$/, 0.15)],
  },
  {
    id: "vue",
    name: "Vue",
    kind: "framework",
    iconSlug: "vuedotjs",
    matchers: [m.dep("npm", "vue", 0.85), m.glob(/\.vue$/, 0.15)],
  },
  {
    id: "nuxt",
    name: "Nuxt",
    kind: "framework",
    iconSlug: "nuxt",
    supersedes: ["vue"],
    matchers: [m.dep("npm", "nuxt", 0.9), m.glob(/^nuxt\.config\.(js|ts)$/, 0.3)],
  },
  {
    id: "svelte",
    name: "Svelte",
    kind: "framework",
    iconSlug: "svelte",
    matchers: [m.dep("npm", "svelte", 0.85), m.glob(/\.svelte$/, 0.15)],
  },
  {
    id: "sveltekit",
    name: "SvelteKit",
    kind: "framework",
    iconSlug: "svelte",
    supersedes: ["svelte"],
    matchers: [m.dep("npm", "@sveltejs/kit", 0.95)],
  },
  {
    id: "angular",
    name: "Angular",
    kind: "framework",
    iconSlug: "angular",
    matchers: [m.dep("npm", "@angular/core", 0.95), m.file("angular.json", 0.3)],
  },
  {
    id: "astro",
    name: "Astro",
    kind: "framework",
    iconSlug: "astro",
    matchers: [m.dep("npm", "astro", 0.9), m.glob(/^astro\.config\.(js|mjs|ts)$/, 0.3)],
  },
  {
    id: "remix",
    name: "Remix / React Router",
    kind: "framework",
    iconSlug: "remix",
    matchers: [m.dep("npm", /^@remix-run\//, 0.9)],
  },
  {
    id: "solid",
    name: "SolidJS",
    kind: "framework",
    iconSlug: "solid",
    matchers: [m.dep("npm", "solid-js", 0.9)],
  },
  {
    id: "vite",
    name: "Vite",
    kind: "tool",
    iconSlug: "vite",
    matchers: [m.dep("npm", "vite", 0.8), m.glob(/^vite\.config\.(js|ts|mjs)$/, 0.3)],
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    kind: "tool",
    iconSlug: "tailwindcss",
    matchers: [
      m.dep("npm", "tailwindcss", 0.9),
      m.glob(/^tailwind\.config\.(js|ts|cjs|mjs)$/, 0.3),
    ],
  },
  {
    id: "shadcn",
    name: "shadcn/ui",
    kind: "tool",
    iconSlug: "shadcnui",
    matchers: [m.file("components.json", 0.5), m.dep("npm", /^@radix-ui\//, 0.5)],
  },

  // ─── Backend ───────────────────────────────────────────────────────────────
  {
    id: "express",
    name: "Express",
    kind: "framework",
    iconSlug: "express",
    matchers: [m.dep("npm", "express", 0.9)],
  },
  {
    id: "fastify",
    name: "Fastify",
    kind: "framework",
    iconSlug: "fastify",
    matchers: [m.dep("npm", "fastify", 0.9)],
  },
  {
    id: "nestjs",
    name: "NestJS",
    kind: "framework",
    iconSlug: "nestjs",
    matchers: [m.dep("npm", "@nestjs/core", 0.95)],
  },
  {
    id: "hono",
    name: "Hono",
    kind: "framework",
    iconSlug: "hono",
    matchers: [m.dep("npm", "hono", 0.9)],
  },
  {
    id: "django",
    name: "Django",
    kind: "framework",
    iconSlug: "django",
    matchers: [m.dep("pypi", "Django", 0.9), m.file("manage.py", 0.3)],
  },
  {
    id: "flask",
    name: "Flask",
    kind: "framework",
    iconSlug: "flask",
    matchers: [m.dep("pypi", "Flask", 0.9)],
  },
  {
    id: "fastapi",
    name: "FastAPI",
    kind: "framework",
    iconSlug: "fastapi",
    matchers: [m.dep("pypi", "fastapi", 0.95)],
  },
  {
    id: "rails",
    name: "Ruby on Rails",
    kind: "framework",
    iconSlug: "rubyonrails",
    matchers: [m.dep("rubygems", "rails", 0.8), m.file("config/routes.rb", 0.2)],
  },
  {
    id: "laravel",
    name: "Laravel",
    kind: "framework",
    iconSlug: "laravel",
    matchers: [m.file("artisan", 0.6), m.dep("packagist", "laravel/framework", 0.6)],
  },
  {
    id: "symfony",
    name: "Symfony",
    kind: "framework",
    iconSlug: "symfony",
    matchers: [m.dep("packagist", /^symfony\/(framework-bundle|console)$/, 0.9)],
  },
  {
    id: "sinatra",
    name: "Sinatra",
    kind: "framework",
    iconSlug: "rubysinatra",
    matchers: [m.dep("rubygems", "sinatra", 0.9)],
  },
  {
    id: "gin",
    name: "Gin",
    kind: "framework",
    iconSlug: "gin",
    matchers: [m.dep("go", "github.com/gin-gonic/gin", 0.95)],
  },
  {
    id: "echo",
    name: "Echo",
    kind: "framework",
    matchers: [m.dep("go", /^github\.com\/labstack\/echo/, 0.95)],
  },
  {
    id: "fiber",
    name: "Fiber",
    kind: "framework",
    matchers: [m.dep("go", /^github\.com\/gofiber\/fiber/, 0.95)],
  },
  {
    id: "axum",
    name: "Axum",
    kind: "framework",
    matchers: [m.dep("cargo", "axum", 0.9)],
  },
  {
    id: "actix",
    name: "Actix Web",
    kind: "framework",
    matchers: [m.dep("cargo", "actix-web", 0.9)],
  },
  {
    id: "tokio",
    name: "Tokio",
    kind: "runtime",
    matchers: [m.dep("cargo", "tokio", 0.85)],
  },
  {
    id: "serde",
    name: "Serde",
    kind: "tool",
    matchers: [m.dep("cargo", "serde", 0.85)],
  },

  // ─── Mobile and desktop ────────────────────────────────────────────────────
  {
    id: "flutter",
    name: "Flutter",
    kind: "framework",
    iconSlug: "flutter",
    matchers: [
      // `flutter:` as a dependency (always `sdk: flutter` ) is practically definitive: no pure Dart
      // package declares it.
      m.dep("pub", "flutter", 0.7),
      m.content("pubspec.yaml", /^\s{0,2}flutter\s*:/m, 0.25),
      m.file("pubspec.yaml", 0.05),
    ],
  },
  {
    id: "react-native",
    name: "React Native",
    kind: "framework",
    iconSlug: "react",
    supersedes: ["react"],
    matchers: [m.dep("npm", "react-native", 0.9), m.file("metro.config.js", 0.1)],
  },
  {
    id: "expo",
    name: "Expo",
    kind: "framework",
    iconSlug: "expo",
    matchers: [m.dep("npm", "expo", 0.85), m.anyFile(["app.json", "app.config.ts"], 0.15)],
  },
  {
    id: "electron",
    name: "Electron",
    kind: "framework",
    iconSlug: "electron",
    matchers: [m.dep("npm", "electron", 0.9)],
  },
  {
    id: "tauri",
    name: "Tauri",
    kind: "framework",
    iconSlug: "tauri",
    matchers: [m.dir("src-tauri", 0.8), m.dep("npm", /^@tauri-apps\//, 0.2)],
  },
  {
    id: "android",
    name: "Android",
    kind: "platform",
    iconSlug: "android",
    matchers: [m.dir("android/app", 0.7), m.anyFile(["build.gradle", "build.gradle.kts"], 0.3)],
  },
  {
    id: "ios",
    name: "iOS",
    kind: "platform",
    iconSlug: "apple",
    matchers: [m.glob(/\.xcodeproj\//, 0.6), m.dir("ios", 0.4), m.file("Podfile", 0.2)],
  },

  // ─── Datos ─────────────────────────────────────────────────────────────────
  {
    id: "postgres",
    name: "PostgreSQL",
    kind: "database",
    iconSlug: "postgresql",
    matchers: [
      m.dep("npm", /^(pg|postgres)$/, 0.8),
      m.dep("pypi", /^psycopg/, 0.8),
      m.dep("go", /\/(pgx|lib\/pq)/, 0.8),
      m.dep("cargo", "sqlx", 0.5),
      m.dep("rubygems", "pg", 0.8),
    ],
  },
  {
    id: "sqlite",
    name: "SQLite",
    kind: "database",
    iconSlug: "sqlite",
    matchers: [
      m.dep("npm", /sqlite3?$/, 0.7),
      m.dep("pub", "sqflite", 0.8),
      m.dep("cargo", "rusqlite", 0.8),
      m.dep("rubygems", "sqlite3", 0.8),
    ],
  },
  {
    id: "mysql",
    name: "MySQL",
    kind: "database",
    iconSlug: "mysql",
    matchers: [
      m.dep("npm", /^mysql2?$/, 0.85),
      m.dep("rubygems", "mysql2", 0.85),
      m.dep("packagist", "doctrine/dbal", 0.4),
    ],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    kind: "database",
    iconSlug: "mongodb",
    matchers: [
      m.dep("npm", /^(mongodb|mongoose)$/, 0.85),
      m.dep("pypi", /^(pymongo|motor)$/, 0.85),
      m.dep("go", /go\.mongodb\.org/, 0.85),
    ],
  },
  {
    id: "redis",
    name: "Redis",
    kind: "database",
    iconSlug: "redis",
    matchers: [
      m.dep("npm", /^(redis|ioredis)$/, 0.85),
      m.dep("pypi", "redis", 0.85),
      m.dep("go", /redis/, 0.7),
      m.dep("rubygems", "redis", 0.85),
    ],
  },
  {
    id: "prisma",
    name: "Prisma",
    kind: "tool",
    iconSlug: "prisma",
    matchers: [m.dep("npm", "prisma", 0.6), m.file("prisma/schema.prisma", 0.4)],
  },
  {
    id: "drizzle",
    name: "Drizzle ORM",
    kind: "tool",
    iconSlug: "drizzle",
    matchers: [m.dep("npm", "drizzle-orm", 0.9)],
  },
  {
    id: "supabase",
    name: "Supabase",
    kind: "platform",
    iconSlug: "supabase",
    matchers: [
      m.dep("npm", /^@supabase\//, 0.7),
      // The services publish a client for each language, and a rule that only looks at npm makes
      // them invisible exactly in the projects that are not web. A Flutter with `supabase_flutter`
      // uses Supabase the same as a Next.js with `@supabase/supabase-js`.
      m.dep("pub", /^supabase(_flutter)?$/, 0.7),
      m.dep("pypi", "supabase", 0.7),
      m.dir("supabase", 0.3),
    ],
  },
  {
    id: "firebase",
    name: "Firebase",
    kind: "platform",
    iconSlug: "firebase",
    matchers: [
      m.dep("npm", "firebase", 0.6),
      m.dep("pub", /^(firebase_core|cloud_firestore)$/, 0.7),
      m.file("firebase.json", 0.3),
    ],
  },

  // ─── Infraestructura y calidad ─────────────────────────────────────────────
  {
    id: "docker",
    name: "Docker",
    kind: "platform",
    iconSlug: "docker",
    matchers: [
      m.anyFile(["Dockerfile", "docker-compose.yml", "compose.yaml"], 0.9),
      m.file(".dockerignore", 0.1),
    ],
  },
  {
    id: "kubernetes",
    name: "Kubernetes",
    kind: "platform",
    iconSlug: "kubernetes",
    matchers: [m.dir("k8s", 0.5), m.anyFile(["kustomization.yaml", "helm/Chart.yaml"], 0.5)],
  },
  {
    id: "vercel",
    name: "Vercel",
    kind: "platform",
    iconSlug: "vercel",
    matchers: [m.file("vercel.json", 0.8), m.dep("npm", "@vercel/analytics", 0.2)],
  },
  {
    id: "netlify",
    name: "Netlify",
    kind: "platform",
    iconSlug: "netlify",
    matchers: [m.file("netlify.toml", 0.9)],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers",
    kind: "platform",
    iconSlug: "cloudflare",
    matchers: [m.anyFile(["wrangler.toml", "wrangler.jsonc", "wrangler.json"], 0.9)],
  },
  {
    id: "github-actions",
    name: "GitHub Actions",
    kind: "tool",
    iconSlug: "githubactions",
    matchers: [m.glob(/^\.github\/workflows\/.+\.ya?ml$/, 0.95)],
  },
  {
    id: "vitest",
    name: "Vitest",
    kind: "tool",
    iconSlug: "vitest",
    matchers: [m.dep("npm", "vitest", 0.9)],
  },
  {
    id: "jest",
    name: "Jest",
    kind: "tool",
    iconSlug: "jest",
    matchers: [m.dep("npm", "jest", 0.9)],
  },
  {
    id: "playwright",
    name: "Playwright",
    kind: "tool",
    iconSlug: "playwright",
    matchers: [m.dep("npm", /^@playwright\/test$/, 0.95)],
  },
  {
    id: "eslint",
    name: "ESLint",
    kind: "tool",
    iconSlug: "eslint",
    matchers: [m.dep("npm", "eslint", 0.8), m.glob(/^eslint\.config\./, 0.2)],
  },
  {
    id: "biome",
    name: "Biome",
    kind: "tool",
    iconSlug: "biome",
    matchers: [m.anyFile(["biome.json", "biome.jsonc"], 0.9)],
  },
  {
    id: "turborepo",
    name: "Turborepo",
    kind: "tool",
    iconSlug: "turborepo",
    matchers: [m.file("turbo.json", 0.9)],
  },
  {
    id: "pnpm",
    name: "pnpm",
    kind: "package-manager",
    iconSlug: "pnpm",
    matchers: [m.anyFile(["pnpm-lock.yaml", "pnpm-workspace.yaml"], 0.95)],
  },
  {
    id: "stripe",
    name: "Stripe",
    kind: "tool",
    iconSlug: "stripe",
    matchers: [
      m.dep("npm", "stripe", 0.85),
      m.dep("pypi", "stripe", 0.85),
      m.dep("pub", "flutter_stripe", 0.85),
      m.dep("rubygems", "stripe", 0.85),
      m.dep("packagist", "stripe/stripe-php", 0.85),
      m.dep("go", /github\.com\/stripe\/stripe-go/, 0.85),
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    kind: "tool",
    iconSlug: "sentry",
    matchers: [
      m.dep("npm", /^@sentry\//, 0.9),
      m.dep("pub", "sentry_flutter", 0.9),
      m.dep("pypi", "sentry-sdk", 0.9),
      m.dep("rubygems", /^sentry-(ruby|rails)$/, 0.9),
      m.dep("go", /getsentry\/sentry-go/, 0.9),
    ],
  },
  {
    id: "mcp",
    name: "MCP",
    kind: "tool",
    iconSlug: "anthropic",
    matchers: [m.dep("npm", "@modelcontextprotocol/sdk", 0.95), m.dep("pypi", "mcp", 0.8)],
  },

  // ─── Modelos ───────────────────────────────────────────────────────────────
  /*
    They are detected by the declared dependency and not by the project name.
    The catalog had an 'AI' filter that never found anything: it searched for 'openai' in the name
    and in the list of technologies, and it never appears there because there was no rule to
    detect it. A filter that always comes up empty is worse than not having one: it reads as 'I
    don't have projects of this,' and that was a lie.
   */
  {
    id: "openai",
    name: "OpenAI",
    kind: "model",
    iconSlug: "openai",
    matchers: [
      m.dep("npm", "openai", 0.95),
      m.dep("pypi", "openai", 0.95),
      m.dep("pub", "dart_openai", 0.9),
      m.dep("rubygems", "ruby-openai", 0.9),
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "model",
    iconSlug: "anthropic",
    matchers: [
      m.dep("npm", /^@anthropic-ai\//, 0.95),
      m.dep("pypi", "anthropic", 0.95),
      m.dep("pub", "anthropic_sdk_dart", 0.9),
    ],
  },
  {
    id: "google-ai",
    name: "Google AI",
    kind: "model",
    iconSlug: "googlegemini",
    matchers: [
      m.dep("npm", /^@google\/(genai|generative-ai)$/, 0.95),
      m.dep("pypi", /^google-(genai|generativeai)$/, 0.95),
      m.dep("pub", "google_generative_ai", 0.9),
    ],
  },
  {
    id: "langchain",
    name: "LangChain",
    kind: "model",
    iconSlug: "langchain",
    matchers: [
      m.dep("npm", /^(langchain|@langchain\/)/, 0.95),
      m.dep("pypi", /^langchain([-_]|$)/, 0.95),
    ],
  },
  {
    id: "vercel-ai",
    name: "Vercel AI SDK",
    kind: "model",
    iconSlug: "vercel",
    matchers: [m.dep("npm", "ai", 0.9), m.dep("npm", /^@ai-sdk\//, 0.95)],
  },
  {
    id: "ollama",
    name: "Ollama",
    kind: "model",
    iconSlug: "ollama",
    matchers: [m.dep("npm", "ollama", 0.95), m.dep("pypi", "ollama", 0.95)],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    kind: "model",
    iconSlug: "huggingface",
    matchers: [
      m.dep("npm", /^@huggingface\//, 0.95),
      m.dep("pypi", /^(transformers|huggingface-hub)$/, 0.9),
    ],
  },
];
