import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { rotateAgentKey } from "@panoma/db";
import {
  MCP_FILE_MODE,
  McpMergeError,
  McpTomlError,
  mcpSnippet,
  mcpTarget,
  mergeMcp,
  mergeMcpToml,
  trackedByGit,
} from "@panoma/core";
import { db } from "@/lib/db";
import { isLocalServer } from "@/lib/agent-auth";
import { isEphemeral } from "@/lib/cli-name";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { mcpEntry, mcpServerPath, preferredNode } from "@/lib/mcp-entry";

/**
 * Connect an agent to the catalog from the web, without going through the terminal.
 *
 * Until now this only existed as `panoma agent-key <nombre> --install`, and it had a bug that this
 * path fixes at its root: **it always wrote `.mcp.json` **, which is Claude Code's file, no matter
 * which agent you said. With Codex it wrote something that Codex doesn't read and replied «✓ MCP
 * configuration written» — a success announced for doing nothing.
 *
 * Here the destination is decided by agent (`lib/mcp-targets.ts`) and there are three possible
 * answers, which is one more than there used to be: it is written, it is taught, or it is said
 * that we do not know where it goes. None of the three lies.
 *
 * **By the way, the key stops being visible.** The CLI prints it once and it stays in your
 * terminal's scrollback; written directly in the agent's file, nobody sees it. When the
 * destination is 'to show,' it does travel to the browser, because it goes inside the snippet that
 * needs to be pasted — there's no way to paste it without seeing it.
 *
 * Two guards, the same as `/api/agent/keys`: `sameOrigin` so that the tab next to it doesn't shoot
 * it, and `isLocalServer` because this writes on **this** disk and from another machine it doesn't
 * mean anything.
 */
