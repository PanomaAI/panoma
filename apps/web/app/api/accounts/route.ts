import { getProject, saveProjectAccounts, type ProjectAccount } from "@panoma/db";
import { revalidatePath } from "next/cache";
import { normalizeAccountUrl } from "@/lib/account-url";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The project's accounts and links: the half NOT secret to resume.
 *
 * Which email the Vercel account is with, where the domain lives, the Stripe dashboard — the
 * metadata that is missing after returning after eight months. Passwords and keys do NOT belong
 * here and the interface says it: this table travels in clear text through the catalog, and the
 * place for a secret is the system Keychain (separate phase, with another ribbon).
 *
 * The list is replaced entirely: the interface edits the complete list, and sending patches always
 * ends up in the duplicate dance.
 */
const MAX_ENTRIES = 24;

function clean(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, limit);
  return text || undefined;
}

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    accounts?: unknown;
  };
  if (!body.slug || !Array.isArray(body.accounts)) {
    return Response.json({ error: t(locale, "accounts.missingInput") }, { status: 400 });
  }
  if (body.accounts.length > MAX_ENTRIES) {
    return Response.json({ error: `Como mucho ${MAX_ENTRIES} entradas.` }, { status: 400 });
  }

  const accounts: ProjectAccount[] = [];
  for (const raw of body.accounts as Record<string, unknown>[]) {
    const label = clean(raw?.["label"], 80);
    if (!label) continue;
    /*
      The same rule that the editor applies, and from the same place: when this was a regular
      expression copied here, the two copies could be separated without anyone noticing. And if it
      is not understood, it is answered with an error instead of saving the row without its link:
      losing what was noted without saying it is the opposite of the agreement.
     */
    const link = normalizeAccountUrl(clean(raw?.["url"], 300));
    if (link.kind === "unusable") {
      return Response.json(
        { error: t(locale, "accounts.badUrlAt", { label }) },
        { status: 400 },
      );
    }
    const entry: ProjectAccount = { label };
    if (link.kind === "url") entry.url = link.url;
    const email = clean(raw?.["email"], 120);
    if (email) entry.email = email;
    const note = clean(raw?.["note"], 300);
    if (note) entry.note = note;
    accounts.push(entry);
  }

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  await saveProjectAccounts(database, data.project.id, accounts);
  revalidatePath("/", "layout");
  return Response.json({ ok: true, saved: accounts.length });
}
