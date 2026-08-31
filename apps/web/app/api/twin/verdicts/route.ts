import {
  deleteVerdicts,
  listVerdicts,
  projectNamesByIdentity,
  resolveProject,
  remapObservations,
  saveVerdicts,
} from "@panoma/db";
import { db } from "@/lib/db";
import { readLimit } from "@/lib/distill";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { MAX_REACTIONS, distinctCwds, readBatch, toVerdicts } from "@/lib/verdicts";

/**
 * Where the verdicts that `panoma twin mine --save` takes from the disk end up.
 *
 * The command mines on the machine, because that's where the 1.5 GB of Claude Code and the 3.63 GB
 * of Codex are, and **it does not write to the database**. That is the single-writer rule, and it
 * is not manual doctrine: the catalog got corrupted for breaking it, and header of
 * `packages/db/src/queue.ts` tells how. PGlite allows one process and only one, so the web server
 * is the owner of the database and everything else talks to it through HTTP — the CLI through
 * `/api/ingest`, the MCP server through `packages/mcp/src/client.ts`, and this through here. A
 * shortcut from the CLI to the database would create a second writer, and a second writer does not
 * give an error: it leaves the data directory halfway and it is noticed a week later.
 *
 * ── The guards, and the one that is not ────────────────────────────────────────────────
 *
 * `sameOrigin`, like any route it writes: an open tab in another place can send a POST to
 * `localhost:4173` with a form and without asking anyone for permission.
 *
 * **It does not carry `isLocalServer` **, and it is worth explaining why, because the two most
 * similar routes —`/api/agent/keys` and `/api/agent/mcp` — do carry it. They carry it because of
 * what they do, not because of what they receive: the first **issues a credential without
 * authenticating anyone** and the second **writes to the disk of this machine**. Both stop making
 * sense —and the first becomes a hole— as soon as Panoma is deployed somewhere. This one does
 * neither of those things: it inserts rows into the catalog, which is precisely the resource that
 * API owns, and it attaches them to an identity that already existed. It is the same way as
 * `/api/ingest`, which brings the entire catalog and does not carry it either.
 *
 * And there is one more reason not to put it: it wouldn’t protect what it seems. `isLocalServer`
 * looks at the hostname of **the URL of the request**, which is that of the server itself, so it
 * replies “am I local?” and not “who is calling me?” — its own header says this in
 * `lib/agent-auth.ts`, where it was written that for a while it was used as if it were the latter
 * and protected nothing. Putting it here to guard the most intimate that Panoma keeps would be
 * repeating that mistake with the feeling of having closed it. The day this has to say no to a
 * stranger, what will be needed is authentication.
 *
 * ── From `cwd` to the project, once per route and not once per sentence ───────────────────
 *
 * Each reaction brings the `cwd` raw from the transcript, and parser rule 7 warns that it is
 * almost never the root: what is measured is `anotes/apps/web`, `humo_check/frontend`,
 * `dricopilot/ios`. `resolveProject` already climbs up the tree to the deepest root that is a
 * prefix, so there is nothing to trim by hand here — but you should avoid asking it a thousand
 * times. On the corpus of this machine, 2,009 reactions from Claude Code and 1,431 from Codex are
 * distributed among 26-28 different routes: the different ones are resolved, stored in a map, and
 * the translation is done against the map.
 *
 * What it does not resolve —or resolves to a project whose `identity` is still `null`, which is
 * normal until an intake assigns it— is counted as `unmatched` and skipped silently. It is the
 * contract followed by anyone who writes by identity in `queries.ts`: `saveBuildCheck` does
 * `if (!project?.identity) return;` and keeps silent. It is not resignation, it is that this
 * project may enter the catalog tomorrow and the same reaction will then be kept without
 * duplicating anything, because the `id` of the verdict is deterministic and the identity does not
 * enter into it.
 *
 * ── The five numbers, and why they are five ──────────────────────────────────────
 *
 * `saved` are the truly new rows; `duplicates` are those that were already there or came repeated
 * within the same batch. The distinction is made by `saveVerdicts`, which returns what was
 * inserted precisely so that one can say '12 new, 300 were already there' instead of '312 saved,'
 * which would be a lie told with a number.
 *
 * For the same reason, there is a fifth: `undated`. With only four, the reactions that fail for
 * not having `timestamp` would disappear from the count, and `saved + duplicates + unmatched`
 * would give less than what was sent without anything explaining it — the same silence that this
 * product spends the funnel of `twin mine` teaching not to have. And it is a different discard
 * from `unmatched`: that one is fixed by scanning that folder, this one is never fixed, because
 * the line of the transcript did not have the time.
 *
 * ── Nothing is crossed out here ───────────────────────────────────────────────────────
 *
 * The quotes arrive already written by `redactQuote`, in the parser, which is the only place where
 * the writing comes before the trim. A second pass through here would not cover anything that
 * wasn't already covered and would indeed ruin real quotes. They are copied byte by byte; the
 * reason, with the measurement behind it, is in header of `lib/verdicts.ts`.
 *
 * ── Without `queueWrite`, unlike the intake ─────────────────────────────────
 *
 * The queue exists to serialize ingestions, which delete and reinsert the rows of an entire
 * project: two overlapping ones get mixed. This is a `insert` idempotent with
 * `onConflictDoNothing` on a table that no ingestion touches —`verdicts` doesn't even have a
 * foreign key, and the header of the schema explains why—, so enqueuing it would only make saving
 * a handful of sentences wait behind a scan of eighty projects.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const batch = readBatch(await request.json().catch(() => undefined));
  if (batch.kind === "tooMany") {
    /*
      It is rejected with the figure given instead of keeping the first five hundred. A silent cut
      here would be worse than a mistake: whoever calls would print "saved" over a total that
      never arrived, and those that are missing would not be noticed until someone counted the
      rows by hand.
     */
    return Response.json(
      { error: t(locale, "verdicts.tooMany", { n: batch.sent, cap: MAX_REACTIONS }) },
      { status: 400 },
    );
  }
  if (batch.kind !== "batch") {
    return Response.json({ error: t(locale, "verdicts.malformed") }, { status: 400 });
  }

  const { db: database } = await db();

  const identities = new Map<string, string>();
  for (const cwd of distinctCwds(batch.reactions)) {
    const project = await resolveProject(database, { cwd });
    // `identity` is nullable until an intake assigns it, and without it there is no row.
    if (project?.identity) identities.set(cwd, project.identity);
  }

  const { rows, undated, unmatched, projects } = toVerdicts(batch.reactions, identities);
  const { inserted, remapped } = await saveVerdicts(database, rows);
  /*
    And the phrases from the portrait follow their quotes. The label 'learned in X' was attached
    when distilling by copying the identity of their verdicts, and it is with that that the person
    decides if a phrase is valid outside of where it was learned — leaving it pointing to a
    project that no one defends anymore turns that decision into a guess.
    Without conditioning it on this batch having moved anything, although the temptation is
    obvious. That shortcut is correct today and false the day the appointments are reassigned by
    another path, and it has already happened once: the two arrangements —the assigner and this
    repositioning— arrived in different sweeps, so when the second one existed, the first one had
    nothing left to move and the phrases ended up pointing to the wrong project. It takes two
    queries on a table of dozens of rows; the correction that skips one case costs more.
   */
  const restated = await remapObservations(database);

  return Response.json({
    saved: inserted,
    duplicates: rows.length - inserted,
    /*
      Those that were already there and have changed projects. They are counted separately from
      `saved` because they are not the same: added together, a repeated sweep would say that four
      hundred new appointments came in when what happened is that four hundred were misattributed
      and no longer are.
     */
    remapped,
    /** Portrait phrases that have changed projects because their quotes did. */
    restated,
    unmatched,
    undated,
    // The addressed projects, counted over the built rows and not over the new ones: a repeated
    // sweep touches the same ones even if it does not insert any.
    projects,
  });
}

