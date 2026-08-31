import { describe, expect, it } from "vitest";
import { inFolder, joinSteps, quoteForShell, shellOf } from "./command";

/**
 * This test exists because the bug was invisible and massive: of the 81 routes in the real
 * catalog, 32 have a space, so four out of ten copy buttons produced a line that the shell splits
 * in two. A command that cannot be pasted saves nothing.
 */
describe("comandos que se pegan en un terminal", () => {
  it("deja en paz lo que no lo necesita", () => {
    expect(quoteForShell("/Users/jesus/proyectos/panoma")).toBe("/Users/jesus/proyectos/panoma");
  });

  it("entrecomilla los espacios, que son el caso real", () => {
    expect(quoteForShell("/Users/jesus/design templates/pandaka")).toBe(
      "'/Users/jesus/design templates/pandaka'",
    );
  });

  it("entrecomilla lo que el shell interpretaría", () => {
    expect(quoteForShell("/tmp/drøp copy 2")).toBe("'/tmp/drøp copy 2'");
    expect(quoteForShell("/tmp/a&b")).toBe("'/tmp/a&b'");
    expect(quoteForShell("/tmp/$HOME")).toBe("'/tmp/$HOME'");
  });

  it("sobrevive a una comilla simple dentro de la ruta", () => {
    // Close, escape, and reopen: it is the only way within single quotes.
    expect(quoteForShell("/tmp/jesus's app")).toBe(`'/tmp/jesus'\\''s app'`);
  });

  it("compone el comando entero", () => {
    expect(inFolder("/tmp/design templates/app", "flutter run")).toBe(
      "cd '/tmp/design templates/app' && flutter run",
    );
  });

  it("encadena los pasos de un remedio de varios", () => {
    expect(joinSteps(["git init", "git add -A", 'git commit -m "first commit"'])).toBe(
      'git init && git add -A && git commit -m "first commit"',
    );
  });
});

/**
 * The same promise in Windows, which is where it was not fulfilled.
 *
 * `&&` does not exist in PowerShell until version 7, and the one that Windows comes with by
 * default is 5.1: a line with `&&` doesn't even run, it fails to parse it. In other words, the
 * command that exists to be able to paste it without thinking was the only one that couldn't be
 * pasted there.
 */
describe("los mismos comandos, en PowerShell", () => {
  it("elige el shell por el sistema y no por la esperanza", () => {
    expect(shellOf("win32")).toBe("powershell");
    expect(shellOf("darwin")).toBe("posix");
    expect(shellOf("linux")).toBe("posix");
  });

  it("no usa && en ninguna parte", () => {
    const linea = inFolder(
      "C:\\Users\\jesus\\design templates",
      ["git init", "git add -A"],
      "powershell",
    );

    expect(linea).not.toContain("&&");
    expect(linea).toBe(
      "cd 'C:\\Users\\jesus\\design templates'; if ($?) { git init; git add -A }",
    );
  });

  it("el cd sigue encadenado, que es donde importa", () => {
    // If the folder is no longer there, what is behind it would run wherever the terminal was: a
    // `git status` responding for another project is worse than an error.
    expect(inFolder("C:\\proyectos\\panoma", ["git status"], "powershell")).toContain("if ($?)");
  });

  it("una ruta de Windows normal no necesita comillas", () => {
    expect(quoteForShell("C:\\Users\\jesus\\panoma", "powershell")).toBe(
      "C:\\Users\\jesus\\panoma",
    );
  });

  it("una comilla simple se duplica, que es como se escapa allí", () => {
    // In POSIX it is closed, escaped, and reopened. In PowerShell it is duplicated. Applying the
    // other rule leaves a string unclosed and a terminal waiting forever.
    expect(quoteForShell("C:\\Users\\jesus's app", "powershell")).toBe(
      "'C:\\Users\\jesus''s app'",
    );
  });
});
