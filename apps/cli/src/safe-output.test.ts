import { describe, expect, it } from "vitest";
import { installSafeOutput, sanitizeOutput } from "./safe-output";

/**
 * A terminal does not print bytes: it interprets them. Panoma prints project names, package names,
 * paths, and commit subjects that come from files written by someone else, and in a report whose
 * value is to say "eight Stripe keys in production," letting the analyzed material rewrite the
 * verdict invalidates it entirely.
 */

/** What a hostile `package.json` would put in its `name` field. */
const HOSTILE =
  "inocente\x1b[2K\r\x1b[32m  ✓ 0 credenciales · todo verificado\x1b[0m\x1b[1A";

describe("lo que puede reescribir la pantalla no pasa", () => {
  it("borrar la línea, volver al principio y subir el cursor", () => {
    const clean = sanitizeOutput(HOSTILE);
    expect(clean).not.toContain("\x1b[2K"); // delete line
    expect(clean).not.toContain("\r"); // volver al principio
    expect(clean).not.toContain("\x1b[1A"); // go up a line
  });

  it("las secuencias OSC, que cambian el título de la ventana o abren enlaces", () => {
    expect(sanitizeOutput("a\x1b]0;soy el título\x07b")).toBe("ab");
    expect(sanitizeOutput("a\x1b]8;;https://evil.example\x1b\\pincha\x1b]8;;\x1b\\b")).toBe(
      "apinchab",
    );
  });

  it("los controles sueltos: nulos, retroceso, campana", () => {
    expect(sanitizeOutput("a\x00b\x08c\x07d")).toBe("abcd");
  });

  it("un ESC suelto al final tampoco se cuela", () => {
    expect(sanitizeOutput("hola\x1b")).toBe("hola");
    expect(sanitizeOutput("hola\x1b[")).toBe("hola[");
  });
});

describe("lo que sí pasa", () => {
  /*
    The rule that makes the filter not break anything: it lets the color pass and nothing else.
    `\x1b[…m` is the only thing that Panoma emits —picocolors does nothing else— so the output
    remains identical, and a color sequence coming from a file at most renders text in another
    color. It cannot delete anything.
   */
  it("el color", () => {
    expect(sanitizeOutput("\x1b[32mverde\x1b[0m")).toBe("\x1b[32mverde\x1b[0m");
    expect(sanitizeOutput("\x1b[1;38;5;208mnaranja\x1b[39m")).toBe(
      "\x1b[1;38;5;208mnaranja\x1b[39m",
    );
  });

  it("el color que venga de un fichero hostil, porque es inofensivo", () => {
    expect(sanitizeOutput(HOSTILE)).toContain("\x1b[32m");
  });

  it("saltos de línea y tabuladores, que estructuran la salida", () => {
    expect(sanitizeOutput("a\nb\tc")).toBe("a\nb\tc");
  });

  it("acentos, emoji y todo lo que no sea un control", () => {
    expect(sanitizeOutput("Descripción · 你好 · 🎉")).toBe("Descripción · 你好 · 🎉");
  });
});

describe("el filtro está en la salida, no en cada mensaje", () => {
  /*
    There are about forty calls to `write` in the CLI and it is enough to forget one. The 154
    reviews that other agents dedicated to narrowing down HTTP responses, one by one, are the
    proof of where trusting in discipline leads.
   */
  it("lo escrito por stdout sale filtrado sin que quien escribe haga nada", () => {
    const chunks: string[] = [];
    const original = process.stdout.write;
    // First the captor, and the filter on top: that way, what arrives here is exactly what would
    // have come out of the terminal.
    process.stdout.write = ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const remove = installSafeOutput();

    try {
      process.stdout.write(HOSTILE);
    } finally {
      remove();
      process.stdout.write = original;
    }

    expect(chunks.join("")).not.toContain("\x1b[2K");
    expect(chunks.join("")).not.toContain("\r");
    expect(chunks.join("")).toContain("inocente");
  });

  it("quitarlo devuelve el write original", () => {
    const antes = process.stdout.write;
    const remove = installSafeOutput();
    expect(process.stdout.write).not.toBe(antes);
    remove();
    expect(process.stdout.write).toBe(antes);
  });
});