/**
 * How many lines go in an answer when no one asks for anything else, and how many at most.
 *
 * A default cap is exactly what `listVerdicts` refuses to have, and with good reason: it would
 * quietly trim a list that the caller believes is complete. Here it does not trim quietly because
 * `total` travels alongside, and that is the whole difference — '200 of 2,604' is an honest
 * answer; '200' alone is what that header forbids. Exceeding the ceiling is rejected rather than
 * trimmed, so that the message can tell the truth about what is admitted.
 */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;

/**
 * Read what was saved, which until now could not be done.
 *
 * It is the missing half: there are 2,604 verdicts in the catalog of this machine, they all came
 * in through the POST above and there was no way to take out even one. Without this, the review
 * screen does not exist, and without a review screen, the three states of `accepted` are useless —
 * no one can say 'this is me' about a sentence they cannot read.
 *
 * ── The three states, written in an address bar ──────────────────────
 *
 * `accepted` counts as three: `true` the signed ones, `false` the rejected ones, `pending` the
 * ones that nobody has looked at yet —the `null` of the column, which is the state in which the
 * vast majority will live forever—. Without the parameter, nothing is filtered. It is also allowed
 * to write `null`, which is the name of the column and is what the person who comes from reading
 * the diagram will type; `pending` is the word because `accepted=null` in a URL seems like a
 * mistake of the one who built it.
 *
 * What is not allowed is a value that is none of those: it responds 400. Ignoring a filter that
 * someone wrote returns **more** rows than requested, and the screen that was thought to be
 * showing the pending would show the rejected without anyone being notified.
 *
 * ── The filter by source is done here, and it is said ────────────────────────────────
 *
 * `listVerdicts` knows how to filter by identity and by review, not by source, and a column will
 * not be added to `where` from a path: the rows are crossed in memory. There are a few thousand in
 * a local database on the computer itself, and the cost of reading them all is the same as what
 * anyone using the catalog screens already pays. The day this is a hundred thousand, what needs to
 * be moved is the query, not this comment.
 *
 * The same guards as the POST, and for the same reasons: the header above argues them fully. That
 * this only reads does not make it harmless — what it returns are the most intimate phrases that
 * Panoma keeps, and an open tab elsewhere does not necessarily have the right to request them.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const params = new URL(request.url).searchParams;

  const asked = params.get("accepted");
  const accepted = readAccepted(asked);
  if (accepted.kind === "bad") {
    return Response.json(
      { error: t(locale, "verdicts.badAccepted", { value: String(asked) }) },
      { status: 400 },
    );
  }

  const limit = readLimit(params.get("limit"), MAX_LIMIT);
  if (limit.kind === "bad") {
    return Response.json(
      { error: t(locale, "api.badLimit", { value: limit.value, cap: MAX_LIMIT }) },
      { status: 400 },
    );
  }

  /*
    The same closed list as the deletion, because they are the same sources that the column
    allows. Validating it is what separates 'that source does not exist' from returning zero rows
    as if the catalog were empty.
   */
  const source = params.get("source");
  if (source && !FORGETTABLE.includes(source)) {
    return Response.json(
      {
        error: t(locale, "verdicts.unknownSource", {
          source,
          sources: FORGETTABLE.join(", "),
        }),
      },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  const rows = await listVerdicts(
    database,
    accepted.kind === "filter" ? { accepted: accepted.accepted } : {},
  );
  const matching = source ? rows.filter((row) => row.source === source) : rows;

  return Response.json({
    verdicts: matching.slice(0, limit.kind === "limit" ? limit.limit : DEFAULT_LIMIT),
    // The total is based on what matches the filters and before the cap: it is what turns the cut
    // into a page and not into a mutilated list.
    total: matching.length,
    // The name of each identity. It goes separately and not inside each row because a verdict does
    // not own the name of its project: the identity is what is archived and stable, and the name is
    // what is seen today on the disk. Whoever renders the screen uses the name if it is there and
    // the identity if not, which is exactly what happens with a project that was deleted after
    // having been mined.
    names: await projectNamesByIdentity(database),
  });
}

/** What has been understood from the review filter. `any` is 'do not filter'. */
type AcceptedRead =
  | { kind: "any" }
  | { kind: "filter"; accepted: boolean | null }
  | { kind: "bad" };

function readAccepted(value: string | null): AcceptedRead {
  if (value === null || value === "") return { kind: "any" };
  if (value === "true") return { kind: "filter", accepted: true };
  if (value === "false") return { kind: "filter", accepted: false };
  if (value === "pending" || value === "null") return { kind: "filter", accepted: null };
  return { kind: "bad" };
}

/** The sources whose verdicts can be forgotten all at once. `all` erases them all. */
const FORGETTABLE = ["claude-code", "codex", "interview", "critic", "director"];

/**
 * Forget what has been saved.
 *
 * It is the other half of the permission, and without it `panoma twin revoke` only closes the
 * front door leaving inside everything that has already entered. Whoever regrets having allowed
 * their history to be read is not asking for it to stop being read: they are asking for it not to
 * exist.
 *
 * `source` is mandatory and is validated against a closed list, with `all` being the only way to
 * delete everything. An empty `DELETE` that would empty the table would be a poorly copied `curl`
 * just a click away, and this table cannot be reconstructed from the disk: it is mined again, yes,
 * but what was marked as accepted does not come back.
 */
export async function DELETE(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as { source?: unknown };
  const source = typeof body.source === "string" ? body.source : "";

  if (source !== "all" && !FORGETTABLE.includes(source)) {
    return Response.json(
      {
        error: t(locale, "verdicts.badSource", {
          source: source || "—",
          sources: FORGETTABLE.join(", "),
        }),
      },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  const forgotten = await deleteVerdicts(database, source === "all" ? {} : { source });

  return Response.json({ forgotten });
}