export async function POST(request: Request) {
  /*
    `localOperatorOnly` and not just `isLocalServer`, who wasn't defending anything here.
    `isLocalServer` look at the hostname of **the URL of the server**, which is the address to
    which Next was bound. With `panoma up --network` that is `0.0.0.0`, so the function returned
    `true` to everyone: it was a no-op exactly in the mode where it was needed. Measured on
    25-Aug-2026 from another machine on the wifi, with only the network key, the one that goes in
    the mobile link:
    POST /api/check -> 403 «…that needs its operator key.» POST /api/agent/keys -> 200
    {"apiKey":"panoma_w8AL0f…"}
    With that agent key, you enter all `/api/agent/*`, it is written in the owner's
    `~/.claude.json` and their keys are revoked. Issuing a durable credential is to send, not to
    look, so it goes with the other eleven.
    `isLocalServer` stays, and responds with its own: if Panoma is deployed on the internet, this
    has to go through a user's session and not through a machine key.
   */
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (!isLocalServer(request)) {
    return Response.json({ error: t(locale, "agentMcp.localOnly") }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    agent?: string;
    name?: string;
  };
  if (!body.agent || !body.name) {
    return Response.json({ error: t(locale, "agentMcp.missingInput") }, { status: 400 });
  }

  /*
    Under npx, nothing is written and no key is issued.

    `panoma hooks` already refuses this, and its comment gives the reason in words that fit here
    unchanged: writing a file that points at a copy npx is about to release is the one failure the
    command must not have, because the silence would be total. The MCP is the same shape — the
    entry below names the server by its path on disk, and under npx that path lives inside a cache
    npm clears when it likes — with one difference that makes it worse: an agent whose MCP server
    fails to start comes up **without the tools and without an error**, so the day it breaks
    nothing on any screen says so.

    It refuses ahead of `rotateAgentKey` and not after. Issuing the key and then declining leaves a
    row in `agents` that no agent will ever use, and that row is exactly what the bridge counts as
    a connected agent — the false 'connected' this release exists to stop telling.
   */
  if (isEphemeral()) {
    return Response.json(
      { error: t(locale, "agentMcp.ephemeral"), how: t(locale, "agentMcp.ephemeralHow") },
      { status: 409 },
    );
  }

  const server = await mcpServerPath();
  if (!server) {
    return Response.json({ error: t(locale, "agentMcp.noServer") }, { status: 500 });
  }

  const target = mcpTarget(body.agent);

  /*
    The key is issued before knowing whether it will be written, because the fragment that is
    shown also contains it; the reverse order would require issuing it twice.
    `rotateAgentKey` and not `createAgent`: pressing «Connect» twice must leave **one** Cursor
    token, not two. The existing one is updated while keeping its `id`, and with it its history —
    sessions and activity cascade from the agent.
   */
  const { db: database } = await db();
  const agent = await rotateAgentKey(database, { name: body.name, kind: body.agent });

  /*
    The address that ends inside the `.mcp.json`, and why it is not the link's.
    `request.url` brings the hostname to which Next was bound. With `--network` that is `0.0.0.0`,
    which means "all my addresses" and is not any that can be called: an agent with
    `http://0.0.0.0:4173` in its configuration doesn't reach anywhere. And this file is written on
    this machine for an agent running on this machine, so the correct address is always the local
    loopback, no matter which server it was bound to.
   */
  const bound = new URL(request.url);
  const api =
    bound.hostname === "0.0.0.0"
      ? `http://localhost${bound.port ? `:${bound.port}` : ""}`
      : bound.origin;
  const entry = mcpEntry(api, agent.apiKey, server, await preferredNode());

  if (target.kind !== "write" || !target.file) {
    return Response.json({
      ok: true,
      wrote: false,
      file: target.file ?? null,
      format: target.format ?? "json",
      snippet: mcpSnippet(entry, target.format ?? "json"),
      agentId: agent.id,
    });
  }

  /*
    The Codex TOML is written by adding our table at the end —the only operation that cannot break
    what is already there; the full reason is in `mergeMcpToml` —. If the file doesn't parse, or
    Panoma has already been manually written in another way, it is not touched: the fragment is
    returned with its reason, which is exactly what the broken JSON below does.
   */
  if (target.format === "toml") {
    const raw = await readFile(target.file, "utf8").catch(() => undefined);
    try {
      const fusion = mergeMcpToml(raw, entry);
      const scratch = `${target.file}.panoma-tmp`;
      await writeFile(scratch, fusion.result, { encoding: "utf8", mode: MCP_FILE_MODE });
      await rename(scratch, target.file);
      await chmod(target.file, MCP_FILE_MODE).catch(() => undefined);
      return Response.json({
        ok: true,
        wrote: true,
        file: target.file,
        replaced: fusion.replaced,
        coexists: fusion.coexists,
        exposedToGit: await trackedByGit(target.file),
        agentId: agent.id,
      });
    } catch (error) {
      if (error instanceof McpTomlError) {
        return Response.json({
          ok: true,
          wrote: false,
          file: target.file,
          format: "toml",
          snippet: mcpSnippet(entry, "toml"),
          reason: t(
            locale,
            error.reason === "manual" ? "agentMcp.tomlManual" : "agentMcp.badToml",
            { path: target.file },
          ),
          agentId: agent.id,
        });
      }
      throw error;
    }
  }

  let existing: unknown;
  const raw = await readFile(target.file, "utf8").catch(() => undefined);
  if (raw !== undefined) {
    try {
      existing = JSON.parse(raw);
    } catch {
      /*
        Overwriting a JSON with a syntax error deletes the work of the person who was fixing it.
        It stops and returns the fragment, which is the actionable part.
       */
      return Response.json({
        ok: true,
        wrote: false,
        file: target.file,
        format: "json",
        snippet: mcpSnippet(entry, "json"),
        reason: t(locale, "agentMcp.badJson", { path: target.file }),
        agentId: agent.id,
      });
    }
  }

  let fusion;
  try {
    fusion = mergeMcp(existing, entry);
  } catch (error) {
    if (error instanceof McpMergeError) {
      return Response.json({
        ok: true,
        wrote: false,
        file: target.file,
        format: "json",
        snippet: mcpSnippet(entry, "json"),
        reason: t(locale, "agentMcp.notAnObject", { path: target.file }),
        agentId: agent.id,
      });
    }
    throw error;
  }

  /*
    It is written separately and renamed on top, which in the same file system is atomic.
    It's not a ceremony: the `~/.claude.json` of this machine weighs 162 KB and Claude Code also
    writes it while working. A direct `writeFile` that gets cut in half—the process dies, the disk
    fills up—leaves someone's configuration truncated, and inside there is much more than MCP
    servers. With the renaming, either the previous one is there or the new one is.
   */
  const scratch = `${target.file}.panoma-tmp`;
  /*
    With the mode from the first byte, and a `chmod` behind.
    Inside goes `PANOMA_KEY` in clear text, which opens the report, the logbook, and the tasks of
    the eighty projects. The temporary file is as important as the destination: it is created with
    the key inside, in a predictable path and next to the original, so if it comes out with 0644
    there is a window —short, but real— in which any other account on the machine can read it. The
    renaming passes its mode to the destination; `chmod` is for files that already existed, where
    `mode` of `writeFile` does not apply.
    Watch out for the signature: the mode goes in the options object. As a fourth argument after
    `"utf8"` it compiles, runs, and **does nothing** — it is silently discarded.
   */
  await writeFile(scratch, `${JSON.stringify(fusion.result, null, 2)}\n`, {
    encoding: "utf8",
    mode: MCP_FILE_MODE,
  });
  await rename(scratch, target.file);
  await chmod(target.file, MCP_FILE_MODE).catch(() => undefined);

  return Response.json({
    ok: true,
    wrote: true,
    file: target.file,
    replaced: fusion.replaced,
    /* Naming what was already there is the only way to show that it is still there. */
    coexists: fusion.coexists,
    /* And if git were to take it, with the key inside, say it while being looked at. */
    exposedToGit: await trackedByGit(target.file),
    agentId: agent.id,
  });
}
