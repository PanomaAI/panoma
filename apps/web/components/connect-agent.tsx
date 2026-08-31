"use client";

import { useState } from "react";
import { HiOutlineSparkles, HiOutlineCheckCircle, HiOutlineClipboard } from "react-icons/hi2";
import { postJson } from "@/lib/api";
import { BRAND_ICONS } from "./brand-icons";
import { useOpenTarget } from "./use-open-target";
import { useT } from "./i18n-provider";
import { useCopied } from "./use-copied";
import { ActionError } from "./primitives";

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

export function ConnectAgent({ connected }: { connected: string[] }) {
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
}: {
  id: string;
  name: string;
  /** It already has a record in the catalog, from a previous connection. See header. */
  already: boolean;
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

  /* It was connected when turning it on or if we just connected it on this screen. */
  const conectado = already || result !== null;


  return (
    <li className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon aria-hidden className="h-5 w-5 text-smoke" />
        <strong className="font-display text-base font-semibold tracking-tight">{name}</strong>
        {/*
           That it is already connected is said here and not just on the button: the badge is read
           without interpreting a verb, and that is what explains why the button changed its word.
          */}
        {conectado && !result && (
          <span className="flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 font-mono text-[10px] text-green-700">
            <HiOutlineCheckCircle aria-hidden className="h-3.5 w-3.5" />
            {t("connect.alreadyOn")}
          </span>
        )}
        <button
          type="button"
          onClick={() => void connect()}
          disabled={state === "working"}
          className={`ml-auto rounded px-3 py-1.5 font-mono text-[11px] transition-opacity hover:opacity-85 disabled:opacity-50 ${
            conectado
              ? "border border-edge text-smoke"
              : "border border-accent bg-accent text-white"
          }`}
        >
          {t(state === "working" ? "connect.working" : conectado ? "connect.again" : "connect.do")}
        </button>
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
      {conectado && !result && (
        <p className="mt-2 text-xs leading-relaxed text-faint">{t("connect.againCost")}</p>
      )}

      {result?.wrote === true && (
        <div className="mt-3 text-xs leading-relaxed text-smoke">
          <p className="flex items-center gap-1.5 text-green-700">
            <HiOutlineCheckCircle aria-hidden className="h-4 w-4" />
            {t(result.replaced ? "connect.updated" : "connect.written")}
          </p>
          <code className="mt-1 block font-mono text-[11px] text-faint">{result.file}</code>
          {/* Naming what was already there is the only way to show that it is still there. */}
          {result.coexists.length > 0 && (
            <p className="mt-1 text-faint">
              {t("connect.coexists", { list: result.coexists.join(", ") })}
            </p>
          )}
          {/* The key is clearly in there, and that file is in a repository. */}
          {result.exposedToGit && (
            <p className="mt-1 text-amber-700 dark:text-amber-500">{t("connect.gitWarning")}</p>
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
            <button
              type="button"
              onClick={() => void copy(result.snippet)}
              aria-label={t("connect.copy")}
              className="rounded border border-edge px-2 py-1 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent"
            >
              {copied ? t("connect.copied") : <HiOutlineClipboard aria-hidden className="h-4 w-4" />}
            </button>
          </div>
          {result.file && (
            <button
              type="button"
              onClick={() => void openFile()}
              className="mt-2 rounded border border-edge px-2 py-1 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent"
            >
              {t("connect.openFile")}
            </button>
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
