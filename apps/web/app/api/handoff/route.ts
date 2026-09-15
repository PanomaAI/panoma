import { execFile } from "node:child_process";
import { resolveExecutable } from "@panoma/core";
import { promisify } from "node:util";
import { readConfig } from "@panoma/ai";
import { listProjectRoots, modelSpendToday } from "@panoma/db";
import {
  APP_OF,
  checkHandoff,
  digestConversation,
  fidelityOf,
  isAgentId,
  isTier,
  type AgentId,
  type Digest,
  type Surface,
  type Tier,
} from "@panoma/handoff";
import { HandoffFault } from "@panoma/handoff/faults";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { discoverCached, storeOptions } from "@/lib/handoff-cache";
import { digestRefusal, planDigest, writeDigestWithModel } from "@/lib/handoff-digest";
import { handoffHttpError } from "@/lib/handoff-http";
import {
  catalogCwds,
  checkId,
  discoverForCatalog,
  findConversation,
  isKeepTurns,
  openConversation,
  refuseSameStore,
  targetOf,
  writeHandoff,
  writtenBody,
} from "@/lib/handoff-write";
import { localeFrom, t } from "@/lib/i18n";
import { modelErrorParts } from "@/lib/model-errors";
import { agentsOf, installedApps } from "@/lib/open-targets";
import { capFor, FAMILY_KINDS } from "@/lib/spend-settings";

const run = promisify(execFile);

/**
 * The handoff: the conversations on this disk, and the one action that writes one into another
 * agent's history.
 *
 * `GET` lists what Claude Code, Codex, OpenCode and Gemini CLI kept on this machine, which
 * agents are installed, and how many model-written digests are left today. Each conversation
 * carries its `surface` — the terminal or the vendor's desktop app, read from the file's own
 * marker — and the agents gain one row per desktop app (`surface: "app"`) when the `.app`
 * bundle is on this Mac and the agent's store was found: the app writes to the same store as
 * the CLI, so a target with no store is not a target. `POST` takes one conversation, one
 * target, one tier and, for an app target, `surface: "app"`, writes a new file into the
 * target's own store through `@panoma/handoff`, records the receipt and answers with the line
 * that resumes it — the `open '<url>'` deep link for an app, the agent's command otherwise.
 * Nothing here opens the target: `/api/handoff/launch` does that, on the receipt.
 *
 * Both handlers carry both guards. Listing is looking, and looking is what the network key
 * gives — but what is listed is the titles and folders of private conversations, the same
 * history `twin/sources` puts behind the operator key, and the preview beside it reads the
 * whole transcript. One doctrine for the family: operator, for the four stores.
 *
 * Local only, both: the stores are on the server's disk, and under `DATABASE_URL` the disk is
 * another machine's. The GET answers `remote: true` so the screen can say so; the POST refuses.
 *
 * The one process this file starts is `opencode import <envelope>`, and only when the target
 * is OpenCode and the detector found its binary: the engine writes the envelope and cannot
 * start anything (`no-network.test.ts` sabotages `child_process` there), so the import step is
 * the route's. The binary is the one the detector verified, the argument is a path the engine
 * just wrote, and nothing from the body reaches it. It stays in this file on purpose: the
 * process sweep of `guard.test.ts` reads route files, and the shared half of the write
 * (`lib/handoff-write.ts`, which the agent channel's door uses too) only hands the step back to
 * be run here, between the file and the receipt.
 */

type DigestBy = "panoma" | "model";

interface HandoffBody {
  id: string;
  target: AgentId;
  surface: Surface;
  tier: Tier;
  digestBy: DigestBy;
  keepTurns?: number;
}

const BODY_KEYS = ["id", "target", "surface", "tier", "digestBy", "keepTurns"];

/**
 * Exactly `{ id, target, tier, surface?, digestBy?, keepTurns? }`, or nothing. The target is an
 * agent word (`codex`, `codex-cli`) with `surface` beside it, or an app word (`codex-app`) that
 * means the agent on its `app` surface — the same words the terminal takes after `--to`; an app
 * word with `surface: "cli"` contradicts itself and is refused.
 */
function readBody(value: unknown): HandoffBody | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !BODY_KEYS.includes(key))) return undefined;
  if (typeof body["id"] !== "string" || typeof body["target"] !== "string" || typeof body["tier"] !== "string") {
    return undefined;
  }
  if (!isTier(body["tier"])) return undefined;
  const chosen = targetOf(body["target"], body["surface"]);
  if (!chosen) return undefined;
  const digestBy = body["digestBy"] ?? "panoma";
  if (digestBy !== "panoma" && digestBy !== "model") return undefined;
  const keepTurns = body["keepTurns"];
  if (keepTurns !== undefined && !isKeepTurns(keepTurns)) return undefined;
  return {
    id: body["id"],
    target: chosen.target,
    surface: chosen.surface,
    tier: body["tier"],
    digestBy,
    ...(keepTurns !== undefined ? { keepTurns } : {}),
  };
}

