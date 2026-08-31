import { revalidatePath } from "next/cache";
import { excludeProject, setHidden, unexcludeProject } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Set aside and remove projects from the catalog.
 *
 * Two actions with very different consequences, and that is why they go with different verbs:
 *
 * - `ocultar` removes the project from the main view. It remains in the catalog, with its record
 * and data, and can be restored with one click.
 * - `excluir` removes it from the catalog and notes the path so that no scan puts it back in. It
 * gets rid of it, but it needs to be scanned again.
 *
 * Neither of them touches the disk. The folder, its code, and its history stay where they are: the
 * only thing that changes is what Panoma knows about them. It is written here and also in the
 * dialogue, because 'erase' is a word that people read with their stomach.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const body = (await request.json().catch(() => ({}))) as {
    action?: "ocultar" | "mostrar" | "excluir" | "readmitir";
    id?: string;
    root?: string;
    /** The name typed by hand. Only for `excluir`. */
    confirmation?: string;
  };

  const { db: database } = await db();

  switch (body.action) {
    case "ocultar":
    case "mostrar": {
      if (!body.id) return Response.json({ error: "Falta 'id'" }, { status: 400 });
      await setHidden(database, body.id, body.action === "ocultar");
      revalidatePath("/", "layout");
      return Response.json({ ok: true });
    }

    case "excluir": {
      if (!body.id) return Response.json({ error: "Falta 'id'" }, { status: 400 });
      /*
        The confirmation is checked **here** as well as in the browser.
        A dialog that requires typing the name is a barrier against the distracted click, and that
        part lives on the client. But the endpoint accepts requests from the CLI and from anything
        that speaks HTTP, so if the only check were in the form, the barrier would be decorative
        for everything that is not the form.
       */
      try {
        const project = await excludeProject(database, body.id, body.confirmation ?? "");
        if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });
        revalidatePath("/", "layout");
        return Response.json({ ok: true, name: project.name, root: project.root });
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
      }
    }

    case "readmitir": {
      if (!body.root) return Response.json({ error: "Falta 'root'" }, { status: 400 });
      await unexcludeProject(database, body.root);
      revalidatePath("/", "layout");
      return Response.json({ ok: true });
    }

    default:
      return Response.json(
        { error: `Acción desconocida: ${body.action ?? "(ninguna)"}` },
        { status: 400 },
      );
  }
}
