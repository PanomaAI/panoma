import { and, desc, eq } from "drizzle-orm";
import { redactSecrets } from "@panoma/core";
import type { Database } from "./client";
import { newId } from "./agents";
import * as t from "./schema";

/**
 * The receipts of handoffs.
 *
 * A receipt says which conversation became which, when, at which tier, what was left behind and
 * the line that resumes it. It never holds the text: the conversation lives in the agents' own
 * stores, and the digest is derived and regenerable. What is stored here is what a person needs
 * to find the copy again — and what the panel needs to say 'already handed to that agent' before
 * writing a second one.
 */

export type HandoffRow = typeof t.handoffs.$inferSelect;
export type HandoffDropped = t.HandoffDropped;

/** A receipt with the slug of its project, when the folder is in the catalog. */
export type HandoffListRow = HandoffRow & { projectSlug: string | null };

export interface NewHandoff {
  projectId?: string | null;
  cwd: string;
  /** Redacted before it is stored; a source title can carry whatever the person pasted. */
  title?: string | null;
  sourceAgent: string;
  sourceSessionId: string;
  sourcePath: string;
  sourceHash: string;
  targetAgent: string;
  /** Default `cli`. */
  targetSurface?: HandoffRow["targetSurface"];
  targetSessionId: string;
  targetPath: string;
  tier: HandoffRow["tier"];
  turns: number;
  bytes: number;
  dropped?: HandoffDropped;
  /** The display line the server derived; never taken from a client. */
  resumeCommand?: string | null;
  /**
   * The agent that asked over the MCP channel, by the name its key was issued under; absent or
   * `null` when a person asked from the screen or the terminal.
   */
  requestedBy?: string | null;
}

export async function recordHandoff(db: Database, input: NewHandoff): Promise<HandoffRow> {
  const [row] = await db
    .insert(t.handoffs)
    .values({
      id: newId("hnd"),
      projectId: input.projectId ?? null,
      cwd: input.cwd,
      title: input.title == null ? null : redactSecrets(input.title),
      sourceAgent: input.sourceAgent,
      sourceSessionId: input.sourceSessionId,
      sourcePath: input.sourcePath,
      sourceHash: input.sourceHash,
      targetAgent: input.targetAgent,
      targetSurface: input.targetSurface ?? "cli",
      targetSessionId: input.targetSessionId,
      targetPath: input.targetPath,
      tier: input.tier,
      turns: input.turns,
      bytes: input.bytes,
      ...(input.dropped ? { dropped: input.dropped } : {}),
      resumeCommand: input.resumeCommand ?? null,
      requestedBy: input.requestedBy ?? null,
    })
    .returning();
  return row!;
}

const withSlug = {
  id: t.handoffs.id,
  projectId: t.handoffs.projectId,
  cwd: t.handoffs.cwd,
  title: t.handoffs.title,
  sourceAgent: t.handoffs.sourceAgent,
  sourceSessionId: t.handoffs.sourceSessionId,
  sourcePath: t.handoffs.sourcePath,
  sourceHash: t.handoffs.sourceHash,
  targetAgent: t.handoffs.targetAgent,
  targetSurface: t.handoffs.targetSurface,
  targetSessionId: t.handoffs.targetSessionId,
  targetPath: t.handoffs.targetPath,
  tier: t.handoffs.tier,
  turns: t.handoffs.turns,
  bytes: t.handoffs.bytes,
  dropped: t.handoffs.dropped,
  resumeCommand: t.handoffs.resumeCommand,
  requestedBy: t.handoffs.requestedBy,
  createdAt: t.handoffs.createdAt,
  projectSlug: t.projects.slug,
} as const;

/** The 'Done so far' section: newest first, with the project slug when there is one. */
export async function listHandoffs(db: Database, limit = 50): Promise<HandoffListRow[]> {
  return db
    .select(withSlug)
    .from(t.handoffs)
    .leftJoin(t.projects, eq(t.projects.id, t.handoffs.projectId))
    .orderBy(desc(t.handoffs.createdAt), desc(t.handoffs.id))
    .limit(limit);
}

/** The project card: what was handed off from this folder, newest first. */
export async function listProjectHandoffs(db: Database, projectId: string): Promise<HandoffRow[]> {
  return db
    .select()
    .from(t.handoffs)
    .where(eq(t.handoffs.projectId, projectId))
    .orderBy(desc(t.handoffs.createdAt), desc(t.handoffs.id));
}

export async function getHandoff(db: Database, id: string): Promise<HandoffRow | undefined> {
  const [row] = await db.select().from(t.handoffs).where(eq(t.handoffs.id, id)).limit(1);
  return row;
}

/** The newest receipt for one conversation and one target: 'already handed to that agent'. */
export async function findHandoff(
  db: Database,
  sourceHash: string,
  targetAgent: string,
  targetSurface: HandoffRow["targetSurface"] = "cli",
): Promise<HandoffRow | undefined> {
  const [row] = await db
    .select()
    .from(t.handoffs)
    .where(
      and(
        eq(t.handoffs.sourceHash, sourceHash),
        eq(t.handoffs.targetAgent, targetAgent),
        eq(t.handoffs.targetSurface, targetSurface),
      ),
    )
    .orderBy(desc(t.handoffs.createdAt), desc(t.handoffs.id))
    .limit(1);
  return row;
}
