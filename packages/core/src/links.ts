import type { FileIndex, GitInfo, ProjectLink } from "./types";
import { readJsonAt, readTextAt, readTomlAt, getPath } from "./fs-utils";

/**
 * Links to the panel of each service that the project actually uses.
 *
 * The difference between this and a list of logos is the **identifier**: knowing that a project
 * uses Firebase is useless; knowing that it uses the `rentasos-prod` project and being able to
 * open it with one click is what saves the thirty seconds of "which of the nine Firebase projects
 * was this?" that are spent every time.
 *
 * That's why each link declares its `kind`:
 *
 * - `deep` — takes you to the specific project because we found its identifier on the disk.
 * - `console` — only to the service panel, because the identifier is not present or does not
 * belong to any URL. It is marked as such instead of disguising it as a direct link.
 *
 * **About the `.env` files:** they are read to extract identifiers (the Supabase reference, the
 * Sentry project number, whether the Stripe key is test or live), never to store values. No secret
 * enters the catalog — only the data that is already transmitted in a public URL or the prefix
 * that distinguishes test from production.
 */

/** Environment files that are looked at, in order of preference. */
const ENV_FILES = [".env", ".env.local", ".env.development", ".env.production", ".env.example"];

/**
 * Read a path **without consulting the file index**.
 *
 * This is not a shortcut, it is mandatory: the index respects `.gitignore` and skips `.vercel/`
 * and `.netlify/` by design, and those are exactly the files that store the identifiers
 * (`.env` is ignored in all projects that take secrets seriously). If
 * These resolvers, when asked to the index, would find exactly zero links in the best-configured
 * projects. There are four failed `open()` at the root: free.
 */
async function readIgnored(root: string, path: string): Promise<string | undefined> {
  return readTextAt(root, path);
}

interface Context {
  root: string;
  index: FileIndex;
  git?: GitInfo;
  /** Concatenated content of the `.env` found. It is loaded only once. */
  env: string;
}

type Resolver = (context: Context) => Promise<ProjectLink | ProjectLink[] | undefined>;

export async function resolveLinks(
  root: string,
  index: FileIndex,
  git?: GitInfo,
): Promise<ProjectLink[]> {
  const env = await readEnvFiles(root);
  const context: Context = { root, index, git, env };

  const results = await Promise.all(RESOLVERS.map((resolve) => resolve(context).catch(() => undefined)));

  const links: ProjectLink[] = [];
  const seen = new Set<string>();
  for (const result of results.flat()) {
    if (!result || seen.has(result.id)) continue;
    seen.add(result.id);
    links.push(result);
  }

  // Direct links first: they are the ones that really save time.
  return links.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "deep" ? -1 : 1));
}

async function readEnvFiles(root: string): Promise<string> {
  const contents = await Promise.all(ENV_FILES.map((name) => readIgnored(root, name)));
  return contents.filter(Boolean).join("\n");
}

/** First match of the first pattern that matches. */
function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

// ── Resolvers ────────────────────────────────────────────────────────────── One per service. Each
// decides alone if it has something to say; returning undefined is normal and not an error.

const firebase: Resolver = async ({ root, index }) => {
  let projectId: string | undefined;
  let evidence = "";

  // `.firebaserc` is the most reliable source: it is written by Firebase's own CLI.
  const firebaserc = await readJsonAt<{ projects?: Record<string, string> }>(root, ".firebaserc");
  const fromRc = firebaserc?.projects?.default ?? Object.values(firebaserc?.projects ?? {})[0];
  if (fromRc) {
    projectId = fromRc;
    evidence = "projects.default en .firebaserc";
  }

  if (!projectId) {
    // `google-services.json` carries keys from API, so many projects ignore it in git: to the index
    // paths, you have to add the canonical ones read plainly.
    const candidates = [
      ...index.files.filter((path) => path.endsWith("google-services.json")),
      "android/app/google-services.json",
    ];
    for (const candidate of candidates) {
      const parsed = await readJsonAt(root, candidate);
      const id = getPath(parsed, "project_info.project_id");
      if (typeof id === "string") {
        projectId = id;
        evidence = `project_info.project_id en ${candidate}`;
        break;
      }
    }
  }

  if (!projectId) {
    // Flutter generates `firebase_options.dart` with the id embedded in the code.
    const candidates = [
      index.files.find((path) => path.endsWith("firebase_options.dart")),
      index.files.find((path) => path.endsWith("GoogleService-Info.plist")),
      "lib/firebase_options.dart",
      "ios/Runner/GoogleService-Info.plist",
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      const text = await readTextAt(root, candidate);
      if (!text) continue;
      const id = firstMatch(text, [
        /projectId:\s*['"]([^'"]+)['"]/,
        /<key>PROJECT_ID<\/key>\s*<string>([^<]+)<\/string>/,
      ]);
      if (id) {
        projectId = id;
        evidence = `PROJECT_ID en ${candidate}`;
        break;
      }
    }
  }

  if (!projectId) return undefined;

  // Every Firebase project is also a Google Cloud project, and half of the things one is going to
  // look for (billing, quotas, logs) are only in the GCP console.
  return [
    {
      id: "firebase",
      service: "Firebase",
      label: projectId,
      url: `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/overview`,
      kind: "deep",
      evidence,
      iconSlug: "firebase",
    },
    {
      id: "gcp",
      service: "Google Cloud",
      label: projectId,
      url: `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(projectId)}`,
      kind: "deep",
      evidence: `mismo proyecto que Firebase (${evidence})`,
      iconSlug: "googlecloud",
    },
  ];
};

