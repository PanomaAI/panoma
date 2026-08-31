import { revalidatePath } from "next/cache";
import { addHumanNote, decideNote, resolveProject } from "@panoma/db";
import { anchorNote } from "@/lib/sentinels";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The gate of memory: here the person decides.
 *
 * The agents propose by `/api/agent/notes` with their key; yes, no, editing, and the handwritten
 * note enter only through this door, which requires `sameOrigin` like any interface action.
 * Separation is the design: an agent's key may reach the hands of a process that reads other
 * people's text, and what is approved here is injected to all the agents of the project in their
 * first turn. The decision is not delegated.
 *
 * The cutoff for `DATABASE_URL` is that of `/api/tasks` and for the same reason: in hosted mode,
 * one would have to ask whose project it is before writing a report to them.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.noteMemory") }) },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    // Editing does not exist: to consolidate is to discard and rewrite. See `decideNote`.
    action?: "add" | "approve" | "discard";
    id?: string;
    body?: string;
  };

  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
  const { db: database } = await db();
  const project = await resolveProject(database, { slug: body.slug });
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const done = () => {
    revalidatePath(`/p/${project.slug}`);
    return Response.json({ ok: true });
  };

  switch (body.action) {
    case "add": {
      const result = await addHumanNote(database, { projectId: project.id, body: body.body ?? "" });
      if ("refused" in result) return refusal(locale, result);
      // The customs: the routes that the note mentions and exist today become its sentinels.
      await anchorNote(database, { noteId: result.id, body: body.body ?? "", root: project.root });
      return done();
    }
    case "approve":
    case "discard": {
      if (!body.id) return Response.json({ error: t(locale, "notes.gone") }, { status: 400 });
      const result = await decideNote(database, body.id, body.action === "approve" ? "approved" : "discarded");
      if (!result.decided) {
        if (result.reason === "overBudget" || result.reason === "sleepingFull") {
          return refusal(locale, { refused: result.reason, used: result.used ?? 0, budget: result.budget ?? 0 });
        }
        return Response.json({ error: t(locale, "notes.gone") }, { status: 409 });
      }
      if (body.action === "approve" && result.body) {
        // Also in the re-approval of a challenged one: the current basis is that of the last yes,
        // so the anchors are re-extracted from the SAVED body against today's record — never from
        // what the client says. The trigger travels with them: the basis of a dormant one is its
        // guaranteed foundation and is monitored like any other anchor.
        await anchorNote(database, {
          noteId: body.id,
          body: result.body,
          root: project.root,
          trigger: result.trigger ?? null,
        });
      }
      return done();
    }
    default:
      return Response.json({ error: t(locale, "notes.gone") }, { status: 400 });
  }
}

/** The same no, said in the language of the token, comes from whatever path it comes. */
function refusal(
  locale: Parameters<typeof t>[0],
  result:
    | { refused: "tooLong"; max: number }
    | { refused: "pendingFull"; max: number }
    | { refused: "badTrigger" }
    | { refused: "overBudget"; used: number; budget: number }
    | { refused: "sleepingFull"; used: number; budget: number },
) {
  const message =
    result.refused === "tooLong"
      ? t(locale, "notes.tooLong")
      : result.refused === "overBudget"
        ? t(locale, "notes.overBudget")
        : result.refused === "sleepingFull"
          ? t(locale, "notes.sleepingFull")
          : result.refused === "badTrigger"
            ? /*
                From the file, triggers are not written (yet), but the type forces you to say
                something, and saying something generic would be lying about the reason.
               */
              t(locale, "notes.badTrigger")
            : t(locale, "notes.pendingFull");
  return Response.json({ error: message }, { status: 400 });
}
