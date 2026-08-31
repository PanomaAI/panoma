import {
  TasteFullError,
  publishesInferred,
  readConsent,
  readTaste,
  setInferredConsent,
  writeTaste,
} from "@panoma/core";
import {
  ALIVE,
  inTransaction,
  listBeliefs,
  markPublished,
  projectNamesByIdentity,
  resolveProposal,
  setBeliefScope,
  signBelief,
  tasteScore,
  vetoBelief,
  type Database,
} from "@panoma/db";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { dropStatements, reconcileTaste } from "@/lib/taste-merge";
import { publishable } from "@/lib/publishable";

/**
 * The portrait: what is read and what is signed.
 *
 * Write `TASTE.md` from the **beliefs**, which is the only thing that reaches the agents. Before,
 * it was written from the accepted sentences one by one; the reason for the change is in
 * `schema.ts`, above the two tables, and the consequence for this route is that there is nothing
 * to approve anymore. What there are are four gestures, and none is mandatory:
 *
 * - **to sign** —editing the sentence or saying that it is okay—, which takes it out of the reach
 * of synthesis forever;
 * - **veto**, which sends it to the cemetery and turns it into negative evidence;
 * - **to delimit**, which limits it to a project or returns it to everything you do;
 * - **resolve** a proposal, which is the only queue left: the synthesis wanted to touch something
 * signed and it cannot do that alone.
 *
 * ── Remove from the file ──────────────────────────────────────────────────────────
 *
 * What is signed always, and from what is inferred only what exceeds the trust floor—three
 * observations from two days or from two projects, see `standsUp`. What is below can be seen on
 * the screen marked 'in formation' and does not go beyond that: inferring without asking, yes;
 * noise directing agents, no. That is the line that replaces the signature as a brake, and that is
 * why the floor lives in `@panoma/db`, where it is shared by the terminal and the web.
 *
 * ── And one question, just once ─────────────────────────────────────────────────
 *
 * None of what is **inferred** goes down until the person says yes once. It is not a disguised
 * tail: it is a boundary that does deserve to be questioned, because by closing the review phrase
 * by phrase something that no one has signed went on to be able to speak on their behalf in each
 * session of each agent. Before, there were hundreds of decisions; now there is one, and as long
 * while the portrait remains unanswered, it is exactly what the person signed. The absence of a response **is
 * not** a yes — see `publishesInferred`.
 *
 * ── The file is still an entry ──────────────────────────────────────────
 *
 * And now it does more than before. `reconcileTaste` distinguishes a **deleted** line from a
 * **rewritten** line by the quote mark that travels with it, and here each thing means one:
 * deleting a line is vetoing that belief, and rewriting it is signing it with the new words. It is
 * the best version of 'the file is the undo': anyone who does not want to open the screen can
 * direct their entire portrait with a text editor.
 *
 * ── GET is seen from the mobile; POST, not ──────────────────────────────────
 *
 * `localOperatorOnly` in the POST and not in the GET, which is the doctrine of `lib/guard.ts`: the
 * key of `panoma up --network` allows **looking at** the catalog, not putting hands on the
 * keyboard of this machine. And here the POST does the two things that that phrase excludes — it
 * writes `TASTE.md`, which is what all the agents of this person read in all their sessions, and
 * it saves the permission for what the machine deduced on its own to speak on their behalf.
 *
 * The doctrine test found it, not a review: the rule said 'routes that start
 * processes,' this one doesn't start any, yet it grants permission. The rule now also names those
 * that open the history or make decisions about it.
 *
 * ── Either everything goes in or nothing goes in
 * ─────────────────────────────────────────────────
 *
 * The database guarantees it. Without the transaction, a portrait that does not fit would leave the
 * gestures saved and the file as it was, and that split state is **unstable**: `reconcileTaste`
 * withdraws any belief whose sentence isn't in the file, so the next save that does fit would veto
 * exactly what never got written. See `inTransaction`, where it is argued why writing to the file
 * goes inside.
 */

export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const { db: database } = await db();
  const [beliefs, profile, score, names, consent] = await Promise.all([
    listBeliefs(database),
    readTaste(),
    tasteScore(database),
    projectNamesByIdentity(database),
    readConsent(),
  ]);

  return Response.json({
    beliefs,
    profile,
    score,
    names,
    /* If the inferred can go down. Without this, the terminal cannot say why it is missing. */
    publishesInferred: publishesInferred(consent),
  });
}

