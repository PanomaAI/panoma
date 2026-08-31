import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizePypiName, resolvePypiVersions } from "./pypi-lockfiles";

/**
 * The four locks of Python, and the detail that decides if they are useful.
 *
 * Reading the files is the easy part: three are TOML with the same format and the fourth is JSON.
 * What breaks a reader is the **name**: in Python `Django` and `django` are the same package, and
 * `zope.interface`, `zope-interface`, and `zope_interface` are also (PEP 503). Each manager writes
 * it in its own way, so saving with one format and searching with another returns nothing — and
 * “nothing” looks a lot like “this project has no vulnerabilities.”
 */
let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-pypi-"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

async function resolve(file: string, content: string): Promise<Map<string, string> | undefined> {
  const root = await mkdtemp(join(home, "proyecto-"));
  await writeFile(join(root, file), content, "utf8");
  return resolvePypiVersions(root, file);
}

describe("normalizePypiName", () => {
  it("colapsa las tres formas de escribir el mismo paquete", () => {
    for (const escrito of ["zope.interface", "zope_interface", "Zope-Interface", "ZOPE.INTERFACE"]) {
      expect(normalizePypiName(escrito), escrito).toBe("zope-interface");
    }
  });

  it("deja en paz un nombre que ya está en su forma canónica", () => {
    expect(normalizePypiName("requests")).toBe("requests");
    expect(normalizePypiName("typing-extensions")).toBe("typing-extensions");
  });
});

describe("poetry.lock", () => {
  const REAL = `[[package]]
name = "requests"
version = "2.31.0"
description = "Python HTTP for Humans."
optional = false
python-versions = ">=3.7"

[[package]]
name = "zope.interface"
version = "6.1"
description = "Interfaces for Python"
optional = false
python-versions = ">=3.7"

[metadata]
lock-version = "2.0"
python-versions = "^3.11"
content-hash = "6f8a1c"
`;

  it("saca nombre y versión de cada paquete", async () => {
    const versions = await resolve("poetry.lock", REAL);
    expect(versions?.get("requests")).toBe("2.31.0");
  });

  it("y guarda el nombre normalizado, que es como se va a buscar", async () => {
    const versions = await resolve("poetry.lock", REAL);
    expect(versions?.get("zope-interface")).toBe("6.1");
  });

  /*
    `[metadata]` brings `lock-version`, which is the version **of the format**. It is the same
    trick as `__metadata` in the yarn.lock of berry, and here it doesn't work because only the
    array `[[package]]` is read — but it is convenient to keep it written in case someone expands
    the reading.
   */
  it("no confunde la versión del formato con la de un paquete", async () => {
    const versions = await resolve("poetry.lock", REAL);
    expect(versions?.has("metadata")).toBe(false);
    expect([...(versions?.values() ?? [])]).not.toContain("2.0");
  });
});

describe("uv.lock", () => {
  /* Its format version is loose at the root of the TOML, not inside `[[package]]`. */
  const REAL = `version = 1
requires-python = ">=3.11"

[[package]]
name = "httpx"
version = "0.27.2"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "typing-extensions"
version = "4.12.2"
source = { registry = "https://pypi.org/simple" }
`;

  it("lee los paquetes sin tomar el `version = 1` de la raíz por uno de ellos", async () => {
    const versions = await resolve("uv.lock", REAL);
    expect(versions?.get("httpx")).toBe("0.27.2");
    expect(versions?.get("typing-extensions")).toBe("4.12.2");
    expect(versions?.size).toBe(2);
  });
});

describe("pdm.lock", () => {
  const REAL = `[metadata]
groups = ["default"]
strategy = ["cross_platform"]
lock_version = "4.4.1"

[[package]]
name = "flask"
version = "3.0.0"
requires_python = ">=3.8"
`;

  it("lee lo suyo, que tiene la misma forma que los otros dos", async () => {
    const versions = await resolve("pdm.lock", REAL);
    expect(versions?.get("flask")).toBe("3.0.0");
  });
});

