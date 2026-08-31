import { describe, expect, it } from "vitest";
import { composeScript } from "./launcher";

/**
 * The script that the agent launches is an executable file composed of two pieces of data that
 * Panoma did not choose: the path of a project —the user wrote it when creating the folder— and
 * the path of the task. These tests fix the only thing that can never fail: that neither of the
 * two can escape their quotation marks, and that the text of the task does not end up inside the
 * script.
 */

const BASE = {
  root: "/Users/x/proyecto",
  assignmentPath: "/Users/x/.panoma/encargos/demo-plan.md",
  command: "claude",
  args: [] as string[],
};

describe("las rutas no se pueden salir de su comilla", () => {
  it("una carpeta con espacios se entrecomilla entera", () => {
    // 32 of the 81 routes in this catalog have a space: without quotes, the `cd` splits in two and
    // the agent starts where it shouldn't.
    const script = composeScript({ ...BASE, root: "/Users/x/design templates/web app" });
    expect(script).toContain("cd '/Users/x/design templates/web app' || exit 1");
  });

  it("una carpeta con una comilla no abre un comando nuevo", () => {
    const script = composeScript({ ...BASE, root: "/Users/x/it's mine" });
    // Close, escape, reopen: the content remains a single argument.
    expect(script).toContain(`cd '/Users/x/it'\\''s mine' || exit 1`);
    expect(script).not.toMatch(/cd '\/Users\/x\/it's mine'/);
  });

  it("ni siquiera con un punto y coma o un subshell dentro", () => {
    const hostile = "/tmp/x'; rm -rf ~; echo '";
    const script = composeScript({ ...BASE, root: hostile });
    const line = script.split("\n").find((l) => l.startsWith("cd "))!;
    // Everything dangerous is inside single quotes; outside only remains the `|| exit 1`.
    expect(line.endsWith("|| exit 1")).toBe(true);
    expect(line.replace(/'(?:[^']|'\\'')*'/g, "")).toBe("cd  || exit 1");
  });

  /*
    The third path of the script, and the one that was not checked: until now all the fixtures
    used `claude` on its own. The detector returns the path that responded, which can be
    `~/.claude/local/claude` or a binary inside a `.app`, and there a space splits `exec` in two.
   */
  it("y la ruta del agente, que es la tercera y la que faltaba", () => {
    const script = composeScript({
      ...BASE,
      command: "/Users/ana maría/.claude/local/claude",
    });
    const line = script.split("\n").find((l) => l.startsWith("exec "))!;

    expect(line).toContain("'/Users/ana maría/.claude/local/claude'");
    expect(line.startsWith("exec /Users/ana"), "sin comillas se partía aquí").toBe(false);
  });

  it("la ruta del encargo también va entrecomillada", () => {
    const script = composeScript({
      ...BASE,
      assignmentPath: "/Users/x/.panoma/encargos/mi app-plan.md",
    });
    expect(script).toContain(`"$(cat '/Users/x/.panoma/encargos/mi app-plan.md')"`);
  });
});

describe("el encargo se lee de un fichero, nunca se escribe dentro del guion", () => {
  /*
    No quotes in the paths of these two tests, and that’s fine: `quoteForShell` only puts quotes
    around what needs them, so that a normal command is still read as a person would write it.
    What matters is the outside —`"$(cat …)"` with its double quotes—, which is what makes the
    assignment a single argument no matter what happens inside.
   */
  it("el guion invoca al agente con el contenido como un único argumento", () => {
    const script = composeScript(BASE);
    expect(script).toContain(`exec claude "$(cat ${BASE.assignmentPath})"`);
  });

  it("los argumentos del agente van antes del encargo", () => {
    const script = composeScript({ ...BASE, command: "gemini", args: ["-i"] });
    expect(script).toContain(`exec gemini -i "$(cat ${BASE.assignmentPath})"`);
  });

  it("el guion es corto y no lleva más comandos que los suyos", () => {
    // Four lines: shebang, comment, cd, and exec. Any extra line in a file that is executed only by
    // pressing a button deserves to be explained in the test rather than in the script.
    const lines = composeScript(BASE).split("\n").filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("#!/bin/sh");
    expect(lines[3]!.startsWith("exec ")).toBe(true);
  });
});

