import { revalidatePath } from "next/cache";
import { redactSecrets } from "@panoma/core";
import { addHumanNote, decideNote, listProjectNotes, resolveProject, validTrigger } from "@panoma/db";
import { extractNoteAnchors } from "@/lib/sentinels";
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
    where?: string;
  };

  if (!body || typeof body !== "object" || typeof body.slug !== "string" || !body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
  const { db: database } = await db();
  const project = await resolveProject(database, { slug: body.slug });
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const done = () => {
    revalidatePath(`/p/${project.slug}`);
    return Response.json({ ok: true });
  };

  switch (body.action) {
    case "add": {
      if (typeof body.body !== "string") return refusal(locale, { refused: "tooLong", max: 500 });
      if (body.where !== undefined && (typeof body.where !== "string" || !validTrigger(body.where.trim()))) {
        return refusal(locale, { refused: "badTrigger" });
      }
      const text = redactSecrets(body.body.trim());
      if (text.length === 0 || text.length > 500) return refusal(locale, { refused: "tooLong", max: 500 });
      const trigger = body.where?.trim() || null;
      const sentinels = await extractNoteAnchors({ body: text, root: project.root, trigger });
      const result = await addHumanNote(database, { projectId: project.id, body: text, ...(trigger ? { trigger } : {}), sentinels });
      if ("refused" in result) return refusal(locale, result);
      return done();
    }
    case "approve":
    case "discard": {
      if (typeof body.id !== "string" || !body.id) return Response.json({ error: t(locale, "notes.gone") }, { status: 400 });
      // Read the immutable body within this project before calculating its replacement anchors.
      const notes = await listProjectNotes(database, project.id, ["approved", "proposed", "challenged"]);
      const note = notes.find((item) => item.id === body.id);
      if (!note) return Response.json({ error: t(locale, "notes.gone") }, { status: 409 });
      const sentinels = body.action === "approve"
        ? await extractNoteAnchors({ body: note.body, root: project.root, trigger: note.trigger })
        : undefined;
      const result = await decideNote(database, body.id, body.action === "approve" ? "approved" : "discarded", {
        projectId: project.id,
        ...(sentinels ? { sentinels } : {}),
      });
      if (!result.decided) {
        if (result.reason === "overBudget" || result.reason === "sleepingFull") {
          return refusal(locale, { refused: result.reason, used: result.used ?? 0, budget: result.budget ?? 0 });
        }
        return Response.json({ error: t(locale, "notes.gone") }, { status: 409 });
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
            ? t(locale, "notes.badTrigger")
            : t(locale, "notes.pendingFull");
  return Response.json({ error: message }, { status: 400 });
}
