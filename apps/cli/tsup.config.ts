import { defineConfig } from "tsup";

/**
 * The npm package travels alone.
 *
 * `@panoma/core` and `@panoma/ai` are workspace packages: they do not exist in the registry and
 * they are not going to exist — they are organs, not products. So the bundle swallows them whole
 * (`noExternal`), and in `dependencies` of manifest only the pieces that do remain
 * They live in npm: picocolors, ignore, smol-toml, yaml, and Anthropic's SDK.
 *
 * Inside the monorepo nothing changes: the website continues reading the core source code because
 * of the condition `panoma-src`, and this bundle only decides what `npx panoma` takes.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  clean: true,
  noExternal: [/^@panoma\//],
});