/*
  Open the agent without assignment: the case of «Open in → Claude Code».
  It is the same script minus the argument of the text, and that is why it is tested here: if one
  day someone composes it with a template instead of with this function, the `cd` without quotes
  returns, and with it four out of every ten folders that have a space in the name.
 */
describe("abrir un agente sin encargo", () => {
  it("entra en la carpeta y ejecuta el agente, sin más argumentos", () => {
    const script = composeScript({
      root: "/Users/x/design templates/app",
      command: "claude",
      args: [],
    });
    expect(script).toContain(`cd '/Users/x/design templates/app' || exit 1`);
    expect(script.trim().endsWith("exec claude")).toBe(true);
    expect(script).not.toContain("cat ");
  });

  it("los argumentos interactivos del agente siguen yendo delante", () => {
    const script = composeScript({ root: "/tmp/x", command: "codex", args: ["--full-auto"] });
    expect(script).toContain("exec codex --full-auto");
  });
});

/**
 * The same script on Windows, with the tools from there.
 *
 * The two rules that are non-negotiable are the same —quoted paths, and reading the file
 * assignment from the file instead of writing it inside— but neither the quotes nor the reading
 * are done the same way, and applying the POSIX recipe there doesn't fail: it does something
 * different and worse.
 */
describe("el guion de PowerShell", () => {
  const base = {
    root: "C:\\Users\\jesus\\mis proyectos\\panoma",
    command: "claude",
    args: ["--permission-mode", "acceptEdits"],
    shell: "powershell" as const,
  };

  it("no tiene shebang ni `exec`, que allí no significan nada", () => {
    const guion = composeScript(base);
    expect(guion).not.toContain("#!/bin/sh");
    expect(guion).not.toContain("exec ");
    expect(guion).toContain("Set-Location -LiteralPath 'C:\\Users\\jesus\\mis proyectos\\panoma'");
  });

  it("se para si el cd falla, igual que el `|| exit 1` de POSIX", () => {
    // Without this, the agent would start in the folder where the terminal was, which is the
    // mistake that costs the most: working on the wrong project without noticing.
    expect(composeScript(base)).toContain("if (-not $?) { exit 1 }");
  });

  it("lee el encargo del fichero y lo pasa como un solo argumento", () => {
    const guion = composeScript({ ...base, assignmentPath: "C:\\Users\\jesus\\.panoma\\x.md" });
    expect(guion).toContain("(Get-Content -Raw -LiteralPath C:\\Users\\jesus\\.panoma\\x.md)");
    /*
      The task is named only once and always within the parentheses that read it. This function
      never receives the text — only the path — and it has to continue that way: that text can
      come from someone else's README, and written within the script it would be one more command.
     */
    const veces = guion.split("C:\\Users\\jesus\\.panoma\\x.md").length - 1;
    expect(veces).toBe(1);
    expect(guion).toContain("(Get-Content");
  });

  it("usa -LiteralPath, que no interpreta comodines", () => {
    // A folder «project [old]» is not found with `-Path`, and it is not a strange name.
    const guion = composeScript({ ...base, root: "C:\\Users\\jesus\\proyecto [viejo]" });
    expect(guion).toContain("Set-Location -LiteralPath 'C:\\Users\\jesus\\proyecto [viejo]'");
  });

  it("escapa la comilla simple doblándola, que es como se hace allí", () => {
    // In POSIX it is closed, escaped, and reopened. Applying that rule here leaves an unclosed
    // string and a terminal waiting forever.
    const guion = composeScript({ ...base, root: "C:\\Users\\jesus's app" });
    expect(guion).toContain("'C:\\Users\\jesus''s app'");
    expect(guion).not.toContain("\\'");
  });

  it("va con saltos de Windows", () => {
    expect(composeScript(base)).toContain("\r\n");
  });
});

