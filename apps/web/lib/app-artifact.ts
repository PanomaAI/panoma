import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, basename } from "node:path";
import { Readable } from "node:stream";
import { insideDir } from "@panoma/apps";
import { AppFault } from "@panoma/apps/faults";

export function appResultHasPath(result: unknown, path: string): boolean {
  if (typeof result === "string") return result === path;
  if (Array.isArray(result)) return result.some(value => appResultHasPath(value, path));
  return !!result && typeof result === "object" &&
    Object.values(result).some(value => appResultHasPath(value, path));
}
export function byteRange(value: string | null, size: number): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new AppFault("invalid-range");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw new AppFault("invalid-range");
  return { start, end };
}
export async function serveAppFile(request: Request, root: string, path: string): Promise<Response> {
  if (!(await insideDir(root, path))) return Response.json({ error: "artifact-not-found" }, { status: 404 });
  const physical = await realpath(path);
  const info = await stat(physical);
  if (!info.isFile()) return Response.json({ error: "artifact-not-found" }, { status: 404 });
  const type = ({
    ".mp4": "video/mp4", ".webm": "video/webm", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".json": "application/json", ".vtt": "text/vtt", ".srt": "text/plain",
    ".md": "text/plain", ".txt": "text/plain", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  } as Record<string, string>)[extname(physical).toLowerCase()] ?? "application/octet-stream";
  let range: ReturnType<typeof byteRange>;
  try { range = byteRange(request.headers.get("range"), info.size); }
  catch { return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + info.size } }); }
  const stream = createReadStream(physical, range);
  const abort = () => stream.destroy();
  request.signal.addEventListener("abort", abort, { once: true });
  stream.once("close", () => request.signal.removeEventListener("abort", abort));
  if (request.signal.aborted) abort();
  const headers: Record<string, string> = {
    "Content-Type": type, "Content-Length": String(range ? range.end - range.start + 1 : info.size),
    "Accept-Ranges": "bytes", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": (type.startsWith("video/") || type.startsWith("image/") || type.startsWith("audio/") ? "inline" : "attachment") +
      "; filename*=UTF-8''" + encodeURIComponent(basename(physical)),
  };
  if (range) headers["Content-Range"] = "bytes " + range.start + "-" + range.end + "/" + info.size;
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
