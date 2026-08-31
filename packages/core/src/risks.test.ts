import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { workRisks } from "./git";

/*
  Each risk offers a command and the interface puts it behind a copy button. A command that cannot
  be pasted is worse than offering none: the button promises that what you take works.
  This is not a theoretical test. `git init && git add -A && git commit -m «primer commit»` was
  there from the beginning, and angle quotes are not shell quotes: `«primer` was going as a
  message and `commit»` as a pathspec, so git aborted with "pathspec 'commit' did not match any
  file(s)". Twenty-eight folders of the catalog showed that command as the way to get to safety.
 */

/** All the combinations that produce risks, to go through the commands at once. */
const CASES = [
  { versioned: false, remoteUrl: null, commitCount: null, work: null },
  { versioned: true, remoteUrl: null, commitCount: 0, work: { ownRepo: true, modified: 3, untracked: 1 } },
  { versioned: true, remoteUrl: null, commitCount: 600, work: { ownRepo: true } },
  { versioned: true, remoteUrl: "git@github.com:me/x.git", commitCount: 5, work: { ownRepo: true, ahead: 2 } },
  { versioned: true, remoteUrl: "git@github.com:me/x.git", commitCount: 5, work: { ownRepo: true, modified: 4 } },
  { versioned: true, remoteUrl: "git@github.com:me/x.git", commitCount: 5, work: { ownRepo: true, untracked: 7 } },
  { versioned: true, remoteUrl: "git@github.com:me/x.git", commitCount: 5, work: { ownRepo: true, stashes: 2 } },
  { versioned: true, remoteUrl: "git@github.com:me/x.git", commitCount: 5, work: { ownRepo: true, behind: 9 } },
] as const;

/**
 * Each loose step, which is how the engine keeps them.
 *
 * A remedy is a list and not a string with `&&` inside, because `&&` is syntax of a specific shell
 * —PowerShell does not understand it until version 7— and whoever creates the remedy joins it
 * however the shell of the person who is going to paste it knows how to join it. Checking step by
 * step is also stricter: a `&&` hanging inside a step no longer hides in the middle of the string.
 */
function everyRemedy(): string[] {
  const seen = new Set<string>();
  for (const input of CASES) {
    for (const risk of workRisks(input as Parameters<typeof workRisks>[0])) {
      for (const step of risk.remedy) seen.add(step);
    }
  }
  return [...seen];
}

describe("el comando de cada riesgo", () => {
  it("cubre los ocho riesgos", () => {
    const codes = new Set(
      CASES.flatMap((input) =>
        workRisks(input as Parameters<typeof workRisks>[0]).map((risk) => risk.code),
      ),
    );
    expect([...codes].sort()).toEqual([
      "behind",
      "no-commits",
      "no-remote",
      "unpushed",
      "unversioned",
      "untracked",
      "stashes",
      "uncommitted",
    ].sort());
  });

  it("es siempre un comando y nunca una frase", () => {
    for (const remedy of everyRemedy()) {
      expect(remedy, remedy).toMatch(/^git /);
      expect(remedy, remedy).not.toMatch(/[.¿?¡!]$/);
    }
  });

  /*
    This really needs a `sh`, and in Windows there isn't one.
    It is not a test detail: the remedies are POSIX syntax —`cd '...' && git status'`— and whoever
    copies them in Windows pastes them in PowerShell, where `&&` does not exist until version 7
    and `cd 'ruta'` is written differently. Skipping it here leaves a note of the gap instead of
    pretending that something is being checked; fixing it properly means changing what the copy
    buttons emit, not this file.
   */
  const conShellPosix = existsSync("/bin/sh") ? it : it.skip;

  it("ningún paso trae encadenado por dentro: eso lo pone quien lo pinta", () => {
    for (const step of everyRemedy()) {
      expect(step, step).not.toContain("&&");
      expect(step, step).not.toContain(";");
    }
  });

  conShellPosix("lo parsea el shell sin quejarse", () => {
    for (const remedy of everyRemedy()) {
      // `-n` reads and analyzes without executing: take a hanging `&&` or an unclosed quote,
      // without touching any repository. It's not enough by itself —"first commit" in angle
      // brackets is a *valid* shell, it's just that they are two words instead of one argument—
      // hence the test below. The two together cover syntax and quotes.
      expect(() => execFileSync("/bin/sh", ["-n"], { input: remedy })).not.toThrow();
    }
  });

  it("no lleva comillas que el shell no entiende ni redirecciones disfrazadas de hueco", () => {
    for (const remedy of everyRemedy()) {
      expect(remedy, remedy).not.toMatch(/[«»“”‘’]/);
      // `<url>` in zsh is a redirection from a file called 'url': the command dies before reaching
      // git. A gap is written in uppercase.
      expect(remedy, remedy).not.toMatch(/[<>]/);
    }
  });

  it("deja el mensaje del primer commit entre comillas de verdad", () => {
    const [unversioned] = workRisks({
      versioned: false,
      remoteUrl: null,
      commitCount: null,
      work: null,
    });
    expect(unversioned!.remedy).toEqual([
      "git init",
      "git add -A",
      'git commit -m "first commit"',
    ]);
  });
});
