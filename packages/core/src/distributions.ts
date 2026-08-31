import type { DetectedDistribution, DetectedTechnology, FileIndex } from "./types";
import type { PackageJson } from "./ecosystems/npm";
import type { Pubspec } from "./ecosystems/pub";

/**
 * Deduce where the project lives (or can live): web, app stores, npm, Docker.
 *
 * Watch out for semantics: this detects **configured distribution targets**, not confirmed
 * deployments. A `vercel.json` says "this is deployed on Vercel," not "this is live right now."
 * The confirmation of actual URLs comes in Phase 2.
 */
export function detectDistributions(
  index: FileIndex,
  technologies: DetectedTechnology[],
  packageJson: PackageJson | undefined,
  pubspec: Pubspec | undefined,
): DetectedDistribution[] {
  const distributions: DetectedDistribution[] = [];
  const has = (id: string) => technologies.some((t) => t.id === id);

  if (has("vercel")) {
    distributions.push({ kind: "web", label: "Vercel", evidence: "vercel.json" });
  }
  if (has("netlify")) {
    distributions.push({ kind: "web", label: "Netlify", evidence: "netlify.toml" });
  }
  if (has("cloudflare")) {
    distributions.push({ kind: "web", label: "Cloudflare Workers", evidence: "wrangler config" });
  }
  if (
    distributions.length === 0 &&
    (has("nextjs") || has("vite") || has("astro") || has("nuxt") || has("sveltekit"))
  ) {
    distributions.push({ kind: "web", label: "Web", evidence: "framework web detectado" });
  }

  if (index.dirSet.has("ios") || index.files.some((p) => /\.xcodeproj\//.test(p))) {
    distributions.push({ kind: "app_store", label: "iOS / App Store", evidence: "proyecto Xcode" });
  }
  if (index.dirSet.has("android/app")) {
    distributions.push({
      kind: "play_store",
      label: "Android / Play Store",
      evidence: "android/app",
    });
  }

  if (packageJson?.name && packageJson.private !== true) {
    distributions.push({
      kind: packageJson.bin ? "cli" : "npm",
      label: packageJson.bin ? `CLI (${packageJson.name})` : `npm: ${packageJson.name}`,
      evidence: "package.json sin private:true",
      url: `https://www.npmjs.com/package/${packageJson.name}`,
    });
  }

  if (has("docker")) {
    distributions.push({ kind: "docker", label: "Contenedor Docker", evidence: "Dockerfile" });
  }
  if (has("tauri") || has("electron")) {
    distributions.push({
      kind: "desktop",
      label: "Escritorio",
      evidence: has("tauri") ? "src-tauri" : "electron",
    });
  }

  const homepage = packageJson?.homepage ?? pubspec?.homepage;
  if (homepage && /^https?:\/\//.test(homepage)) {
    const existing = distributions.find((d) => d.kind === "web");
    if (existing) existing.url = homepage;
    else
      distributions.push({
        kind: "web",
        label: "Web",
        evidence: "homepage del manifiesto",
        url: homepage,
      });
  }

  return distributions;
}