export async function GET(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const { cap } = await capFor("handoff");
  if (process.env["DATABASE_URL"]) {
    return Response.json({ remote: true, conversations: [], stores: [], agents: [], digest: { left: 0, cap, connected: false } });
  }

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const { db: database } = await db();
  const cwds = catalogCwds(await listProjectRoots(database));

  try {
    const [discovery, detected, bundles, spent, config] = await Promise.all([
      discoverCached({ cwds, fresh }),
      agentsOf(),
      installedApps(),
      modelSpendToday(database, FAMILY_KINDS.handoff),
      readConfig().catch(() => ({ provider: undefined })),
    ]);
    const agents = detected.map((entry) => ({
      id: entry.provider.id,
      name: entry.provider.name,
      installed: entry.installed,
      broken: entry.broken ?? null,
      native: isAgentId(entry.provider.id) ? fidelityOf(entry.provider.id).native : false,
    }));
    /*
      The desktop apps, as targets: one row per app whose bundle is on this Mac and whose
      agent's store discovery found. `installedApps()` knows the bundles by the open-all ids
      (`claude-app`, `chatgpt-app`); the handoff names the second one `codex-app`, because
      what opens there is Codex and not ChatGPT.
     */
    const apps = (Object.entries(APP_OF) as [AgentId, NonNullable<(typeof APP_OF)[AgentId]>][])
      .filter(([agent, app]) =>
        bundles.some((bundle) => bundle.id === (app.bundle === "ChatGPT" ? "chatgpt-app" : "claude-app")) &&
        discovery.stores.some((store) => store.agent === agent && store.found),
      )
      .map(([agent, app]) => ({
        id: app.id,
        agent,
        surface: "app" as const,
        name: app.name,
        installed: true,
        broken: false,
        native: true,
      }));
    return Response.json(
      {
        conversations: discovery.conversations.map((entry) => ({ ...entry, surface: entry.surface ?? "cli" })),
        stores: discovery.stores,
        agents: [...agents, ...apps],
        digest: { left: Math.max(0, cap - spent.calls), cap, connected: Boolean(config.provider) },
      },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (error) {
    return handoffHttpError(error);
  }
}

export async function POST(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.handoff") }) },
      { status: 400 },
    );
  }

  const body = readBody(await request.json().catch(() => undefined));
  if (!body) {
    return Response.json(
      { error: "body", code: "body", detail: "expected exactly {id, target, tier, surface?, digestBy?, keepTurns?}" },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  try {
    // The id's shape before discovery: a malformed one answers 400 with no listing paid.
    checkId(body.id);
    const catalog = await discoverForCatalog(database);
    const opened = await openConversation(catalog, findConversation(catalog.discovery.conversations, body.id));
    const { conversation, cwd } = opened;

    /*
      The same agent at `full`, whichever surface: nothing is written. The app and the CLI share
      one store, so a whole copy would sit next to the original in the same folder; the door
      for that case is the launch on the original id (`{id, surface: "app"}`), never a copy. At
      `compact` the same agent is a target like any other — a shorter copy in the same store,
      what the other account resumes when the whole conversation is what hit the limit. The
      engine keeps the same rule; it is repeated here, ahead of the paid digest, so the answer
      does not depend on it and a refused request costs nothing.
     */
    refuseSameStore(conversation, body.target, body.tier, "full-only");

    let digest: Digest = digestConversation(conversation);
    if (body.digestBy === "model") {
      /*
        The engine's other free refusals, ahead of the paid call for the same reason: the panel
        offers every installed agent whether or not it has ever run, and a Codex installed and
        never opened has no store, so until 12-Sep-2026 that request paid for a digest — one
        ledger row, one of the day's ten — and then answered `target-store-missing`. The same
        for a folder the target would not find and for nothing to carry. `checkHandoff` runs
        the checks `handoff()` runs, with the mechanical digest in the model's place (the
        summary it composes is never empty, so the answer is the same), and writes nothing.
       */
      await checkHandoff({
        conversation,
        target: body.target,
        surface: body.surface,
        tier: body.tier,
        digest,
        cwd,
        ...(body.keepTurns !== undefined ? { keepTurns: body.keepTurns } : {}),
        options: storeOptions(),
      });
      /*
        The brake, against the whole chain: the model reads the transcript in windows, one paid
        call each (`planDigest`, pure), and a day with three calls left does not start a chain
        of five — the 429 names what it needs and what is left, and nothing is paid or written.
       */
      const spent = await modelSpendToday(database, FAMILY_KINDS.handoff);
      const { cap } = await capFor("handoff");
      const plan = planDigest(conversation, digest);
      const refused = digestRefusal(locale, { cap, spent: spent.calls, calls: plan.calls });
      if (refused) return Response.json(refused, { status: 429 });
      try {
        ({ digest } = await writeDigestWithModel(database, {
          conversation,
          digest,
          cap,
          spent: spent.calls,
          plan,
          identity: null,
        }));
      } catch (error) {
        const { detail, hint } = modelErrorParts(locale, error);
        return Response.json({ error: t(locale, "api.modelFailed", { detail }), hint }, { status: 502 });
      }
    }

    const written = await writeHandoff(database, {
      ...opened,
      target: body.target,
      surface: body.surface,
      tier: body.tier,
      digest,
      ...(body.keepTurns !== undefined ? { keepTurns: body.keepTurns } : {}),
      /*
        OpenCode's door is its own importer. The engine wrote the envelope and the step that
        reads it; when OpenCode is installed here the step is taken now, through the binary the
        detector verified, from the project folder. Not installed: the step stays in the answer
        for the person, and the envelope waits next to `opencode.db`.
       */
      importer: async (result) => {
        const found = (await agentsOf()).find((entry) => entry.provider.id === "opencode" && entry.installed);
        if (!found?.command) return result.steps;
        try {
          // Through the house resolver: on Windows an npm-installed OpenCode is `opencode.cmd`, and
          // a `.cmd` cannot be started without `cmd.exe` in front of it (docs/platforms.md).
          const launch = resolveExecutable(found.command, ["import", result.path]);
          await run(launch.file, launch.args, { cwd, timeout: 60_000, windowsHide: true });
          return [];
        } catch (error) {
          const failure = error as Error & { stderr?: string };
          const said = (failure.stderr ?? "").trim().split("\n")[0]?.slice(0, 160) || failure.message;
          throw new HandoffFault("import-command-failed", said, { cause: error });
        }
      },
    });

    return Response.json(writtenBody(written, digest));
  } catch (error) {
    return handoffHttpError(error);
  }
}
