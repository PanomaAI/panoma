import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";
import { helpText } from "./lang";

/**
 * What is verified here is not that the parser correctly interprets what is right —that is seen
 * when using it— but that **it fails on what it does not understand**. A permissive parser does
 * not give errors: it gives another command, with its summary in green and its feeling of having
 * done what you asked.
 */

/** Help for reading the tests: it fails if the parser accepted what it should have rejected. */
function errorOf(argv: string[]): string {
  const parsed = parseArgs(argv);
  if (parsed === "help" || parsed === "version" || !("error" in parsed)) {
    throw new Error(`se esperaba un error y se aceptó: ${JSON.stringify(argv)}`);
  }
  return parsed.error;
}

function flagsOf(argv: string[]) {
  const parsed = parseArgs(argv);
  if (parsed === "help" || parsed === "version" || "error" in parsed) {
    throw new Error(`no se esperaba error ni ayuda: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

describe("un flag desconocido nunca se ignora", () => {
  /*
    The case that motivated it. `--securiy` was being quietly discarded, so `panoma run` was
    uploaded to the latest published version instead of the one that fixes the vulnerability, and
    it announced it as a success. It wasn’t a broken command: it was another command.
   */
  it("rechaza --securiy y sugiere --security", () => {
    const error = errorOf(["run", "panoma", "--securiy"]);
    expect(error).toContain("--securiy");
    expect(error).toContain("--security");
  });

  it("rechaza cualquier flag inventado", () => {
    expect(errorOf(["scan", "--turbo"])).toContain("--turbo");
  });

  it("no sugiere nada cuando no hay nada parecido", () => {
    // Suggesting 'did you mean --json?' for `--zzzzzz` makes one doubt whether the error is real.
    expect(errorOf(["scan", "--zzzzzz"])).not.toContain("did you mean {guess}?");
  });
});

describe("los valores de los flags no se convierten en otra cosa", () => {
  it("acepta --api=valor igual que --api valor", () => {
    expect(flagsOf(["scan", "--api=http://x"]).api).toBe("http://x");
    expect(flagsOf(["scan", "--api", "http://x"]).api).toBe("http://x");
  });

  it("el valor de un flag no cae en los posicionales", () => {
    expect(flagsOf(["scan", "--api", "http://x"]).positionals).toEqual(["scan"]);
    expect(flagsOf(["scan", "--isolation", "container"]).positionals).toEqual(["scan"]);
  });

  /*
    The command came from `argv.find(a => !a.startsWith("-"))`, so here the first one that doesn't
    start with a dash was `http://x` and Panoma replied 'Unknown command'.
   */
  it("el comando se reconoce aunque los flags vayan delante", () => {
    expect(flagsOf(["--api", "http://x", "scan"]).positionals[0]).toBe("scan");
    expect(flagsOf(["--save", "scan", "/ruta"]).positionals).toEqual(["scan", "/ruta"]);
  });

  it("un flag sin valor es un error, no un valor que empieza por guion", () => {
    // `--out --json` does not mean 'write in a file named --json'.
    expect(errorOf(["scan", "--out", "--json"])).toContain("--out");
    expect(errorOf(["scan", "--api"])).toContain("--api");
  });
});

describe("los valores tampoco se aceptan a ciegas", () => {
  /*
    `resolveExecutor` falls into `hardened` for any value that is neither `local` nor `container`,
    so a misspelled level gave less order isolation and the report presented it as if it were the
    selected one.
   */
  it("rechaza un nivel de aislamiento que no existe", () => {
    const error = errorOf(["run", "panoma", "typescript", "--isolation", "containr"]);
    expect(error).toContain("containr");
    expect(error).toContain("container");
  });

  it("acepta los tres niveles reales", () => {
    for (const level of ["local", "hardened", "container"]) {
      expect(flagsOf(["run", "x", "y", "--isolation", level]).isolation).toBe(level);
    }
  });
});

describe("lo que ya funcionaba sigue funcionando", () => {
  it("reconoce los flags cortos y los largos", () => {
    const flags = flagsOf(["scan", "-v", "-d", "--json", "--save", "--no-git"]);
    expect(flags.verbose).toBe(true);
    expect(flags.duplicates).toBe(true);
    expect(flags.json).toBe(true);
    expect(flags.save).toBe(true);
    expect(flags.git).toBe(false);
  });

  it("--force y --security ya no se leen del argv por su cuenta", () => {
    const flags = flagsOf(["run", "panoma", "--security", "--force"]);
    expect(flags.security).toBe(true);
    expect(flags.force).toBe(true);
  });

  it("la ruta es el segundo posicional, y por defecto el directorio actual", () => {
    expect(flagsOf(["scan", "/tmp/x"]).path).toBe("/tmp/x");
    expect(flagsOf(["scan"]).path).toBe(".");
  });

  it("--help gana a cualquier otra cosa, incluso a un flag inválido", () => {
    expect(parseArgs(["scan", "--turbo", "--help"])).toBe("help");
    expect(parseArgs(["-h"])).toBe("help");
  });

  it("--version existe, porque es lo primero que se teclea tras instalar", () => {
    expect(parseArgs(["--version"])).toBe("version");
    expect(parseArgs(["-V"])).toBe("version");
    // The lowercase is still --verbose: changing it now would break those who already use it.
    expect(flagsOf(["-v"]).verbose).toBe(true);
  });
});

describe("panoma a secas ya no es la ayuda", () => {
  /*
    The change that turns this into a tool for daily use. Without arguments, the parser returns
    some flags without positionals —no "help"— and it is `index.ts` who decides that this means
    the daily report. It is checked here because it is the only signal that distinguishes "wrote
    nothing" from "wrote a command": if one day "help" appears again, the work entry disappears
    without anything failing.
   */
  it("sin argumentos no pide la ayuda, devuelve unos flags vacíos", () => {
    const parsed = parseArgs([]);
    expect(parsed).not.toBe("help");
    expect(flagsOf([]).positionals).toEqual([]);
  });

  it("la ayuda sigue estando donde se busca", () => {
    expect(parseArgs(["--help"])).toBe("help");
  });

  it("sin comando pero con --api, el parte se pide al catálogo indicado", () => {
    const flags = flagsOf(["--api", "http://127.0.0.1:9999"]);
    expect(flags.positionals).toEqual([]);
    expect(flags.api).toBe("http://127.0.0.1:9999");
  });
});

describe("los flags de los verbos nuevos", () => {
  it("open elige herramienta con --folder y --terminal", () => {
    expect(flagsOf(["open", "cabeman", "--folder"]).folder).toBe(true);
    expect(flagsOf(["open", "cabeman", "--terminal"]).terminal).toBe(true);
    // The name of the project is a positional, not the value of any flag.
    expect(flagsOf(["open", "cabeman", "--terminal"]).positionals).toEqual(["open", "cabeman"]);
  });

  it("--install y --remove llegan a hooks y a agent-key", () => {
    expect(flagsOf(["hooks", "--install"]).install).toBe(true);
    expect(flagsOf(["hooks", "--remove"]).remove).toBe(true);
    expect(flagsOf(["agent-key", "Claude Code", "--install"]).install).toBe(true);
  });

  it("--on-boot es de up", () => {
    expect(flagsOf(["up", "--on-boot"]).atBoot).toBe(true);
    expect(flagsOf(["up"]).atBoot).toBe(false);
  });

  /*
    The two Spanish aliases —`--carpeta` and `--al-arrancar` — went with the rest of the Spanish
    from the terminal. A flag is an interface just like the name of a verb, and the four
    subcommand aliases had already gone before; these two had stayed.
   */
  it("los alias castellanos ya no existen", () => {
    expect(errorOf(["open", "x", "--carpeta"])).toContain("--carpeta");
    expect(errorOf(["up", "--al-arrancar"])).toContain("--al-arrancar");
  });

  /*
    Two flags that contradict each other have the same problem as a badly written one: you have to
    choose who wrote it, and half of the time you choose the opposite of what was asked. With
    `--folder --terminal` there is no good answer, so none is given.
   */
  it("no se elige por él cuando la orden se contradice", () => {
    expect(errorOf(["open", "x", "--folder", "--terminal"])).toContain("--folder");
    expect(errorOf(["hooks", "--install", "--remove"])).toContain("--remove");
  });

  it("un flag nuevo mal escrito también se rechaza, y se sugiere el bueno", () => {
    const error = errorOf(["hooks", "--instal"]);
    expect(error).toContain("--instal");
    expect(error).toContain("--install");
  });
});

/**
 * `up` with a folder behind.
 *
 * It is the way the landing offers in one go: it lifts the catalog and fills it. Here only the
 * parser's contract is checked — that the folder arrives as positional and is neither lost nor
 * confused with the value of a flag — because what it does afterward lives in `main()` and needs a
 * server. The important distinction is between 'no folder was given' and 'it was given,' and the
 * parser deletes it when filling `path` with `.`: that is why the dispatch looks at
 * `positionals[1]` and not `path`.
 */
describe("panoma up acepta una carpeta", () => {
  it("la carpeta llega como segundo posicional", () => {
    const parsed = parseArgs(["up", "~/Desktop"]);
    expect(parsed).not.toHaveProperty("error");
    if (parsed === "help" || parsed === "version" || "error" in parsed) throw new Error("no debería");
    expect(parsed.positionals[0]).toBe("up");
    expect(parsed.positionals[1]).toBe("~/Desktop");
  });

  it("sin carpeta no hay segundo posicional, aunque `path` valga «.»", () => {
    const parsed = parseArgs(["up"]);
    if (parsed === "help" || parsed === "version" || "error" in parsed) throw new Error("no debería");
    expect(parsed.positionals[1]).toBeUndefined();
    expect(parsed.path).toBe(".");
  });

  it("el valor de un flag delante no se confunde con la carpeta", () => {
    const parsed = parseArgs(["up", "--api", "http://localhost:4173", "~/Desktop"]);
    if (parsed === "help" || parsed === "version" || "error" in parsed) throw new Error("no debería");
    expect(parsed.positionals[1]).toBe("~/Desktop");
    expect(parsed.api).toBe("http://localhost:4173");
  });
});

describe("la ayuda enseña la forma de una sola pegada", () => {
  it("nombra `panoma up <folder>`", () => {
    expect(helpText()).toContain("panoma up <folder>");
  });
});

describe("los flags de `panoma ai`, que estaban implementados y eran inalcanzables", () => {
  /*
    `ai-command.ts` knew how to read `--model` and `--provider` from day one. It was useless: this
    parser runs earlier, didn't know them, and killed them with 'Unknown option.' Choosing a model
    from CLI was impossible — and since changing the provider erases the saved model, the only way
    to set it was broken.
    A flag implemented in your command but unknown here does not exist. That is why these tests
    live in the parser and not in the command: the command already worked.
   */
  it("acepta --model y se queda con su valor", () => {
    const parsed = flagsOf(["ai", "use", "anthropic", "--model", "claude-opus-5"]);
    expect(parsed.model).toBe("claude-opus-5");
    // And the value does not slip between the positionals, which is how "hello" became "local
    // hello" in the previous version of this command.
    expect(parsed.positionals).toEqual(["ai", "use", "anthropic"]);
  });

  it("acepta --provider igual", () => {
    const parsed = flagsOf(["ai", "ask", "hola", "--provider", "local"]);
    expect(parsed.provider).toBe("local");
    expect(parsed.positionals).toEqual(["ai", "ask", "hola"]);
  });

  it("y con el igual, que el parser de bolsillo no sabía", () => {
    const parsed = flagsOf(["ai", "use", "anthropic", "--model=claude-opus-5"]);
    expect(parsed.model).toBe("claude-opus-5");
  });

  it("un --model sin valor no se traga el flag siguiente", () => {
    expect(errorOf(["ai", "use", "anthropic", "--model", "--json"])).toContain(
      "--model needs a value",
    );
  });
});

describe("un solo parser, no dos", () => {
  /*
    The underlying cause was not forgetting two entries on a list: it was that the command had its
    own reader for `argv`. Two parsers not only make different mistakes — one of them runs first,
    and the one that runs first decides what gets through. As long as there is only one, a new
    flag is added in one place and it works everywhere.
   */
  it("nadie lee flags de argv a mano fuera de args.ts", () => {
    const carpeta = new URL("./", import.meta.url);
    const ficheros = readdirSync(carpeta).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "args.ts",
    );
    expect(ficheros.length).toBeGreaterThan(5);
    for (const name of ficheros) {
      const source = readFileSync(new URL(name, carpeta), "utf8");
      expect(source, `${name} se ha escrito otro parser de flags`).not.toMatch(
        /argv\.(indexOf|includes)\(\s*["`']--/,
      );
    }
  });
});