export async function POST(request: Request) {
  // Write the file that all your agents read and save a permission. See header.
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as {
    sign?: unknown;
    veto?: unknown;
    scope?: unknown;
    resolve?: unknown;
    publishInferred?: unknown;
  };

  /*
    The answer to the only question, if it comes. It is saved **before** reconciling because it
    changes what is written: saying yes and that the file will not change until the next action
    would leave someone looking at a screen that says 'granted' and a file that does not know it.
    Only a boolean counts, and absence is nothing: a body without the key is a normal save, not a
    revocation.
   */
  if (typeof body.publishInferred === "boolean") {
    await setInferredConsent(body.publishInferred);
  }

  const gestures: Gestures = {
    sign: signs(body.sign),
    veto: ids(body.veto),
    scope: scopes(body.scope),
    resolve: resolutions(body.resolve),
  };

  /*
    Without gestures it is not a mistake: it is 'pick up what I edited by hand.' Someone opens the
    file, deletes a sentence that no longer represents them, and wants Twin to find out without
    having to sign something to trigger it.
   */
  const { db: database } = await db();

  try {
    return await inTransaction(database, async (tx) => apply(tx, gestures));
  } catch (error) {
    if (error instanceof TasteFullError) {
      return Response.json(
        {
          error: t(locale, "taste.full", { chars: error.chars, cap: error.cap }),
          chars: error.chars,
          cap: error.cap,
          // Everything to zero and not what was applied: the transaction was reversed, so nothing
          // was applied. Showing 'signed: 3' on an intact basis would be lying.
          signed: 0,
          vetoed: 0,
          scoped: 0,
          resolved: 0,
          withdrawn: 0,
          rewritten: 0,
          profile: await readTaste(),
        },
        { status: 409 },
      );
    }
    throw error;
  }
}

interface Gestures {
  sign: { id: string; statement?: string }[];
  veto: string[];
  scope: { id: string; identity: string | null }[];
  resolve: { id: string; accept: boolean }[];
}

async function apply(database: Database, gestures: Gestures): Promise<Response> {
  const [file, names, consent] = await Promise.all([
    readTaste(),
    projectNamesByIdentity(database),
    readConsent(),
  ]);
  const inferred = publishesInferred(consent);

  /*
    They are applied one by one and the ones that actually changed are counted. Each function
    returns whether there was a row to modify, and the id comes from outside: a screen opened
    before a `forget` sends ids that no longer exist, and counting them as completed would be
    promising a change that did not happen.
   */
  let signed = 0;
  for (const one of gestures.sign) {
    if (await signBelief(database, one.id, one.statement)) signed += 1;
  }
  let vetoed = 0;
  for (const id of gestures.veto) if (await vetoBelief(database, id)) vetoed += 1;
  let scoped = 0;
  for (const one of gestures.scope) {
    if (await setBeliefScope(database, one.id, one.identity)) scoped += 1;
  }
  let resolved = 0;
  for (const one of gestures.resolve) {
    if (await resolveProposal(database, one.id, one.accept)) resolved += 1;
  }

  /*
    Everything in the database, read **after** applying the gestures: what should be written is
    the current state and not the one from before the person touched anything.
   */
  const todas = await listBeliefs(database);
  const rows = publishable(
    todas.filter((row) => ALIVE.includes(row.state)),
    names,
    inferred,
  );
  const publicables = new Set(rows.map((row) => row.id));

  /*
    And what was written and is no longer published: banned, withdrawn, absorbed by a merger, or
    fallen below the floor. Its lines are removed from the file **before** reconciling, so it was
    written about them and not for what the row says today.
    It was missing, and it was serious in both directions. Removing it got nothing out of the
    file: the line was a gap that no one claimed, the rule of ‘what no one claimed stays’
    preserved it, and the agents kept reading a belief that the catalog had already considered
    dead — without any gesture capable of removing it, because the screen only lists what is
    alive. And the sisters that an accepted merger withdrew left their old lines there forever.
   */
  const retiradas = todas.filter((row) => row.publishedAs !== null && !publicables.has(row.id));
  const merge = reconcileTaste(
    dropStatements(
      file.lines,
      retiradas.flatMap((row) => (row.publishedAs ? [row.publishedAs] : [])),
    ),
    rows,
  );

  /*
    Deleting a line by hand is vetoing that belief, and rewriting it is signing it. Both things
    happen **before** writing: the disk has been saying it since before the request, so this just
    brings the database up to date with the file.
   */
  let withdrawn = 0;
  for (const id of merge.withdrawn) if (await vetoBelief(database, id)) withdrawn += 1;
  let rewritten = 0;
  for (const one of merge.rewritten) {
    if (await signBelief(database, one.id, one.statement)) rewritten += 1;
  }

  /*
    Without `try`. What I launch here comes out of the transaction and reverses it, which is
    exactly what has to happen: `TasteFullError` included. The 409 response is composed outside,
    with the database already intact.
   */
  const profile = await writeTaste(merge.lines);

  /*
    And it notes **what** has been written of each one, now with the file on the disk. It is taken
    from `profile.lines`, which is what `writeTaste` ended up putting —processed through
    `oneLine`, with the scope clean— and not from what was requested: the next reconciliation
    compares against the disk, so what is saved has to be the disk.
    And it searches by the line that **the reconciliation** says each row claimed, not by the text
    of the row. Here it was searching by the text, and that failed precisely in the case that
    matters most: a belief that the person rewrote by hand ends up in the file with **its** text
    and in the database with the previous one —`signBelief` runs afterward—, so it didn't find its
    own line and would mark «never written». The next day, deleting that line stopped preventing
    it —it would be added again as if it had never been there— and blocking it from the screen
    didn't remove it from the file. The same hole opened without touching anything whenever what
    was written differed from what was requested: a sentence with `-->` inside, or a project with
    two colons in the name.
    What came out of the file is marked with nothing, so that its absence is not read as a
    deletion of the person next time.
   */
  const escrito = new Map(profile.lines.map((line) => [lineKey(line), line] as const));
  const gone = new Set(merge.withdrawn);
  await markPublished(database, [
    ...merge.claims
      .filter((claim) => !gone.has(claim.id))
      .map((claim) => {
        const line = escrito.get(lineKey(claim.line));
        return {
          id: claim.id,
          published: line
            ? {
                topic: line.topic,
                statement: line.statement,
                ...(line.scope ? { scope: line.scope } : {}),
              }
            : null,
        };
      }),
    ...retiradas.map((row) => ({ id: row.id, published: null })),
    ...merge.withdrawn.map((id) => ({ id, published: null })),
  ]);

  return Response.json({ signed, vetoed, scoped, resolved, withdrawn, rewritten, profile });
}

