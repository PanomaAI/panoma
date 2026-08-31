import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitsPerDay } from "./git";
import { createProject } from "./test-utils/temp-project";

const limpiezas: (() => void)[] = [];
afterEach(() => {
  while (limpiezas.length) limpiezas.pop()!();
});

/**
 * Dates are constructed at local **noon** and never at midnight.
 *
 * The day that `commitsPerDay` returns is grouped by git with `format-local`, that is, in the
 * process zone. A commit dated at midnight UTC falls on the previous day for half the planet, so a
 * test written like this passes in Madrid and fails in New York — where the person who wrote it
 * lives. At noon, there's no time zone that moves it from the day.
 */
function haceDias(dias: number): Date {
  const fecha = new Date();
  fecha.setHours(12, 0, 0, 0);
  fecha.setDate(fecha.getDate() - dias);
  return fecha;
}

function clave(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function repo(): string {
  const { root, cleanup } = createProject({ "README.md": "# prueba\n" });
  limpiezas.push(cleanup);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@panoma.ai");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  return root;
}

/**
 * Commits are created **in chronological order**, from the oldest to the newest.
 *
 * It's not a cleaning obsession: `git log --since` stops traversing the history as soon as it
 * encounters a commit before the cutoff, because it assumes that from there on, there are only
 * older things. A test that creates a child dated earlier than its parent hides commits that are
 * actually within the window and blames the code for a fault it doesn't have. Real history doesn't
 * do that: the committer date is rewritten during a rebase.
 */
function commitEn(root: string, cuando: Date, mensaje: string): void {
  writeFileSync(join(root, `${mensaje}.txt`), mensaje, "utf8");
  const sello = cuando.toISOString();
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", mensaje], {
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: sello, GIT_COMMITTER_DATE: sello },
  });
}

describe("commitsPerDay", () => {
  it("cuenta cada día por separado y no se queda en los últimos veinte commits", async () => {
    const root = repo();
    commitEn(root, haceDias(2), "anteayer-uno");
    commitEn(root, haceDias(2), "anteayer-dos");
    commitEn(root, haceDias(1), "ayer");
    commitEn(root, haceDias(0), "hoy");
    // Twenty-five commits from a day of work with agents: with the old account, those from
    // yesterday and the day before yesterday would not have fit in the twenty window and their day
    // would come out to zero.
    for (let i = 0; i < 25; i += 1) commitEn(root, haceDias(0), `hoy-${i}`);

    const porDia = await commitsPerDay(root, 7);

    expect(porDia?.[clave(haceDias(2))]).toBe(2);
    expect(porDia?.[clave(haceDias(1))]).toBe(1);
    expect(porDia?.[clave(haceDias(0))]).toBe(26);
  });

  it("deja fuera lo que cae antes de la ventana", async () => {
    const root = repo();
    commitEn(root, haceDias(10), "fuera");
    commitEn(root, haceDias(0), "dentro");

    const porDia = await commitsPerDay(root, 7);

    expect(porDia).toEqual({ [clave(haceDias(0))]: 1 });
  });

  it("distingue «no hubo commits» de «no se pudo preguntar»", async () => {
    const conRepo = repo();
    commitEn(conRepo, haceDias(30), "viejo");
    // Git was queried and the week is empty: that is a `{}`, and it can be rendered.
    await expect(commitsPerDay(conRepo, 7)).resolves.toEqual({});

    // A folder without a repository does not have a blank week: it does not have a week.
    const { root, cleanup } = createProject({ "README.md": "# sin git\n" });
    limpiezas.push(cleanup);
    await expect(commitsPerDay(root, 7)).resolves.toBeUndefined();
  });
});