const supabase: Resolver = async ({ root, env }) => {
  // The project reference is the public URL subdomain: it is not a secret.
  let ref = firstMatch(env, [/https?:\/\/([a-z0-9]{20})\.supabase\.co/i]);
  let evidence = "SUPABASE_URL en el fichero de entorno";

  if (!ref) {
    const config = await readTomlAt<{ project_id?: string }>(root, "supabase/config.toml");
    if (config?.project_id) {
      ref = config.project_id;
      evidence = "project_id en supabase/config.toml";
    }
  }

  if (!ref) return undefined;
  return {
    id: "supabase",
    service: "Supabase",
    label: ref,
    url: `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}`,
    kind: "deep",
    evidence,
    iconSlug: "supabase",
  };
};

/** Remote repository: GitHub, GitLab, or Bitbucket, depending on the host. */
const repository: Resolver = async ({ git }) => {
  const remote = git?.remoteUrl;
  if (!remote) return undefined;

  // `git@github.com:user/repo.git` and `https://github.com/user/repo.git` → same place.
  const match = /(?:@|\/\/)([^/:]+)[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote.trim());
  if (!match) return undefined;

  const [, host, path] = match as unknown as [string, string, string];
  const known: Record<string, { service: string; iconSlug: string }> = {
    "github.com": { service: "GitHub", iconSlug: "github" },
    "gitlab.com": { service: "GitLab", iconSlug: "gitlab" },
    "bitbucket.org": { service: "Bitbucket", iconSlug: "bitbucket" },
  };
  const meta = known[host.toLowerCase()];
  if (!meta) return undefined;

  return {
    id: "repository",
    service: meta.service,
    label: path,
    url: `https://${host}/${path}`,
    kind: "deep",
    evidence: "remoto de git",
    iconSlug: meta.iconSlug,
  };
};

