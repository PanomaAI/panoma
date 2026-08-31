import {
  consentState,
  inventoryHistory,
  isAllowed,
  readConsent,
  readableSources,
  setConsent,
  type ConsentState,
  type HistorySourceId,
} from "@panoma/core";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The first gesture of all: what stories are in this machine and which ones can be opened.
 *
 * It was missing, and it was the hole in the first screen. `panoma twin sources` measures the disk
 * without opening anything and `panoma twin allow <fuente>` saves the yes, but both things were
 * only from the terminal — so the portrait screen, with the empty catalog, could do nothing more
 * than send you to type a command. A product whose first step is a terminal command does not have
 * a first step: it has a prerequisite.
 *
 * ── It is measured without opening a single file ───────────────────────────────────────────
 *
 * `inventoryHistory` uses `stat`: it counts files and bytes and doesn't read a single line. That
 * distinction is what supports this entire screen — you can say "Claude Code: 778 files, 1.7 GB"
 * **before** having permission to open them, and without it the permission would be requested in
 * the abstract. No one decides on "your history"; it is decided on 1.7 GB with a name in front.
 *
 * ── The yes is by source, and the no is the default value ────────────────────────
 *
 * Reading Claude Code is not reading Codex: they are different tools, often from different
 * clients. The full reason is in header of `history/consent.ts`. What matters here is that the
 * POST touches **one** source and never all: a 'allow all' button turns five decisions into one,
 * and whoever has to choose between everything and nothing chooses wrong.
 *
 * ── You can look from the phone; decide, no ──────────────────────────────────
 *
 * The GET carries only `sameOrigin`, and the POST also carries `localOperatorOnly`. The asymmetry
 * is the doctrine of `lib/guard.ts` applied to the most intimate case there is: the key of
 * `panoma up --network` allows **viewing** the catalog from the mobile, not putting hands on this
 * machine's keyboard. To see what stories exist and the state of each permission is to view.
 * Granting one is deciding that this computer opens 1.78 GB of private conversation, and nobody
 * who is not sitting in front of it does that. The key travels in a link and stays on the
 * clipboard of the person who shares it, so 'having the key' does not mean 'being the person'.
 *
 * ── Revoking does not erase ────────────────────────────────────────────────────────────
 *
 * Removing permission closes the door and leaves inside what has already entered. It is the truth
 * and it must be said on the screen itself, because the word "revoke" promises something else;
 * what it erases is `panoma twin forget`. Half a promise on a privacy screen is a false promise.
 */

/** What is taught from each story. None of this requires having opened a file. */
export interface SourceView {
  id: HistorySourceId;
  label: string;
  path: string;
  present: boolean;
  files: number;
  bytes: number;
  state: ConsentState;
}

async function snapshot(): Promise<{ sources: SourceView[]; updatedAt?: string }> {
  const [found, consent] = await Promise.all([inventoryHistory(), readConsent()]);
  const readable = readableSources();

  const sources = found.map((source) => ({
    id: source.id,
    label: source.label,
    path: source.path,
    present: source.present,
    files: source.files,
    bytes: source.bytes,
    state: consentState(source, isAllowed(consent, source.id), readable.includes(source.id)),
  }));

  return { sources, ...(consent.updatedAt ? { updatedAt: consent.updatedAt } : {}) };
}

export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  return Response.json(await snapshot());
}

export async function POST(request: Request) {
  // You can look from the network; granting, only from this machine. See the header.
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    allowed?: unknown;
  };

  /*
    The two mandatory keys with no default value for either. A missing `allowed` taken as `true`
    would grant access to someone's history due to a poorly constructed body, and that is the only
    flaw in this path from which there is no return: when it is discovered, it has already been
    read. A missing `source` cannot fall into 'all' for the same reason.
   */
  const source = typeof body.source === "string" ? body.source : undefined;
  const allowed = typeof body.allowed === "boolean" ? body.allowed : undefined;
  if (source === undefined || allowed === undefined) {
    return Response.json({ error: t(locale, "twin.consentMalformed") }, { status: 400 });
  }

  /*
    And the source has to be one of those named in the inventory. `setConsent` already rules out
    what it doesn't know —the asymmetry documented in `consent.ts` — but silently ruling it out
    here would respond "done" about a permission that was not saved.
   */
  const found = await inventoryHistory();
  const known = found.find((one) => one.id === source);
  if (known === undefined) {
    return Response.json(
      { error: t(locale, "twin.consentUnknown", { source }) },
      { status: 400 },
    );
  }

  await setConsent(known.id, allowed);
  return Response.json(await snapshot());
}
