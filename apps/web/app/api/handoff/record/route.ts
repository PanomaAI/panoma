import { listProjectRoots, recordHandoff, type HandoffDropped } from "@panoma/db";
import {
  isAgentId,
  isNativeTarget,
  isSafeId,
  isSessionIdOf,
  isSurface,
  isTier,
  splitConversationId,
  type AgentId,
  type Surface,
  type Tier,
} from "@panoma/handoff";
import { HandoffFault } from "@panoma/handoff/faults";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { discoverCached } from "@/lib/handoff-cache";
import { handoffHttpError, projectOnDisk, resumeLineOf } from "@/lib/handoff-http";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The CLI's receipt: `panoma handoff` wrote the file itself and tells the catalog what became
 * what, so the screen can list it and the panel can say «already handed to that agent».
 *
 * Best effort on the CLI's side — a catalog that is down leaves the file where it is — and
 * strict on this side: the body is exactly the ten fields, every id passes `isSafeId` and,
 * for a native target, the agent's own id shape; `title` and `cwd` are re-read from discovery
 * by the conversation id, not taken from the body; and `resume_command` is derived here from
 * the agent, the session id and the surface — the deep link for an app target — never
 * received. What a client can put in the catalog is a number and a hash, and the hash is
 * checked for shape.
 *
 * Operator key: it writes a row that names files in the person's agent stores and puts a
 * command line on a screen. Local only: the receipt describes files on this disk.
 */

const DROPPED_KEYS = ["thinking", "images", "subagents", "offloaded", "secrets", "other"] as const;
const BODY_KEYS = ["id", "target", "surface", "tier", "targetSessionId", "targetPath", "sourceHash", "turns", "bytes", "dropped"];

interface RecordBody {
  id: string;
  sourceAgent: AgentId;
  sourceSessionId: string;
  target: AgentId;
  surface: Surface;
  tier: Tier;
  targetSessionId: string;
  targetPath: string;
  sourceHash: string;
  turns: number;
  bytes: number;
  dropped: HandoffDropped;
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/** Exactly the ten fields with their shapes, or nothing. */
function readBody(value: unknown): RecordBody | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !BODY_KEYS.includes(key))) return undefined;
  if (BODY_KEYS.some((key) => body[key] === undefined)) return undefined;

  const { id, target, surface, tier, targetSessionId, targetPath, sourceHash, turns, bytes, dropped } = body;
  if (typeof id !== "string" || typeof target !== "string" || typeof tier !== "string") return undefined;
  if (typeof surface !== "string" || !isSurface(surface)) return undefined;
  if (typeof targetSessionId !== "string" || typeof targetPath !== "string" || typeof sourceHash !== "string") return undefined;
  const split = splitConversationId(id);
  if (!split || !isAgentId(split.agent) || !isSessionIdOf(split.agent, split.sessionId)) return undefined;
  if (!isAgentId(target) || !isTier(tier)) return undefined;
  const native = isNativeTarget(target) && tier !== "brief";
  if (native ? !isSessionIdOf(target, targetSessionId) : !isSafeId(targetSessionId)) return undefined;
  if (targetPath.trim() === "" || targetPath.length > 4096 || targetPath.includes("\0")) return undefined;
  if (!/^[0-9a-f]{64}$/.test(sourceHash)) return undefined;
  if (!isCount(turns) || !isCount(bytes)) return undefined;
  if (typeof dropped !== "object" || dropped === null || Array.isArray(dropped)) return undefined;
  const counts = dropped as Record<string, unknown>;
  if (Object.keys(counts).some((key) => !(DROPPED_KEYS as readonly string[]).includes(key))) return undefined;
  if (DROPPED_KEYS.some((key) => !isCount(counts[key]))) return undefined;

  return {
    id,
    sourceAgent: split.agent,
    sourceSessionId: split.sessionId,
    target,
    surface,
    tier,
    targetSessionId,
    targetPath,
    sourceHash,
    turns,
    bytes,
    dropped: Object.fromEntries(DROPPED_KEYS.map((key) => [key, counts[key] as number])) as unknown as HandoffDropped,
  };
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
      {
        error: "body",
        code: "body",
        detail: "expected exactly {id, target, surface, tier, targetSessionId, targetPath, sourceHash, turns, bytes, dropped}",
      },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  try {
    const roots = await listProjectRoots(database);
    const cwds = [...roots.map((entry) => entry.root), process.cwd()];
    const discovery = await discoverCached({ cwds });
    const ref = discovery.conversations.find((entry) => entry.id === body.id);
    if (!ref) throw new HandoffFault("conversation-not-found", body.id);

    const project = await projectOnDisk(ref.cwd, roots);
    const cwd = project?.root ?? ref.cwd;
    const native = isNativeTarget(body.target) && body.tier !== "brief";

    const receipt = await recordHandoff(database, {
      projectId: project?.id ?? null,
      cwd,
      title: ref.title ?? null,
      sourceAgent: body.sourceAgent,
      sourceSessionId: body.sourceSessionId,
      sourcePath: ref.path,
      sourceHash: body.sourceHash,
      targetAgent: body.target,
      targetSurface: body.surface,
      targetSessionId: body.targetSessionId,
      targetPath: body.targetPath,
      tier: body.tier,
      turns: body.turns,
      bytes: body.bytes,
      dropped: body.dropped,
      resumeCommand: native ? resumeLineOf(body.target, body.targetSessionId, cwd, body.surface) : null,
    });
    revalidatePath("/handoff");
    if (project) revalidatePath(`/p/${project.slug}`);
    return Response.json({ ok: true, receipt });
  } catch (error) {
    return handoffHttpError(error);
  }
}
