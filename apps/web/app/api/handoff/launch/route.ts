import { stat } from "node:fs/promises";
import { getHandoff, getProjectLocation, listProjectRoots } from "@panoma/db";
import {
  APP_OF,
  isAgentId,
  isNativeTarget,
  isSafeId,
  isSessionIdOf,
  resumeInApp,
  resumeOf,
  splitConversationId,
  type AgentId,
  type ResumeInApp,
} from "@panoma/handoff";
import { HandoffFault } from "@panoma/handoff/faults";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { discoverCached } from "@/lib/handoff-cache";
import { handoffHttpError, isAppLink, projectOnDisk } from "@/lib/handoff-http";
import { localeFrom, t, type Locale } from "@/lib/i18n";
import { openAgent, openApp, type LaunchOutcome } from "@/lib/open-targets";
import { spawnDetached } from "@/lib/spawn-detached";

/**
 * Open the target resuming a conversation: a terminal with the agent, or the vendor's desktop
 * app through its deep link.
 *
 * The body is one of two things. `{receipt}` names a row of `handoffs`, and everything that
 * becomes a process is re-derived from that row — the agent from `target_agent`, the arguments
 * from `resumeOf(target_agent, target_session_id)`, the folder from the catalog project the
 * receipt hangs off — and the binary is the one the detector verified answers to that agent's
 * id, with `strict` so that a conversation handed to Codex never opens in whichever agent is
 * installed. The stored `resume_command` is a display line; it is never executed as stored.
 * `{id, surface: "app"}` names an original conversation discovery listed, for the same-agent
 * door: nothing is written, the app adopts the file in place (docs/handoff.md, «The desktop
 * apps»).
 *
 * An app target — a receipt with `target_surface: "app"`, or the `{id}` body — runs `open <url>`
 * where the URL is built here from the agent and the validated id through the two closed
 * templates of `resumeInApp`, and checked once more with `isAppLink` before it becomes an
 * argument. When `open` fails at once, the fallback is `open -a <bundle>` through `openApp`,
 * which is what the open-all family already does for the same two apps. Off macOS there is no
 * app to open, and the answer says which one it would have been.
 *
 * Operator key, like `/api/open`: this opens a terminal or an app with an agent working on this
 * machine. Local only, like every launcher: the folder is on the server's disk.
 */

/** The two bodies this door takes: a receipt, or an original conversation for its own app. */
type LaunchBody = { door: "receipt"; receipt: string } | { door: "original"; id: string };

const BODY_KEYS = ["receipt", "id", "surface"];

/**
 * Exactly `{ receipt }` or exactly `{ id, surface: "app" }`, or nothing — the family's rule
 * (docs/http-api.md: a body that is not exactly the declared fields answers 400 `body`), which
 * this door kept for the `{id}` shape only until 12-Sep-2026: a receipt with any key beside it
 * passed, and a body with neither was answered as a missing project id.
 */
function readBody(value: unknown): LaunchBody | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key) => !BODY_KEYS.includes(key))) return undefined;
  if (keys.length === 1 && typeof body["receipt"] === "string") return { door: "receipt", receipt: body["receipt"] };
  if (keys.length === 2 && typeof body["id"] === "string" && body["surface"] === "app") return { door: "original", id: body["id"] };
  return undefined;
}

function answer(outcome: LaunchOutcome, extra: Record<string, unknown>): Response {
  if (outcome.ok) return Response.json({ ok: true, ...extra, with: outcome.with });
  return Response.json(
    { error: outcome.error, ...(outcome.hint ? { hint: outcome.hint } : {}) },
    { status: outcome.status },
  );
}

async function folderExists(root: string): Promise<boolean> {
  try {
    return (await stat(root)).isDirectory();
  } catch {
    return false;
  }
}

function gone(locale: Locale, root: string): Response {
  return Response.json(
    { error: t(locale, "open.gone", { root }), hint: t(locale, "open.goneHint") },
    { status: 410 },
  );
}

