"use client";

import { useState } from "react";
import {
  HiOutlineSparkles,
  HiOutlineCheckCircle,
  HiOutlineClipboard,
  HiOutlineKey,
} from "react-icons/hi2";
import { postJson } from "@/lib/api";
import { BRAND_ICONS } from "./brand-icons";
import { useOpenTarget } from "./use-open-target";
import { useT } from "./i18n-provider";
import { useCopied } from "./use-copied";
import { ActionButton, ActionError } from "./primitives";

/**
 * Connect an agent to the catalog from here, without going to the terminal.
 *
 * Panoma already knew which agents you have — it detects them `GET /api/open` by looking at PATH
 * and inside the desktop apps — and it already knew how to create keys and compose the MCP block.
 * The only thing missing was for these three things to communicate, so the "Agents" page sent you
 * to copy a command to the terminal for something the application could do on its own.
 *
 * What they **do not** do, on purpose: promise. There are agents whose files we know and we know
 * how to write without breaking anything — the JSON merges, Codex's TOML is added at the end — and
 * that's where it is written; there are files we do not dare to touch — a TOML that doesn't parse,
 * a manually made entry — and there the fragment is shown with its path and a button that opens
 * the file in your editor; and there are agents whose server locations we do not know, and there
 * the block is shown **without inventing a path**.
 */

type Result =
  | { wrote: true; file: string; replaced?: boolean; coexists: string[]; exposedToGit?: boolean }
  | { wrote: false; file: string | null; snippet: string; reason?: string };

export function ConnectAgent({
  connected,
  active,
  ephemeral,
}: {
  /** Has a row in the catalog: a key was issued for it. */
  connected: string[];
  /** Has actually been in — `last_seen_at` is set. A subset of `connected`, never the same thing. */
  active: string[];
  /** This catalog runs from npx, so nothing durable may be written. See `AgentRow`. */
  ephemeral: boolean;
}) {
  const t = useT();
  const { agents, remote } = useOpenTarget();

  /*
    Remotely the agents are on another machine and their configuration as well: writing here would
    not connect anything. It is the same reason why the open buttons are not rendered.
   */
  if (remote) return null;

  const usable = agents.filter((agent) => !agent.broken);
  if (usable.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold tracking-tight">
        {t("connect.title")}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-smoke">{t("connect.lead")}</p>
      <ul className="mt-5 grid gap-3">
        {usable.map((agent) => (
          <AgentRow
            key={agent.id}
            id={agent.id}
            name={agent.name}
            already={connected.includes(agent.id)}
            live={active.includes(agent.id)}
            ephemeral={ephemeral}
          />
        ))}
      </ul>
    </section>
  );
}