describe("Pipfile.lock", () => {
  const REAL = JSON.stringify(
    {
      _meta: { hash: { sha256: "abc" }, "pipfile-spec": 6 },
      default: {
        requests: { version: "==2.31.0", hashes: ["sha256:aa"] },
        "zope.interface": { version: "==6.1" },
        desdegit: { git: "https://github.com/x/y.git", ref: "a1b2c3" },
        cualquiera: { version: "*" },
      },
      develop: { pytest: { version: "==7.4.4" } },
    },
    null,
    2,
  );

  it("quita el operador que viene pegado a la versión", async () => {
    const versions = await resolve("Pipfile.lock", REAL);
    expect(versions?.get("requests")).toBe("2.31.0");
  });

  it("mira también las de desarrollo, que se ejecutan en tu máquina igual", async () => {
    const versions = await resolve("Pipfile.lock", REAL);
    expect(versions?.get("pytest")).toBe("7.4.4");
  });

  it("normaliza el nombre como los demás", async () => {
    const versions = await resolve("Pipfile.lock", REAL);
    expect(versions?.get("zope-interface")).toBe("6.1");
  });

  it("deja fuera lo que no tiene una versión por la que preguntar", async () => {
    const versions = await resolve("Pipfile.lock", REAL);
    // There is no published version of git, and `*` is not a version: asking OSV about them returns
    // nothing and clutters the query.
    expect(versions?.has("desdegit")).toBe(false);
    expect(versions?.has("cualquiera")).toBe(false);
  });
});

describe("cuando el mismo paquete aparece dos veces", () => {
  /*
    poetry, uv, and pdm write duplicates **by ascending version**: they are mutually exclusive by
    environment marker, and in Python there is only one version installed per environment. Keeping
    the first one —which is what npm readers do— always keeps the oldest one, and that fails in
    both ways at the same time: it invents warnings that don’t matter and misses the ones that do.
    Measured over sample locks, 20 out of 20 duplicates chose the old one.
   */
  it("gana la mayor, no la primera", async () => {
    const versions = await resolve(
      "poetry.lock",
      `[[package]]
name = "cryptography"
version = "3.2.1"

[[package]]
name = "cryptography"
version = "36.0.1"
`,
    );
    expect(versions?.get("cryptography")).toBe("36.0.1");
  });

  it("y «mayor» se compara por números, no por letras", async () => {
    /* Alphabetically, '1.16.1' comes before '1.3.4', and '36.0.1' comes before '3.2.1'. */
    const versions = await resolve(
      "uv.lock",
      `[[package]]
name = "algo"
version = "1.16.1"

[[package]]
name = "algo"
version = "1.3.4"
`,
    );
    expect(versions?.get("algo")).toBe("1.16.1");
  });

  it("una preliberación pierde contra la versión limpia del mismo release", async () => {
    const versions = await resolve(
      "poetry.lock",
      `[[package]]
name = "algo"
version = "2.0.0"

[[package]]
name = "algo"
version = "2.0.0rc1"
`,
    );
    expect(versions?.get("algo")).toBe("2.0.0");
  });
});

describe("solo lo que viene de un índice de paquetes", () => {
  /*
    A git dependency, from a folder or installed as editable, does not have a published release to
    inquire about. If it slips through, it is queried to OSV as if it were from the registry:
    either the name does not exist and the empty is read as healthy, or it exists and the
    published version notices are attached to the project when what is installed is another
    commit.
   */
  it("deja fuera lo que viene de git, de una ruta o es editable", async () => {
    const versions = await resolve(
      "poetry.lock",
      `[[package]]
name = "del-indice"
version = "1.0.0"

[[package]]
name = "de-git"
version = "2.0.0"

[package.source]
type = "git"
url = "https://github.com/x/y.git"

[[package]]
name = "editable"
version = "3.0.0"
develop = true
`,
    );
    expect(versions?.get("del-indice")).toBe("1.0.0");
    expect(versions?.has("de-git")).toBe(false);
    expect(versions?.has("editable")).toBe(false);
  });

  it("un índice privado sí cuenta: sus paquetes están publicados en alguna parte", async () => {
    const versions = await resolve(
      "poetry.lock",
      `[[package]]
name = "interno"
version = "1.2.3"

[package.source]
type = "legacy"
url = "https://pypi.miempresa.com/simple"
`,
    );
    expect(versions?.get("interno")).toBe("1.2.3");
  });
});

