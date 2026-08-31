import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { redactSecrets } from "@panoma/core";
import { newId } from "./agents";
import type { Database } from "./client";
import * as t from "./schema";

/**
 * The shadow substitute: record the question, save the draft, collect the tag.
 *
 * The whole reason is in `schema.ts` (`consultations`). Here, as in the notes, the limits are the
 * design and the functions only make them comply.
 */

/** Longer than this is not a question of judgment: it is a task, and it goes to the assignments. */
export const CONSULT_MAX = 300;

/**
 * Questions waiting for review at the same time, by project. The same reason as the grade queue: a
 * review list that is tedious is a measure that nobody takes.
 *
 * It counts what the person can actually empty: drafts written without a label, plus the newly
 * asked ones that are on their way to being so. An abstention is data, not a queue — it is not
 * labeled and does not count. And a stranded `drafting` stops counting per day. The first version
 * counted all `verdict IS NULL`, and that was a ratchet: each abstention consumed one of the
 * twenty slots forever and the route closed itself.
 */
export const CONSULT_PENDING_MAX = 20;

export interface Consultation {
  id: string;
  question: string;
  answer: string | null;
  beliefIds: string[];
  status: string;
  verdict: string | null;
  agent: string;
  createdAt: Date;
}

/** A question comes in. The draft will come later and by another way: the turn does not wait. */
export async function recordConsultation(
  db: Database,
  input: { projectId: string; agentId: string; question: string },
): Promise<{ id: string; pending: number } | { refused: "tooLong" | "queueFull"; max: number }> {
  // Also here the key customs: a question is kept, it is written, and it is reread.
  const question = redactSecrets(input.question.trim());
  if (question.length === 0 || question.length > CONSULT_MAX) {
    return { refused: "tooLong", max: CONSULT_MAX };
  }

  const [row] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(t.consultations)
    .where(
      and(
        eq(t.consultations.projectId, input.projectId),
        isNull(t.consultations.verdict),
        or(
          eq(t.consultations.status, "drafted"),
          and(
            eq(t.consultations.status, "drafting"),
            sql`${t.consultations.createdAt} > now() - interval '24 hours'`,
          ),
        ),
      ),
    );
  const pending = row?.pending ?? 0;
  if (pending >= CONSULT_PENDING_MAX) return { refused: "queueFull", max: CONSULT_PENDING_MAX };

  const id = newId("ask");
  await db.insert(t.consultations).values({
    id,
    projectId: input.projectId,
    agentId: input.agentId,
    question,
  });
  return { id, pending: pending + 1 };
}

/**
 * The draft of the double lands — or its abstention, which is the most common honest response and
 * counts as data. Only about `drafting`: a draft does not step on another, and it never steps on a
 * row that the person could already see.
 */
export async function draftConsultation(
  db: Database,
  id: string,
  draft: { answer: string; beliefIds: string[] } | { abstained: true },
): Promise<boolean> {
  const fields =
    "abstained" in draft
      ? { status: "abstained" as const, draftedAt: new Date() }
      : { status: "drafted" as const, answer: draft.answer, beliefIds: draft.beliefIds, draftedAt: new Date() };

  const moved = await db
    .update(t.consultations)
    .set(fields)
    .where(and(eq(t.consultations.id, id), eq(t.consultations.status, "drafting")))
    .returning({ id: t.consultations.id });
  return moved.length > 0;
}

/**
 * The person's label: «would have said the same» (`backed`) or «no» (`vetoed`).
 *
 * Only on drafted and untagged drafts — an abstention is not tagged (there is no answer to judge)
 * and a tag is not rewritten: the second click comes late, like all the decisions of this house.
 */
export async function labelConsultation(
  db: Database,
  id: string,
  verdict: "backed" | "vetoed",
): Promise<boolean> {
  const moved = await db
    .update(t.consultations)
    .set({ verdict, verdictAt: new Date() })
    .where(
      and(
        eq(t.consultations.id, id),
        eq(t.consultations.status, "drafted"),
        isNull(t.consultations.verdict),
      ),
    )
    .returning({ id: t.consultations.id });
  return moved.length > 0;
}