const playStore: Resolver = async ({ root, index }) => {
  const gradle = ["android/app/build.gradle.kts", "android/app/build.gradle", "build.gradle"].find(
    (path) => index.fileSet.has(path),
  );
  if (!gradle) return undefined;

  const text = await readTextAt(root, gradle);
  if (!text) return undefined;

  const appId = firstMatch(text, [
    /applicationId\s*=\s*["']([\w.]+)["']/,
    /applicationId\s+["']([\w.]+)["']/,
  ]);
  if (!appId) return undefined;

  // Linking to the page of an app that was never published is worse than not linking: the user
  // clicks and encounters a 404. And saying it has its own value — that the identifier is still the
  // template's means that app never reached any store.
  if (isTemplateId(appId)) {
    return {
      id: "play-store",
      service: "Google Play",
      label: `${appId} · sin publicar`,
      url: "https://play.google.com/console",
      kind: "console",
      evidence: `applicationId sigue siendo el de la plantilla en ${gradle}`,
      iconSlug: "googleplay",
    };
  }

  // This is the link that is most appreciated: it does not lead to the console but to the public
  // profile, which is where one checks if the app is still active and what version they see
  // externally.
  return {
    id: "play-store",
    service: "Google Play",
    label: appId,
    url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`,
    kind: "deep",
    evidence: `applicationId en ${gradle}`,
    iconSlug: "googleplay",
  };
};

/** `com.example.*` is what `flutter create` and the Android Studio templates leave behind. */
function isTemplateId(id: string): boolean {
  return /^com\.example\./.test(id) || /^com\.yourcompany\./.test(id);
}

const appStore: Resolver = async ({ root, index }) => {
  const pbxproj = index.files.find((path) => path.endsWith("project.pbxproj"));
  if (!pbxproj) return undefined;

  const text = await readTextAt(root, pbxproj);
  if (!text) return undefined;

  // A .pbxproj declares a PRODUCT_BUNDLE_IDENTIFIER per target, and the test ones come before the
  // app one. Taking the first one returns `…RunnerTests`, which is not the app.
  const all = [...text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([\w.]+)"?;/g)]
    .map((match) => match[1]!)
    .filter((id) => !id.includes("$") && !/(UI)?Tests$/i.test(id));
  const bundleId = all[0];
  // Without the numeric identifier that Apple assigns, there is no URL of the record, and the
  // bundle id is not useful for building it. Link to the console and the data as a label.
  if (!bundleId) return undefined;

  const template = isTemplateId(bundleId);
  return {
    id: "app-store",
    service: "App Store Connect",
    label: template ? `${bundleId} · sin publicar` : bundleId,
    url: "https://appstoreconnect.apple.com/apps",
    kind: "console",
    evidence: template
      ? `PRODUCT_BUNDLE_IDENTIFIER sigue siendo el de la plantilla en ${pbxproj}`
      : `PRODUCT_BUNDLE_IDENTIFIER en ${pbxproj}`,
    iconSlug: "appstore",
  };
};

const expo: Resolver = async ({ root, index }) => {
  if (!index.fileSet.has("app.json")) return undefined;
  const app = await readJsonAt<{ expo?: { slug?: string; owner?: string } }>(root, "app.json");
  const slug = app?.expo?.slug;
  const owner = app?.expo?.owner;
  if (!slug) return undefined;

  return owner
    ? {
        id: "expo",
        service: "Expo",
        label: `${owner}/${slug}`,
        url: `https://expo.dev/accounts/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}`,
        kind: "deep",
        evidence: "expo.owner y expo.slug en app.json",
        iconSlug: "expo",
      }
    : {
        id: "expo",
        service: "Expo",
        label: slug,
        url: "https://expo.dev/accounts",
        kind: "console",
        evidence: "expo.slug en app.json, sin owner declarado",
        iconSlug: "expo",
      };
};

const vercel: Resolver = async ({ root }) => {
  // `.vercel/` is in SKIP_DIRS, so it never appears in the index: it is read plainly.
  const text = await readIgnored(root, ".vercel/project.json");
  if (!text) return undefined;
  let project: { projectId?: string; projectName?: string };
  try {
    project = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!project.projectId) return undefined;

  // Vercel identifies projects by `prj_...` but their URLs are `/<equipo>/<name>`, and the team is
  // not in any local file. With the ID alone, it cannot be linked.
  return {
    id: "vercel",
    service: "Vercel",
    label: project.projectName ?? project.projectId,
    url: "https://vercel.com/dashboard",
    kind: "console",
    evidence: "projectId en .vercel/project.json",
    iconSlug: "vercel",
  };
};

const cloudflare: Resolver = async ({ root, index }) => {
  const config = ["wrangler.toml", "wrangler.jsonc", "wrangler.json"].find((path) =>
    index.fileSet.has(path),
  );
  if (!config) return undefined;

  const text = await readTextAt(root, config);
  if (!text) return undefined;
  const accountId = firstMatch(text, [/account_id\s*[=:]\s*["']([0-9a-f]{32})["']/i]);

  return accountId
    ? {
        id: "cloudflare",
        service: "Cloudflare",
        label: accountId.slice(0, 8),
        url: `https://dash.cloudflare.com/${accountId}`,
        kind: "deep",
        evidence: `account_id en ${config}`,
        iconSlug: "cloudflare",
      }
    : {
        id: "cloudflare",
        service: "Cloudflare",
        label: "panel",
        url: "https://dash.cloudflare.com",
        kind: "console",
        evidence: `${config} sin account_id`,
        iconSlug: "cloudflare",
      };
};

const sentry: Resolver = async ({ env }) => {
  // A DSN has the form https://<clave>@o<org>.ingest.<región>.sentry.io/<proyecto>.. From there, we
  // only keep the project number: the key is not touched.
  const projectId = firstMatch(env, [/@o\d+\.ingest\.[\w.]*sentry\.io\/(\d+)/i]);
  if (!projectId) return undefined;

  return {
    id: "sentry",
    service: "Sentry",
    label: `proyecto ${projectId}`,
    url: `https://sentry.io/issues/?project=${projectId}`,
    kind: "deep",
    evidence: "número de proyecto del DSN (la clave no se guarda)",
    iconSlug: "sentry",
  };
};

const stripe: Resolver = async ({ env }) => {
  // Only the prefix. Distinguishing test from production is exactly what one wants to know before
  // opening the panel, and it does not require looking at a single character of the secret.
  const test = /\b[ps]k_test_/.test(env);
  const live = /\b[ps]k_live_/.test(env);
  if (!test && !live) return undefined;

  return {
    id: "stripe",
    service: "Stripe",
    label: live ? "producción" : "modo prueba",
    url: live ? "https://dashboard.stripe.com/dashboard" : "https://dashboard.stripe.com/test/dashboard",
    kind: "console",
    evidence: `clave ${live ? "sk_live_" : "sk_test_"} en el fichero de entorno`,
    iconSlug: "stripe",
  };
};

const RESOLVERS: Resolver[] = [
  repository,
  firebase,
  supabase,
  playStore,
  appStore,
  expo,
  vercel,
  cloudflare,
  sentry,
  stripe,
];
