"use client";

import { useEffect, useState } from "react";
import type { RunCommand, Runbook } from "@panoma/core";
import { CopyCommand } from "./copy-button";
import { inFolder, type Shell } from "./command";
import { useLocale, useT } from "./i18n-provider";
import type { MessageKey } from "@/lib/i18n";

/**
 * Everything that is needed to go back to working on a dormant project.
 *
 * The order is that of the real steps: what you were doing, what is written to start it, what
 * runtime is needed and if you have it, and which variables are missing. None of this is new
 * information — it is all in the folder — but it is spread across five different files, and
 * searching for it is exactly the friction that makes a project not get picked up again.
 *
 * Installed versions are requested separately because they are a property of the machine, not of
 * the project: one query works for all eighty.
 *
 * This block used to live at the bottom of the card, under "Details" and behind the dependencies
 * table: the only thing on the page that you can *do*, placed after the fourteen sections that you
 * can only read. Now it goes right below the summary, and the criterion of the entire card is
 * that: first what makes you get to work.
 */

type Installed = Record<string, { name: string; version: string | null }>;

/**
 * A commit from the recent history, just as the engine stores it.
 *
 * `agent` only appears when the commit has a `Co-Authored-By` trailer from a known agent. Its
 * absence **does not** mean you wrote it: it means that no one signed it.
 */
export interface CommitLine {
  sha: string;
  at: string;
  subject: string;
  agent?: string;
}

const PURPOSE_ORDER = ["install", "start", "tests", "build"] as const;

/*
  The purpose of each command, in the viewer's language.
  It is a `Record` about the type of engine on purpose: if tomorrow the runbook detects a fifth
  purpose, this will stop compiling and someone will have to decide what it is called in both
  languages. With a loose object, the new purpose would appear on the screen in Spanish.
 */
const PURPOSE_KEY: Record<RunCommand["purpose"], MessageKey> = {
  install: "purpose.install",
  start: "purpose.start",
  tests: "purpose.tests",
  build: "purpose.build",
};

/*
  How many commits fit in 'the last thing you did'.
  The engine went from storing five to storing twenty, but the day's report raised them, which
  requires a whole night of work with agents. Here twenty are more than enough: this is not a log,
  it is the sentence that takes you back to where you left off. With twenty lines you have to read
  to find where last night's session ends and last month's begins — exactly the work that this
  block exists to save.
  That's why it's cut by session and not by number: the commits that fall within the 24 hours
  prior to the most recent one. The ceiling is in case the session was marathon; the floor, in
  case the last commit was left loose and the real thing happened three days earlier, because a
  single line doesn't remember anything either.
 */
const SESSION_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX = 5;
const SESSION_MIN = 3;

function lastSession(commits: CommitLine[]): CommitLine[] {
  const newest = commits[0];
  if (!newest) return [];

  const floor = new Date(newest.at).getTime() - SESSION_MS;
  const session = commits.filter((commit) => new Date(commit.at).getTime() >= floor);
  const chosen = session.length >= SESSION_MIN ? session : commits.slice(0, SESSION_MIN);
  return chosen.slice(0, SESSION_MAX);
}