/**
 * The stranded drafts of a project: questions whose writer fell through or ran out of budget. Only
 * those that have been around for a while — the newly asked still has their own writer on the way,
 * and paying for a call again would be spending the same thing twice. The oldest first: they have
 * been waiting for their turn longer.
 */
export async function staleDrafting(
  db: Database,
  projectId: string,
  olderThanMs = 10 * 60_000,
  limit = 5,
): Promise<{ id: string; question: string }[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  return db
    .select({ id: t.consultations.id, question: t.consultations.question })
    .from(t.consultations)
    .where(
      and(
        eq(t.consultations.projectId, projectId),
        eq(t.consultations.status, "drafting"),
        sql`${t.consultations.createdAt} < ${cutoff}`,
      ),
    )
    .orderBy(asc(t.consultations.createdAt))
    .limit(limit);
}

/** The inquiries of a project for the record, the newest first, with whom they asked. */
export async function listProjectConsultations(
  db: Database,
  projectId: string,
  limit = 20,
): Promise<Consultation[]> {
  const rows = await db
    .select({
      id: t.consultations.id,
      question: t.consultations.question,
      answer: t.consultations.answer,
      beliefIds: t.consultations.beliefIds,
      status: t.consultations.status,
      verdict: t.consultations.verdict,
      agent: t.agents.name,
      createdAt: t.consultations.createdAt,
    })
    .from(t.consultations)
    .innerJoin(t.agents, eq(t.agents.id, t.consultations.agentId))
    .where(eq(t.consultations.projectId, projectId))
    .orderBy(desc(t.consultations.createdAt), asc(t.consultations.id))
    .limit(limit);

  return rows.map((row) => ({ ...row, beliefIds: (row.beliefIds as string[]) ?? [] }));
}

export interface DoubleReport {
  questions: number;
  drafted: number;
  abstained: number;
  labeled: number;
  backed: number;
  vetoed: number;
  /** Of what arrived as a draft, which part of the questions did it cover. Null without solved questions. */
  coverage: number | null;
  /** Of the labeled, what part was correct. Null without labels: fidelity is not invented. */
  fidelity: number | null;
}

/**
 * The two numbers that decide if the double comes out of the shadow, plus its raw ones.
 *
 * The rule already written on the border: without fidelity ≥ 0.9 in the non-abstained, the double
 * does not speak. This report does not make the decision — it shows it, which is its role: the
 * decision belongs to the person and to a written threshold, not to an aggregate.
 */
export async function doubleReport(db: Database, days = 30): Promise<DoubleReport> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [row] = await db
    .select({
      questions: sql<number>`count(*)::int`,
      drafted: sql<number>`count(*) filter (where ${t.consultations.status} = 'drafted')::int`,
      abstained: sql<number>`count(*) filter (where ${t.consultations.status} = 'abstained')::int`,
      labeled: sql<number>`count(*) filter (where ${t.consultations.verdict} is not null)::int`,
      backed: sql<number>`count(*) filter (where ${t.consultations.verdict} = 'backed')::int`,
      vetoed: sql<number>`count(*) filter (where ${t.consultations.verdict} = 'vetoed')::int`,
    })
    .from(t.consultations)
    .where(sql`${t.consultations.createdAt} >= ${since}`);

  const drafted = row?.drafted ?? 0;
  const abstained = row?.abstained ?? 0;
  const labeled = row?.labeled ?? 0;
  const backed = row?.backed ?? 0;
  const resolved = drafted + abstained;

  return {
    questions: row?.questions ?? 0,
    drafted,
    abstained,
    labeled,
    backed,
    vetoed: row?.vetoed ?? 0,
    coverage: resolved > 0 ? Math.round((drafted / resolved) * 100) / 100 : null,
    fidelity: labeled > 0 ? Math.round((backed / labeled) * 100) / 100 : null,
  };
}
