import { gzipSync } from "node:zlib";
import type { AppManifest } from "./manifest";

/** Shared test data; this module is neither exported nor included by the package build. */
export function fixtureManifest(): AppManifest {
  const label = { en: "Example", es: "Ejemplo" };
  return {
    id: "panoma-video", protocol: "1", entry: { mcp: "dist/mcp.js" }, displayName: label, summary: label,
    requirements: [{ id: "browser", kind: "playwright-browser", browser: "chromium", approxMB: 550, termsUrl: "https://www.google.com/chrome/terms/", note: label }, { id: "ffmpeg", kind: "executable", names: ["ffmpeg", "ffprobe"], minVersion: "6.0", install: label }],
    providers: [{ id: "brain", kind: "text-model", default: "none", sends: label }, { id: "voice", kind: "elevenlabs", default: "off", sends: label, env: "ELEVENLABS_API_KEY" }],
    storage: { home: "PANOMA_VIDEO_HOME", browsers: "PLAYWRIGHT_BROWSERS_PATH" },
    actions: [{ id: "create-video", tool: "panoma_video_auto", surface: "project", label }],
    legal: { license: "LICENSE", notices: "NOTICE.md", codecs: "docs/codecs.md" },
  };
}

/** Minimal ustar writer: test npm itself without requiring tar or a registry daemon. */
export function fixtureTarball(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(`package/${name}`, 0, 100);
    for (const [offset, length, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, data.length], [136, 12, 0]] as const) {
      header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length);
    }
    header.fill(32, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
