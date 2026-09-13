import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

it("packages the app manager and loads the packaged apps route before packing", () => {
  const pack = source("../scripts/pack-app.mjs");
  const check = source("../scripts/check-package.mjs");
  const next = source("../../web/next.config.ts");
  expect(pack).toContain('"node_modules/@panoma/apps/dist/index.js"');
  expect(check).toContain('"app/node_modules/@panoma/apps/dist/index.js"');
  expect(check).toContain('"api", "apps", "route.js"');
  expect(check).toContain("appManager, appsRoute");
  expect(check).toContain("await import(pathToFileURL(process.argv[2]).href)");
  expect(next).toMatch(/const PACKAGE_MANAGERS = \[[^\]]*"@panoma\/apps"/);
});

it("does not install the video engine or copy the SDK's entire HTTP transport into the host", () => {
  const manager = JSON.parse(source("../../../packages/apps/package.json")) as { dependencies: Record<string, string> };
  expect(manager.dependencies).not.toHaveProperty("@panoma/video");
  expect(manager.dependencies).not.toHaveProperty("@modelcontextprotocol/sdk");
  const pack = source("../scripts/pack-app.mjs");
  expect(pack).not.toMatch(/pending\.push\([^)]*@modelcontextprotocol\/sdk/);
  expect(pack).not.toMatch(/NOT_AT_RUNTIME[^;]*["']ajv["']/);
});
