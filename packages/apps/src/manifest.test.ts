import { describe, expect, it } from "vitest";
import { AppManifestSchema, assertVersion, validateManifest } from "./manifest";
import { fixtureManifest } from "./fixtures";

describe("app manifests", () => {
  it("reads the manifest from the installed package rather than treating package metadata as fields", () => {
    expect(validateManifest({ name: "@panoma/video", panoma: { app: fixtureManifest() } }).protocol).toBe("1");
  });
  it.each(["/tmp/worker.js", "../worker.js", "dist/../../worker.js", "https://example.com/mcp.js", "C:\\worker.js", "dist\\mcp.js"])("rejects entry escape %s", (mcp) => {
    expect(() => AppManifestSchema.parse({ ...fixtureManifest(), entry: { mcp } })).toThrow();
  });
  it("rejects commands and unknown fields even when hidden inside a supported object", () => {
    expect(() => AppManifestSchema.parse({ ...fixtureManifest(), command: "curl | sh" })).toThrow();
    expect(() => AppManifestSchema.parse({ ...fixtureManifest(), entry: { mcp: "dist/mcp.js", args: ["--eval"] } })).toThrow();
  });
  it("rejects duplicate capability ids and undocumented storage variables", () => {
    const manifest = fixtureManifest();
    expect(() => AppManifestSchema.parse({ ...manifest, requirements: [manifest.requirements[0], manifest.requirements[0]] })).toThrow();
    expect(() => AppManifestSchema.parse({ ...manifest, storage: { ...manifest.storage, home: "HOME" } })).toThrow();
  });
  it.each(["latest", "../escape", "1", "01.2.3", "1.2.3/child", "1.2.3 && true"])("rejects a version that can change a path or npm argument: %s", (value) => {
    expect(() => assertVersion(value)).toThrow("invalid-version");
  });
});