function AgentRow({
  id,
  name,
  already,
  live,
  ephemeral,
}: {
  id: string;
  name: string;
  /** It already has a record in the catalog, from a previous connection. See header. */
  already: boolean;
  /**
   * And it has used it at least once, which is a different question and the one the word
   * «connected» was answering wrongly.
   */
  live: boolean;
  /** Running from npx: what would be written outlives what would be pointed at. */
  ephemeral: boolean;
}) {
  const t = useT();
  const Icon = BRAND_ICONS[id] ?? HiOutlineSparkles;
  const [state, setState] = useState<"ready" | "working">("ready");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopied();
  const [opened, setOpened] = useState<string | null>(null);

  /*
    The output of the 'you paste this': open the file in the editor, with the path decided by the
    server. Without this, the most motivated user would be left staring at the fragment without
    knowing what the next move was.
   */
  async function openFile() {
    setError(null);
    const result = await postJson<{ with?: string }>(
      "/api/open",
      { config: id },
      t("project.unreachable"),
    );
    if (result.ok) setOpened(result.data.with ?? "");
    else setError(result.message);
  }

  async function connect() {
    setState("working");
    setError(null);
    const answer = await postJson<Result>(
      "/api/agent/mcp",
      { agent: id, name },
      t("project.unreachable"),
    );
    if (answer.ok) setResult(answer.data);
    else setError(answer.message);
    setState("ready");
  }

  /*
    Three states where there were two, because two could not tell the truth.
    `already` is a row in `agents`: a key was issued for this agent. `live` is `last_seen_at`: it
    has actually called at least once. The badge used to print «connected» for the first, which is
    the claim the bridge contradicted two clicks away — and the bridge was right.
    `result` is the third: we just wrote it on this screen, so a key exists and of course nothing
    has used it yet. It counts as issued, not as in.
   */
  const hasKey = already || result !== null;
  const hasEntered = live;


  return (
    <li className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon aria-hidden className="h-5 w-5 text-smoke" />
        <strong className="font-display text-base font-semibold tracking-tight">{name}</strong>
        {/*
           That it is already connected is said here and not just on the button: the badge is read
           without interpreting a verb, and that is what explains why the button changed its word.
          */}
        {/*
           The state is the icon's color, and the word is read in ink.
           `live` and `idle` are the house pair for this exact pair of states, but they are 2.56:1
           and 2.15:1: fine for a mark, unreadable for a ten-pixel word. So the hue stays on the
           mark — the same division `primitives.tsx` already makes with its dot — and the label
           takes `chalk`.
           There is no dark variant here on purpose: this application is single-palette, `base.css`
           pins `color-scheme: light`, and a `dark:` utility would activate unreviewed the day a
           dark theme exists.
          */}
        {hasKey && !result && (
          <span className="flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 font-mono text-[10px] text-chalk">
            {hasEntered ? (
              <HiOutlineCheckCircle aria-hidden className="h-3.5 w-3.5 text-live" />
            ) : (
              <HiOutlineKey aria-hidden className="h-3.5 w-3.5 text-idle" />
            )}
            {t(hasEntered ? "connect.alreadyOn" : "connect.keyIssued")}
          </span>
        )}
        {/*
           Two tones for one button, which is what the ternary above was writing by hand: the first
           connection is the accent, and a repeat — which only rotates a key that already exists —
           steps back to the card's own paper. `ml-auto` is placement, which is the only thing
           `className` carries.
          */}
        <ActionButton
          tone={hasKey ? "surface" : "accent"}
          size="sm"
          type="button"
          className="ml-auto"
          onClick={() => void connect()}
          busy={state === "working"}
          busyLabel={t("connect.working")}
          disabled={state === "working" || ephemeral}
        >
          {t(hasKey ? "connect.again" : "connect.do")}
        </ActionButton>
      </div>

      {/*
         And what does it cost to press it again, which is what could not be seen anywhere.
         `POST /api/agent/mcp` calls `rotateAgentKey`: the record is kept —with its history— but
         the key is **different**. Where the file is written that is invisible, because it is
         overwritten with the new one. Where it could not be written and the block was stuck
         manually —a `config.toml` with its own entry, the `.mcp.json` of a project placed by
         `panoma agent-key --install` — the old copy ceases to be valid without a single error:
         the agent simply doesn't enter anymore. Saying it beforehand costs a line.
        */}
      {/*
         The button is off, so the reason is on. A disabled control with nothing beside it is a
         dead end: whoever meets it has no way of telling a bug from a decision, and the way out —
         installing panoma — is not something anyone guesses from a greyed-out button.
         The command is rendered as a command, the way the bridge does it, because it is going to
         be copied.
        */}
      {ephemeral && (
        <div className="mt-2 text-xs leading-relaxed text-smoke">
          <p>{t("connect.ephemeral", { name })}</p>
          <p className="mt-1.5 text-faint">{t("connect.ephemeralHow")}</p>
          {/*
             Both commands and in order, because the first one on its own changes nothing here and
             that is exactly how this was found: somebody ran it, the notice stayed, and there was
             nothing on the screen to explain why. The second is the one that ends the wait.
            */}
          <ol className="mt-1.5 grid gap-1.5">
            {["npm i -g panoma", "panoma down && panoma up"].map((line) => (
              <li key={line}>
                <code className="inline-block rounded border border-edge bg-raised px-2 py-1 font-mono text-[11px] text-chalk">
                  {line}
                </code>
              </li>
            ))}
          </ol>
        </div>
      )}

      {hasKey && hasEntered && !result && (
        <p className="mt-2 text-xs leading-relaxed text-faint">{t("connect.againCost")}</p>
      )}

      {/*
         A state nobody can act on is worse than no state at all. The key is there, the agent has
         never used it, and the reason is almost always the same one sentence — a session that was
         already open when the file was written. It was said once, right after writing, and then
         only on a screen two clicks away. Whoever comes back later lands here.
        */}
      {hasKey && !hasEntered && !result && (
        <p className="mt-2 text-xs font-medium leading-relaxed text-chalk">
          {t("connect.neverUsed", { name })}
        </p>
      )}

      {result?.wrote === true && (
        <div className="mt-3 text-xs leading-relaxed text-smoke">
          {/* The green is the check; the sentence keeps the `smoke` of the block, which is read. */}
          <p className="flex items-center gap-1.5">
            <HiOutlineCheckCircle aria-hidden className="h-4 w-4 text-live" />
            {t(result.replaced ? "connect.updated" : "connect.written")}
          </p>
          <code className="mt-1 block font-mono text-[11px] text-faint">{result.file}</code>
          {/* Naming what was already there is the only way to show that it is still there. */}
          {result.coexists.length > 0 && (
            <p className="mt-1 text-faint">
              {t("connect.coexists", { list: result.coexists.join(", ") })}
            </p>
          )}
          {/*
             The key is clearly in there, and that file is in a repository.
             This sentence is the one thing on the card that can cost something, so it is written
             in the ink that is read best rather than in an alarm hue: the house amber
             (`--color-warn`) is 3.54:1 and would make the warning harder to read than the prose
             around it. No `dark:` variant either — see the badge above.
            */}
          {result.exposedToGit && (
            <p className="mt-1 text-chalk">{t("connect.gitWarning")}</p>
          )}
          {/* What the documentation did not say and needs to be known. */}
          <p className="mt-2 font-medium text-chalk">{t("connect.restart", { name })}</p>
        </div>
      )}

      {result?.wrote === false && (
        <div className="mt-3 text-xs leading-relaxed text-smoke">
          <p>{result.reason ?? t(result.file ? "connect.pasteInto" : "connect.pasteSomewhere")}</p>
          {result.file && (
            <code className="mt-1 block font-mono text-[11px] text-faint">{result.file}</code>
          )}
          <div className="mt-2 flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded border border-edge bg-ground p-3 font-mono text-[11px] text-chalk">
              {result.snippet}
            </pre>
            <ActionButton
              tone="surface"
              size="sm"
              type="button"
              onClick={() => void copy(result.snippet)}
              aria-label={t("connect.copy")}
            >
              {copied ? t("connect.copied") : <HiOutlineClipboard aria-hidden className="h-4 w-4" />}
            </ActionButton>
          </div>
          {result.file && (
            <ActionButton
              tone="surface"
              size="sm"
              type="button"
              className="mt-2"
              onClick={() => void openFile()}
            >
              {t("connect.openFile")}
            </ActionButton>
          )}
          <p className="mt-2 font-medium text-chalk">
            {opened !== null ? t("connect.opened", { editor: opened, name }) : t("connect.restart", { name })}
          </p>
        </div>
      )}

      {error && <ActionError text={error} className="mt-3" />}
    </li>
  );
}
