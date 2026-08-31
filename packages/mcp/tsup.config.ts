import { defineConfig } from "tsup";

/**
 * The MCP server travels as a file, not as a tree.
 *
 * Same criterion as `apps/cli/tsup.config.ts` for the `@panoma/*`, and one more reason for the
 * SDK: `@modelcontextprotocol/sdk` declares **express, hono, cors, jose, ajv, eventsource and a
 * dozen more** as normal dependencies, because it brings all its transports in the same package.
 * We use only one —stdio— and the rest is HTTP server that never runs.
 *
 * Installing it entirely cost about 90 packages and 1,500 files inside `panoma`. It's not just
 * weight: it's supply chain surface for code that is never called, in a package whose job is to
 * talk to agents. Starting from `server/mcp.js` and `server/stdio.js`, the tree shake leaves out
 * the entire HTTP block.
 *
 * That is why SDK and `zod` are in `devDependencies` and not in `dependencies`: they are not
 * needed at runtime because they are already included. If another transport is used someday, this
 * will have to be reviewed — and `dist` will indicate it by suddenly growing.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  clean: true,
  noExternal: [/^@panoma\//, "@modelcontextprotocol/sdk", "zod"],
  /*
    Without this the server did not start. At all, for anybody, in every version published.

    `yaml` arrives through `@panoma/core`, is resolved as CommonJS, and gets bundled with esbuild's
    interop shim — which begins `typeof require !== "undefined" ? require : …` and, finding no
    `require` in an ES module, throws «Dynamic require of "process" is not supported» while the
    module is still being evaluated. Before a single line of ours runs. `shims` is the option that
    defines that `require`, built from `import.meta.url`.

    It went unseen because of the one property this file has been warning about from its first
    line: an MCP server that fails to start is silent. The agent comes up, its tool list is empty,
    and nothing anywhere says why — not in the agent, not in the catalog, not on any screen. It was
    found by running the published binary by hand while chasing a badge that would not turn green,
    and the badge was right: nothing had ever connected.

    `apps/cli` never had this. It carries no `format: esm` bundle of `yaml` on a path that node
    evaluates as a module — which is why the whole product worked and only this file was dead.

    Written by hand and not with tsup's `shims`, which was tried first and is for something else:
    it fills in `__dirname` and `__filename`, not the `require` an ES module does not have.
   */
  banner: {
    js: 'import { createRequire as __nodeRequire } from "node:module";\nconst require = __nodeRequire(import.meta.url);',
  },
});
