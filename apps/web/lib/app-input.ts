import { TOOL_TIMEOUT_MS } from "@panoma/apps";
import { AppFault } from "@panoma/apps/faults";

export const MANAGER_TOOLS = [
  "install", "browser", "update", "rollback", "enable", "disable", "uninstall", "clean", "doctor", "check",
] as const;
export type AppOperation = typeof MANAGER_TOOLS[number];
export const VIDEO_FIELDS: Readonly<Record<string, readonly string[]>> = {
  panoma_video_auto: ["goal", "format", "new_story", "theme", "langs", "until", "force", "voice", "url", "brain", "music", "dance", "creative_brief"],
  panoma_video_render: ["brief_id", "theme", "hook", "lang", "format", "force", "voice", "brain"],
  panoma_video_review: ["render_id", "detail"],
  panoma_video_revise: ["brief_id", "expectedRevision", "edits", "instruction", "restoreRevision", "note", "brain"],
  panoma_video_story: ["brief_id"],
  panoma_video_scout: ["detail"],
};
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validateAppInput(tool: string, input: unknown): Record<string, unknown> {
  if (!VIDEO_FIELDS[tool] || !TOOL_TIMEOUT_MS[tool]) throw new AppFault("unknown-app-tool");
  if (!isRecord(input) || JSON.stringify(input).length > 64_000) throw new AppFault("invalid-app-input");
  if (Object.keys(input).some(key => !VIDEO_FIELDS[tool]!.includes(key))) throw new AppFault("unknown-app-input");
  if (input.url !== undefined) {
    // An address that will not parse is the same refusal as one that parses and points elsewhere.
    let url: URL;
    try { url = new URL(String(input.url)); }
    catch { throw new AppFault("local-url-required"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new AppFault("local-url-required");
  }
  for (const field of ["brief_id", "render_id", "hook"] as const) {
    if (input[field] !== undefined && (typeof input[field] !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,199}$/.test(input[field]))) throw new AppFault(`invalid-${field}`);
  }
  return input;
}
/** Application stage failures must not be disguised by an MCP envelope with isError=false. */
export function appResultFailure(result: Record<string, unknown>, tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === "panoma_video_review" && result.status === "fail") return "review-failed";
  if (isRecord(result.review) && result.review.status === "fail") return "review-failed";
  if (isRecord(result.stages)) {
    const failed = Object.entries(result.stages).find(([, value]) => isRecord(value) && value.status === "failed");
    if (failed) return "stage-failed: " + failed[0];
  }
  if (Array.isArray(result.renders)) {
    if (result.renders.some(row => isRecord(row) && isRecord(row.review) && row.review.status === "fail")) return "review-failed";
    if (tool === "panoma_video_auto" && input.until !== "plan" && !result.renders.length) return "no-supported-production";
  }
  return undefined;
}