/**
 * The app door: `open <url>`, with `open -a <bundle>` when the link does not answer, and a
 * 501 off macOS naming the app that is not here. The `platform` argument exists for the test
 * that asserts the 501.
 */
async function openInApp(
  agent: AgentId,
  sessionId: string,
  root: string,
  locale: Locale,
  platform: NodeJS.Platform,
): Promise<Response> {
  const app = APP_OF[agent];
  if (!app) return Response.json({ error: "invalid-id" }, { status: 400 });
  const link: ResumeInApp | undefined = resumeInApp(agent, sessionId, root, platform);
  if (!link) {
    if (platform !== "darwin") {
      return Response.json(
        { error: t(locale, "open.noAgent"), hint: t(locale, "open.noAgentHint", { agents: app.name }) },
        { status: 501 },
      );
    }
    return Response.json({ error: "invalid-id" }, { status: 400 });
  }
  if (!isAppLink(link.url)) return Response.json({ error: "invalid-id" }, { status: 400 });
  if (!(await folderExists(root))) return gone(locale, root);

  const extra = { root, line: link.line, sentence: link.sentence };
  const failure = await spawnDetached("open", [link.url]);
  if (!failure) return Response.json({ ok: true, ...extra, with: app.name });
  // `open -a` over the folder: the app comes up even when the link scheme is not registered.
  const fallback = await openApp(root, app.id === "codex-app" ? "chatgpt-app" : "claude-app", locale);
  return answer(fallback, extra);
}

export async function POST(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.launchAgent") }) },
      { status: 400 },
    );
  }

  const body = readBody(await request.json().catch(() => undefined));
  if (!body) {
    return Response.json({ error: "body", code: "body", detail: 'expected exactly {receipt} or {id, surface: "app"}' }, { status: 400 });
  }
  const { db: database } = await db();

  // The same-agent door on an original conversation: `{id, surface: "app"}` and nothing else.
  if (body.door === "original") {
    try {
      const split = splitConversationId(body.id);
      if (!split || !isAgentId(split.agent) || !isSessionIdOf(split.agent, split.sessionId)) {
        throw new HandoffFault("invalid-id", body.id.slice(0, 80));
      }
      const roots = await listProjectRoots(database);
      const cwds = [...roots.map((entry) => entry.root), process.cwd()];
      const discovery = await discoverCached({ cwds });
      const ref = discovery.conversations.find((entry) => entry.id === body.id);
      if (!ref) throw new HandoffFault("conversation-not-found", body.id);
      const project = await projectOnDisk(ref.cwd, roots);
      return await openInApp(ref.agent, ref.sessionId, project?.root ?? ref.cwd, locale, process.platform);
    } catch (error) {
      return handoffHttpError(error);
    }
  }

  // A receipt id that is not one: never looked up, and named as the id it is not.
  if (!isSafeId(body.receipt)) return handoffHttpError(new HandoffFault("invalid-id", body.receipt.slice(0, 80)));

  const receipt = await getHandoff(database, body.receipt);
  if (!receipt) return Response.json({ error: "receipt-not-found" }, { status: 404 });

  // A receipt without a project has no folder the catalog vouches for: the line is copied by
  // hand, which is what the screen offers in that case.
  if (!receipt.projectId) return Response.json({ error: t(locale, "api.noProject") }, { status: 400 });
  const project = await getProjectLocation(database, receipt.projectId);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const agent = receipt.targetAgent;
  if (!isAgentId(agent) || !isNativeTarget(agent)) return Response.json({ error: "invalid-id" }, { status: 400 });

  if (receipt.targetSurface === "app") {
    return openInApp(agent, receipt.targetSessionId, project.root, locale, process.platform);
  }

  const resume = resumeOf(agent, receipt.targetSessionId, project.root);
  if (!resume) return Response.json({ error: "invalid-id" }, { status: 400 });
  if (!(await folderExists(project.root))) return gone(locale, project.root);

  const outcome = await openAgent(project.root, agent, locale, { args: resume.args, strict: true });
  return answer(outcome, { root: project.root, line: resume.line });
}
