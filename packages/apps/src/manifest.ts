import { z } from "zod";
import { AppFault } from "./faults";

const localized = z.object({ en: z.string().min(1).max(2_000), es: z.string().min(1).max(2_000) }).strict();
const slug = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80);
const relativeFile = z.string().max(200).refine((value) =>
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) &&
  !value.split("/").some((piece) => piece === "." || piece === ".."), "Expected a contained relative file path");
const requirement = z.discriminatedUnion("kind", [
  z.object({
    id: slug, kind: z.literal("playwright-browser"), browser: z.literal("chromium"),
    approxMB: z.number().int().positive().max(10_000),
    termsUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "HTTPS required"),
    note: localized,
  }).strict(),
  z.object({
    id: slug, kind: z.literal("executable"), names: z.array(z.enum(["ffmpeg", "ffprobe"])).min(1).max(2),
    minVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/), install: localized,
  }).strict(),
]);

/** The manifest is data. In particular, it cannot introduce shell commands or entry URLs. */
export const AppManifestSchema = z.object({
  id: slug,
  protocol: z.string().regex(/^\d+$/).max(8),
  entry: z.object({ mcp: relativeFile }).strict(),
  displayName: localized,
  summary: localized,
  requirements: z.array(requirement).max(10),
  providers: z.array(z.discriminatedUnion("kind", [
    z.object({ id: z.literal("brain"), kind: z.literal("text-model"), default: z.literal("none"), sends: localized }).strict(),
    z.object({ id: z.literal("voice"), kind: z.literal("elevenlabs"), default: z.literal("off"), sends: localized, env: z.literal("ELEVENLABS_API_KEY") }).strict(),
  ])).max(2),
  storage: z.object({ home: z.literal("PANOMA_VIDEO_HOME"), browsers: z.literal("PLAYWRIGHT_BROWSERS_PATH") }).strict(),
  actions: z.array(z.object({
    id: z.literal("create-video"), tool: z.literal("panoma_video_auto"), surface: z.literal("project"), label: localized,
  }).strict()).max(1),
  legal: z.object({ license: relativeFile, notices: relativeFile, codecs: relativeFile }).strict(),
}).strict().superRefine((manifest, context) => {
  for (const field of ["requirements", "providers", "actions"] as const) {
    const ids = manifest[field].map((item) => item.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: [field], message: "Duplicate ids" });
  }
});

export type AppManifest = z.infer<typeof AppManifestSchema>;

export function validateManifest(pkgJson: unknown): AppManifest {
  /*
    Zod's refusal is an array of issues, pretty-printed. It is the right thing for a developer
    reading a stack trace and the wrong thing on a screen, where it used to arrive verbatim in
    the same box a sentence goes in. What a person can act on is that the package is damaged.
   */
  try {
    return z.object({ panoma: z.object({ app: AppManifestSchema }).strict() }).parse(pkgJson).panoma.app;
  } catch (error) {
    if (error instanceof AppFault) throw error;
    throw new AppFault("broken-package-manifest");
  }
}

export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export function assertVersion(version: string): string {
  if (!VERSION_PATTERN.test(version) || version.length > 100) throw new AppFault("invalid-version");
  return version;
}
