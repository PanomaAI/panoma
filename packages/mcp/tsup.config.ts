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
});
