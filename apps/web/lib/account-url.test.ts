import { describe, expect, it } from "vitest";
import { normalizeAccountUrl } from "./account-url";

/**
 * What can be noted in the account link field.
 *
 * The failure that brought these tests: `localhost:3000` and `192.168.1.5:8080` did not pass the
 * filter and were **silently discarded** —the row was saved without complaint and the field came
 * back empty—, right in the section that promises to remember what you enter. So there are two
 * families of tests and both matter: that `host:puerto` gets in, and that what does not get in
 * **comes out with its text** so it can be notified instead of thrown away.
 */

/** Readable shortcut: what would be saved, or `null` if it was not understood. */
function saved(input: string): string | null {
  const result = normalizeAccountUrl(input);
  return result.kind === "url" ? result.url : null;
}

describe("host:puerto, que era lo que se perdía", () => {
  it("acepta el servidor de desarrollo de siempre", () => {
    expect(saved("localhost:3000")).toBe("http://localhost:3000");
  });

  it("acepta una máquina de la red local con su puerto", () => {
    expect(saved("192.168.1.5:8080")).toBe("http://192.168.1.5:8080");
  });

  it("y les pone http, no https, porque si no el enlace no abre", () => {
    /* Saving `https://localhost:3000` is as useless as saving nothing. */
    for (const local of ["localhost:3000", "127.0.0.1:5432", "10.0.0.2", "mi-nas:8123"]) {
      expect(saved(local)).toMatch(/^http:\/\//);
    }
  });

  it("un dominio de verdad con puerto sí habla https", () => {
    expect(saved("ejemplo.com:8443/panel")).toBe("https://ejemplo.com:8443/panel");
  });

  it("con ruta detrás también", () => {
    expect(saved("localhost:3000/admin?tab=1")).toBe("http://localhost:3000/admin?tab=1");
  });

  it("e IPv6, que es la otra forma de decir «esta máquina»", () => {
    expect(saved("[::1]:3000")).toBe("http://[::1]:3000");
  });
});

describe("lo que ya funcionaba sigue funcionando", () => {
  it("el dominio a secas se lleva su https", () => {
    expect(saved("vercel.com/panoma")).toBe("https://vercel.com/panoma");
  });

  it("la dirección con esquema se respeta tal cual", () => {
    expect(saved("https://dash.stripe.com/test")).toBe("https://dash.stripe.com/test");
  });

  it("y no se reescribe lo que se escribió", () => {
    /*
      `new URL` would normalize this to `https://vercel.com/`. Whoever writes something expects to
      read the same thing they wrote.
     */
    expect(saved("https://vercel.com")).toBe("https://vercel.com");
  });

  it("quien escribe el esquema manda, aunque el nombre no tenga punto", () => {
    expect(saved("http://localhost")).toBe("http://localhost");
  });

  it("una arroba en la ruta no estorba", () => {
    expect(saved("npmjs.com/package/@panoma/core")).toBe(
      "https://npmjs.com/package/@panoma/core",
    );
  });
});

describe("el campo vacío no es un error", () => {
  it.each([undefined, null, "", "   "])("%p no dice nada", (input) => {
    expect(normalizeAccountUrl(input).kind).toBe("empty");
  });
});

describe("lo que no se entiende vuelve con su texto, no se tira", () => {
  it("conserva intacto lo que se escribió", () => {
    const result = normalizeAccountUrl("  esto no es una dirección  ");
    expect(result).toEqual({ kind: "unusable", text: "esto no es una dirección" });
  });

  it("un nombre suelto es una etiqueta en el campo equivocado", () => {
    expect(normalizeAccountUrl("vercel").kind).toBe("unusable");
  });

  it("un correo también, y avisar manda a la persona al campo de al lado", () => {
    expect(normalizeAccountUrl("yo@ejemplo.com").kind).toBe("unusable");
    expect(normalizeAccountUrl("mailto:yo@ejemplo.com").kind).toBe("unusable");
  });

  it("un puerto imposible no se guarda a medias", () => {
    expect(normalizeAccountUrl("localhost:99999").kind).toBe("unusable");
  });

  it("y `https://` a secas tampoco", () => {
    expect(normalizeAccountUrl("https://").kind).toBe("unusable");
  });
});

describe("solo sale http o https", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(document.domain)",
    "data:text/html,<script>1</script>",
    "file:///etc/passwd",
    "ftp://archivos.ejemplo.com",
    "vbscript:msgbox(1)",
  ])("%s no pasa", (hostile) => {
    expect(normalizeAccountUrl(hostile).kind).toBe("unusable");
  });

  it("un esquema partido por el saneador tampoco cuela", () => {
    /* The server changes the line breaks to spaces before they get here. */
    expect(normalizeAccountUrl("java script:alert(1)").kind).toBe("unusable");
  });

  it("nada de lo que se guarda empieza por otra cosa", () => {
    const entradas = [
      "localhost:3000", "vercel.com", "https://a.com", "[::1]:80",
      "javascript:alert(1)", "mailto:yo@ejemplo.com", "ejemplo.com:8443",
    ];
    for (const entrada of entradas) {
      const guardado = saved(entrada);
      if (guardado !== null) expect(guardado).toMatch(/^https?:\/\//);
    }
  });
});
