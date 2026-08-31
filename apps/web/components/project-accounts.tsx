"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineKey, HiOutlinePencilSquare } from "react-icons/hi2";
import { normalizeAccountUrl } from "@/lib/account-url";
import { rowsToEdit, type AccountEntry } from "@/lib/accounts";
import { postJson } from "@/lib/api";
import { useT } from "./i18n-provider";
import { useCopied } from "./use-copied";
import { ActionError } from "./primitives";

/*
  The project's accounts and links: the non-secret half of 'resume'.
  You come back after eight months and what is missing is never in the code: with which email it
  is deployed, where the domain lives, what the test Stripe dashboard was. This is noted once and
  Panoma remembers — that is the deal of the entire product.
  It lives in two places with two roles: the compact card in the fixed column (the day-to-day
  links, always one click away) and the ‘Accounts’ view in the menu (the editor with space). They
  are two places and a single gesture: wherever you click, pointing ends with the cursor inside an
  empty row.
  The favicon is requested DIRECTLY from the destination —`https://host/favicon.ico`—, never from
  a third-party service: the destination has already been chosen by the user when pointing to it;
  telling Google which panels each project uses, no.
 */

export type { AccountEntry };

/**
 * The notice that opens the editor from outside.
 *
 * A browser event and not a shared state because the column card and the view editor are two
 * separate islands of the same page, with no one in common above. It is the same resource that the
 * top bar searcher uses.
 */
const OPEN_EDITOR = "panoma:accounts";

/**
 * The rows that cannot be saved as they are, for their two reasons.
 *
 * The indexes are stored and not a boolean per row because the notice has to say **which one**:
 * 'there is a link that is not understood' without indicating where, forcing you to review twenty
 * rows by eye, which is almost as bad as not warning.
 */
interface Problems {
  urls: number[];
  labels: number[];
}

const NONE: Problems = { urls: [], labels: [] };

/**
 * What's wrong before sending anything.
 *
 * The two cases are the same failure with two disguises: something the person wrote would fall
 * along the way without saying anything. The link was dropped by normalization; the nameless row
 * is dropped by the `save` filter, with the link and the email inside.
 */
function review(rows: AccountEntry[]): Problems {
  const urls: number[] = [];
  const labels: number[] = [];
  rows.forEach((entry, i) => {
    if (normalizeAccountUrl(entry.url).kind === "unusable") urls.push(i);
    const written = [entry.url, entry.email, entry.note].some((value) => value?.trim());
    if (written && !entry.label.trim()) labels.push(i);
  });
  return { urls, labels };
}