describe("Pipfile.lock, lo que la forma del fichero esconde", () => {
  it("las categorías no son dos", async () => {
    /*
      All first-level keys except `_meta` are collections of packages. Reading only `default` and
      `develop` results in entire projects being lost: in a measured public repository, 101
      packages out of 173.
     */
    const versions = await resolve(
      "Pipfile.lock",
      JSON.stringify({
        _meta: { hash: { sha256: "abc" } },
        "build-packages": { setuptools: { version: "==69.0.0" } },
        default: { requests: { version: "==2.31.0" } },
        "docs-packages": { sphinx: { version: "==7.2.6" } },
      }),
    );
    expect(versions?.get("setuptools")).toBe("69.0.0");
    expect(versions?.get("sphinx")).toBe("7.2.6");
    expect(versions?.has("_meta"), "los metadatos no son un paquete").toBe(false);
  });

  /*
    `==2.22.*` is a range, not a pin, and OSV **does not reject it**: it swallows it and replies
    with a coarse match — twelve notices where 2.22.0 has eight —. It is not a silent zero, it is
    an inflated number with the face of a good response, which is harder to detect.
   */
  it("un comodín de prefijo no es una versión fijada", async () => {
    const versions = await resolve(
      "Pipfile.lock",
      JSON.stringify({ default: { requests: { version: "==2.22.*" }, flask: { version: "*" } } }),
    );
    expect(versions?.has("requests")).toBe(false);
    expect(versions?.has("flask")).toBe(false);
  });

  /* `==v2.15.0` is a legal PEP 440 pin and appears on published locks. */
  it("la uve delante sí es una versión, y se quita", async () => {
    const versions = await resolve(
      "Pipfile.lock",
      JSON.stringify({ develop: { "pre-commit": { version: "==v2.15.0" } } }),
    );
    expect(versions?.get("pre-commit")).toBe("2.15.0");
  });

  /* There are mixed entries: a git editable **with** its version next to it, which is the published one. */
  it("la procedencia se mira antes que la versión", async () => {
    const versions = await resolve(
      "Pipfile.lock",
      JSON.stringify({
        develop: {
          towncrier: { editable: true, git: "https://x/y.git", ref: "abc", version: "==19.2.0" },
        },
      }),
    );
    expect(versions?.has("towncrier")).toBe(false);
  });

  it("una categoría vacía es un mapa vacío, no un fichero ilegible", async () => {
    const versions = await resolve("Pipfile.lock", JSON.stringify({ _meta: {}, develop: {} }));
    expect(versions?.size).toBe(0);
  });
});

describe("cuando no se puede leer", () => {
  it("un candado que no existe es undefined", async () => {
    const root = await mkdtemp(join(home, "vacio-"));
    expect(await resolvePypiVersions(root, "poetry.lock")).toBeUndefined();
  });

  it("y uno ilegible también, que es distinto de uno legible y vacío", async () => {
    expect(await resolve("poetry.lock", "esto no es TOML {{{")).toBeUndefined();
  });

  it("pero un TOML bueno sin paquetes es un mapa vacío", async () => {
    expect((await resolve("poetry.lock", `[metadata]\nlock-version = "2.0"\n`))?.size).toBe(0);
  });
});