export function Resume({
  runbook,
  recentCommits,
  root,
  shell,
}: {
  runbook: Runbook;
  recentCommits: CommitLine[];
  /** The project folder. Travels ahead of each command; see `CopyCommand` below. */
  root: string;
  /*
    The shell comes via prop and it cannot be guessed here: this is a client component and the
    browser does not know which system the server is running on. Guessing wrong is giving someone
    on Windows a line with `&&` that their PowerShell can't even execute.
   */
  shell: Shell;
}) {
  const translate = useT();
  // The copy button takes the language by prop —see `CopyCommand` —, so here the language alone is
  // missing in addition to the translate function.
  const locale = useLocale();
  const [installed, setInstalled] = useState<Installed | null>(null);

  useEffect(() => {
    if (runbook.runtimes.length === 0) return;
    fetch("/api/environment")
      .then((response) => response.json())
      .then((payload: { tools: Installed }) => setInstalled(payload.tools))
      .catch(() => setInstalled({}));
  }, [runbook.runtimes.length]);

  const commands = [...runbook.commands].sort(
    (a, b) => PURPOSE_ORDER.indexOf(a.purpose) - PURPOSE_ORDER.indexOf(b.purpose),
  );
  const session = lastSession(recentCommits);

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {session.length > 0 && (
        <Block title={translate("project.lastYouDid")}>
          <ul className="space-y-1">
            {session.map((commit) => (
              <li key={commit.sha} className="flex gap-2.5 text-xs leading-relaxed">
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {commit.sha.slice(0, 7)}
                </span>
                <span className="min-w-0 flex-1 text-smoke">{commit.subject}</span>
                {/*
                   Only what is recorded is marked. A commit signed by an agent changes what 'the
                   last thing you did' means—you didn't do it—and it's worth seeing that before
                   resuming. The others carry nothing: without a trailer there is no author to
                   affirm, and putting 'you' where there is only silence would be inventing it.
                  */}
                {commit.agent && (
                  <span
                    className="shrink-0 font-mono text-[10px] text-accent"
                    /*
                      The same key as the commits panel: it is the same fact about the same
                      commit, and said in two ways it would be learned twice.
                     */
                    title={translate("changes.signedBy", { agent: commit.agent })}
                  >
                    {commit.agent}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {commands.length > 0 && (
        <Block title={translate("project.howToStart")}>
          <ul className="space-y-1.5">
            {commands.map((command) => (
              <li key={command.command} className="flex flex-wrap items-baseline gap-2">
                <span className="w-16 shrink-0 font-mono text-[10px] text-faint">
                  {translate(PURPOSE_KEY[command.purpose])}
                </span>
                {/*
                   The command is copied with its `cd` in front and is shown without it.
                   `pnpm dev` by itself doesn't save anything: it is pasted into a terminal that's
                   in any other folder and fails, or —worse— it starts the wrong project. It's the
                   same pattern as the backup strip of this same sheet, which copies
                   `cd <raíz> && git push`; what is read is the command, and what goes to the
                   clipboard is the line that can be pasted. The quotation marks for the path are
                   added by `inFolder`, which explains why they are needed.
                  */}
                <CopyCommand
                  command={inFolder(root, command.command, shell)}
                  label={command.command}
                  locale={locale}
                />
                <span
                  className="min-w-0 truncate font-mono text-[10px] text-faint"
                  title={command.source}
                >
                  {command.source}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {runbook.runtimes.length > 0 && (
        <Block title={translate("project.whatItNeeds")}>
          <ul className="space-y-1.5">
            {runbook.runtimes.map((runtime) => {
              const have = installed?.[runtime.id]?.version ?? null;
              return (
                <li
                  key={`${runtime.id}-${runtime.required}`}
                  className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 font-mono text-[11px]"
                >
                  <span className="text-chalk">{runtime.name}</span>
                  <span className="text-smoke">{runtime.required}</span>
                  {installed === null ? (
                    <span className="text-faint">{translate("project.runtimeChecking")}</span>
                  ) : have ? (
                    /*
                      It is said which version there is, not if it 'complies': comparing semver
                      ranges from six different ecosystems here would be reimplementing six
                      resolvers poorly, and making a mistake in the comparison is worse than not
                      doing it. Anyone can compare the two numbers together at a glance.
                     */
                    <span className="text-live">
                      {translate("project.runtimeHave", { version: have })}
                    </span>
                  ) : (
                    <span className="text-idle">{translate("project.runtimeMissing")}</span>
                  )}
                  <span className="text-faint">{runtime.source}</span>
                </li>
              );
            })}
          </ul>
        </Block>
      )}

      {runbook.missingEnv.length > 0 && (
        <Block title={translate("project.missingEnv", { n: runbook.missingEnv.length })}>
          <p className="mb-2 text-xs leading-relaxed text-smoke">
            {translate("project.envDeclaredIn")}{" "}
            <code className="font-mono text-chalk">{runbook.envExample}</code>{" "}
            {translate("project.envNoValue")}{" "}
            <code className="font-mono text-chalk">.env</code>. {translate("project.envWhy")}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {runbook.missingEnv.map((key) => (
              <li
                key={key}
                className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] text-smoke"
              >
                {key}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-edge bg-surface p-4">
      <h3 className="eyebrow mb-2.5">{title}</h3>
      {children}
    </section>
  );
}