/** When writing in a field, its mark is removed: the notice returns when saving, if it continues. */
function forget(current: Problems, at: number, field: keyof AccountEntry): Problems {
  if (field !== "label" && field !== "url") return current;
  const key = field === "label" ? "labels" : "urls";
  if (!current[key].includes(at)) return current;
  return { ...current, [key]: current[key].filter((i) => i !== at) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The destination logo, with the backup initial when the site does not serve a favicon. */
function Favicon({ url, label }: { url?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const origin = (() => {
    try {
      return url ? new URL(url).origin : undefined;
    } catch {
      return undefined;
    }
  })();

  if (!origin || failed) {
    return (
      <span className="project-account-chip" aria-hidden>
        {(label.trim()[0] ?? "·").toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="project-account-favicon"
      src={`${origin}/favicon.ico`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** A link that opens in the browser, with its logo and its copy button next to it. */
function AccountLink({ entry }: { entry: AccountEntry }) {
  const translate = useT();
  const { copied, copy } = useCopied();

  return (
    <li className="project-account-row">
      <Favicon url={entry.url} label={entry.label} />
      <div className="project-account-body">
        <strong>{entry.label}</strong>
        {entry.url && (
          <span className="project-account-line">
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              /* Let no handler of the page take it: this click goes to the browser. */
              onClick={(event) => event.stopPropagation()}
            >
              {hostOf(entry.url)}
            </a>
            <button type="button" onClick={() => copy(entry.url!)} title={entry.url}>
              {copied ? translate("accounts.copied") : "⧉"}
            </button>
          </span>
        )}
        {entry.email && (
          <span className="project-account-line">
            <code>{entry.email}</code>
            <button type="button" onClick={() => copy(entry.email!)}>
              {copied ? translate("accounts.copied") : "⧉"}
            </button>
          </span>
        )}
        {entry.note && <span className="project-accounts-note">{entry.note}</span>}
      </div>
    </li>
  );
}

/**
 * The compact card of the fixed column: read-only, the everyday links. Edit sends to the
 * «Accounts» view, which is what the site is for.
 */
export function ProjectAccountsQuick({ entries }: { entries: AccountEntry[] }) {
  const translate = useT();
  return (
    <div className="project-accounts">
      {entries.length === 0 ? (
        <p className="project-muted-message">{translate("accounts.empty")}</p>
      ) : (
        <ul className="project-accounts-list">
          {entries.slice(0, 6).map((entry, i) => (
            <AccountLink key={`${entry.label}:${i}`} entry={entry} />
          ))}
        </ul>
      )}
      <a
        className="project-accounts-go"
        href="#accounts"
        /*
          The anchor changes view; the notice opens the editor from there. Without the second,
          «point the first» led to another identical «point the first».
         */
        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EDITOR))}
      >
        <HiOutlinePencilSquare className="h-3.5 w-3.5" aria-hidden />
        {translate(entries.length === 0 ? "accounts.addFirst" : "accounts.editList")}
      </a>
    </div>
  );
}

/** The full editor, for the 'Accounts' view in the menu. */
export function ProjectAccounts({
  slug,
  initial,
}: {
  slug: string;
  initial: AccountEntry[];
}) {
  const translate = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [entries, setEntries] = useState<AccountEntry[]>(initial);
  const [state, setState] = useState<"ready" | "saving">("ready");
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problems>(NONE);
  const firstField = useRef<HTMLInputElement>(null);

  /* Opening the editor is leaving where to write: with the empty list you have to put the row. */
  const open = useCallback(() => {
    setEntries(rowsToEdit);
    setEditing(true);
  }, []);

  /* The same gesture, pressed on the card in the column. */
  useEffect(() => {
    window.addEventListener(OPEN_EDITOR, open);
    return () => window.removeEventListener(OPEN_EDITOR, open);
  }, [open]);

  /*
    And the cursor inside the first field, which is what it came down to.
    With a waiting turn and not in the effect itself: whoever arrives from the card changes
    section with the anchor, and that section is activated by another component upon hearing the
    `hashchange`. Focusing on something that is still hidden does nothing and gives no warning.
   */
  useEffect(() => {
    if (!editing) return;
    const wait = setTimeout(() => firstField.current?.focus(), 0);
    return () => clearTimeout(wait);
  }, [editing]);

  function update(at: number, field: keyof AccountEntry, value: string) {
    setEntries((current) =>
      current.map((entry, i) => (i === at ? { ...entry, [field]: value } : entry)),
    );
    /* Whoever is fixing the line stops having the notice on top while they write. */
    setProblems((current) => forget(current, at, field));
  }

  async function save() {
    /*
      Look before saving, and if something is not understood, save nothing. What was written stays
      in its field and the row is indicated: discarding it silently —which is what happened—
      leaves the user with the mutilated list and no way of knowing it.
     */
    const found = review(entries);
    setProblems(found);
    if (found.urls.length > 0 || found.labels.length > 0) {
      setError(null);
      return;
    }

    setState("saving");
    setError(null);
    const cleaned = entries
      .filter((entry) => entry.label.trim())
      .map((entry) => {
        const link = normalizeAccountUrl(entry.url);
        return { ...entry, url: link.kind === "url" ? link.url : undefined };
      });
    const result = await postJson<Record<string, never>>(
      "/api/accounts",
      { slug, accounts: cleaned },
      translate("project.unreachable"),
    );
    if (result.ok) {
      setEntries(cleaned);
      setEditing(false);
      router.refresh();
    } else {
      setError(result.message);
    }
    setState("ready");
  }

  if (!editing) {
    return (
      <div className="project-accounts project-accounts--full">
        {entries.length === 0 ? (
          <p className="project-muted-message">{translate("accounts.empty")}</p>
        ) : (
          <ul className="project-accounts-list">
            {entries.map((entry, i) => (
              <AccountLink key={`${entry.label}:${i}`} entry={entry} />
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={open}
          className="mt-3 inline-flex items-center gap-1.5 rounded border border-edge px-2.5 py-1 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent"
        >
          <HiOutlinePencilSquare className="h-3.5 w-3.5" aria-hidden />
          {translate(entries.length === 0 ? "accounts.addFirst" : "accounts.edit")}
        </button>
      </div>
    );
  }

  return (
    <div className="project-accounts project-accounts--full">
      <div className="project-accounts-form">
        {entries.map((entry, i) => (
          <div key={i} className="project-accounts-row">
            <input
              ref={i === 0 ? firstField : undefined}
              value={entry.label}
              onChange={(e) => update(i, "label", e.target.value)}
              placeholder={translate("accounts.label")}
              maxLength={80}
              aria-invalid={problems.labels.includes(i) || undefined}
            />
            <input
              value={entry.url ?? ""}
              onChange={(e) => update(i, "url", e.target.value)}
              /*
                The hole shows the three shapes that matter, and the third is the one that was
                swallowed before without saying anything.
               */
              placeholder="vercel.com/… · localhost:3000"
              maxLength={300}
              aria-invalid={problems.urls.includes(i) || undefined}
            />
            <input
              value={entry.email ?? ""}
              onChange={(e) => update(i, "email", e.target.value)}
              placeholder={translate("accounts.email")}
              maxLength={120}
            />
            <input
              value={entry.note ?? ""}
              onChange={(e) => update(i, "note", e.target.value)}
              placeholder={translate("accounts.note")}
              maxLength={300}
            />
            <button
              type="button"
              onClick={() => setEntries((c) => c.filter((_, j) => j !== i))}
              aria-label={translate("accounts.remove")}
              className="text-faint transition-colors hover:text-fail"
            >
              ×
            </button>
          </div>
        ))}
        <div className="project-accounts-actions">
          <button
            type="button"
            onClick={() => setEntries((c) => [...c, { label: "" }])}
            disabled={entries.length >= 24}
            className="rounded border border-edge px-2.5 py-1 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {translate("accounts.addRow")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={state === "saving"}
            className="rounded border border-accent bg-accent px-2.5 py-1 font-mono text-[11px] text-white transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {translate(state === "saving" ? "accounts.saving" : "accounts.save")}
          </button>
          <button
            type="button"
            onClick={() => {
              setEntries(initial);
              setProblems(NONE);
              setError(null);
              setEditing(false);
            }}
            className="font-mono text-[11px] text-faint transition-colors hover:text-smoke"
          >
            {translate("accounts.cancel")}
          </button>
        </div>
        {/* The warning that matters: this is not a vault. */}
        <p className="project-accounts-warning">
          <HiOutlineKey className="h-3.5 w-3.5" aria-hidden />
          {translate("accounts.noSecrets")}
        </p>
        {problems.urls.length > 0 && (
          <ActionError text={translate("accounts.badUrl")} />
        )}
        {problems.labels.length > 0 && (
          <ActionError text={translate("accounts.needsLabel")} />
        )}
        {error && <ActionError text={error} />}
      </div>
    </div>
  );
}