/**
 * The signatures required by the body: an ID, and optionally the new text.
 *
 * The loose string is accepted in addition to the object, because 'fix this as is' is the most
 * common gesture and `{"sign":["abc"]}` is what the person writes by hand when testing with
 * `curl`. An object without `statement` means the same.
 */
function signs(value: unknown): { id: string; statement?: string }[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, { id: string; statement?: string }>();
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      out.set(item, { id: item });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row["id"] === "string" ? row["id"] : undefined;
    if (!id) continue;
    const statement = typeof row["statement"] === "string" ? row["statement"].trim() : undefined;
    out.set(id, { id, ...(statement ? { statement } : {}) });
  }
  return [...out.values()];
}

/**
 * The scopes that the body asks for: an ID and which project it is limited to, or `null` for
 * everything.
 *
 * Null is a value and not the absence of one, so it is distinguished from 'don't send it': a
 * missing key and a `identity: null` would mean opposite things—leave it as it is and return it to
 * everything you do—and confusing them would silently expand the scope of a belief to one hundred
 * and twelve projects.
 */
function scopes(value: unknown): { id: string; identity: string | null }[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, { id: string; identity: string | null }>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row["id"] === "string" ? row["id"] : undefined;
    if (!id || !("identity" in row)) continue;
    const identity = typeof row["identity"] === "string" ? row["identity"] : null;
    out.set(id, { id, identity });
  }
  return [...out.values()];
}

/** The resolved proposals: an id and if it is accepted. Without legible `accept`, it is discarded. */
function resolutions(value: unknown): { id: string; accept: boolean }[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, { id: string; accept: boolean }>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row["id"] === "string" ? row["id"] : undefined;
    if (!id) continue;
    out.set(id, { id, accept: row["accept"] === true });
  }
  return [...out.values()];
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) if (typeof item === "string" && item.length > 0) out.add(item);
  return [...out];
}

/**
 * The same key with which reconciliation matches a line with its belief.
 *
 * It is written here again —and it doesn't matter— because what is being compared is what
 * `writeTaste` ended up putting on the disk against what was requested, and that comparison is
 * from this path. The only thing it normalizes is the whitespace, which is what `oneLine`
 * collapses when writing.
 */
function lineKey(line: { topic: string; statement: string; scope?: string }): string {
  return `${line.topic} ${line.scope ? plana(line.scope).replace(/:/g, " ").trim() : ""} ${plana(
    line.statement,
  )}`;
}

/**
 * The same thing that `oneLine` does when writing, letter by letter.
 *
 * Here only the space collapsed. The two replacements were missing, and with them the query failed
 * for any phrase that contained `-->` inside — `writeTaste` leaves it as `-- >`, because a
 * half-open comment eats the rest of the file — and for any scope with colons, which `renderTaste`
 * replaces with a space when composing the `only in X:`. A key that does not match what is written
 * is read as 'this belief did not reach the file,' which is exactly the opposite of what happened.
 */
function plana(value: string): string {
  return value.replace(/\s+/g, " ").replaceAll("<!--", "<! --").replaceAll("-->", "-- >").trim();
}
