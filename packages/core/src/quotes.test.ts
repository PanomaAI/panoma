import { describe, expect, it } from "vitest";
import { redactQuote } from "./quotes";

/**
 * This file checks both addresses at the same time, on purpose.
 *
 * A test that only checks that the credential is no longer there is also passed by a `redactQuote`
 * that returns the empty string; one that only checks that the phrase survives is passed by one
 * that does not touch anything. What is stated in almost all of the cases below is the exact
 * equality with the original phrase and the secret replaced by the sentinel: that says at the same
 * time that the credential is gone and that **not a single byte moved more**.
 *
 * The values carry 'CANARIO' inside for the same reason as in `links.test.ts`: if any escape to
 * the output they are recognized at a glance and are not confused with anything.
 */

/** It has to be identical to `REDACTED` from `packages/ai/src/safety.ts`. */
const CENTINELA = "«credencial oculta»";

/**
 * Each provider family, with the phrase that surrounds it and the exact piece that must disappear.
 * `secret` is what is crossed out, not what is recognized: in the rules that rely on the name next
 * to it (`aws_secret_access_key = …`) the name stays.
 */
const CANARIOS: { nombre: string; etiqueta: string; frase: string; secreto: string }[] = [
  {
    nombre: "una clave de proyecto de OpenAI",
    etiqueta: "clave de OpenAI",
    secreto: "sk-proj-CANARIO7Yh2Kq0Zx4Lp9Vb3Nm6Ts1Ur8Wd5Ef2Gh",
    frase: "falló con la clave sk-proj-CANARIO7Yh2Kq0Zx4Lp9Vb3Nm6Ts1Ur8Wd5Ef2Gh puesta",
  },
  {
    nombre: "una clave de Anthropic, que no se confunde con la de OpenAI",
    etiqueta: "clave de Anthropic",
    secreto: "sk-ant-api03-CANARIO4Kd8Fj2Ls9Qw7Er3Ty6Ui1Op5As0Dg",
    frase: "exporté ANTHROPIC_API_KEY=sk-ant-api03-CANARIO4Kd8Fj2Ls9Qw7Er3Ty6Ui1Op5As0Dg y ya",
  },
  {
    nombre: "la clave secreta de Stripe en producción",
    etiqueta: "clave de Stripe",
    secreto: "sk_live_CANARIO9d21Ab34Cd56Ef78",
    frase: "el cobro usa sk_live_CANARIO9d21Ab34Cd56Ef78, cámbiala antes de desplegar",
  },
  {
    nombre: "una clave restringida de Stripe",
    etiqueta: "clave de Stripe",
    secreto: "rk_live_CANARIO9d21Ab34Cd56Ef78",
    frase: "para el webhook vale rk_live_CANARIO9d21Ab34Cd56Ef78 y nada más",
  },
  {
    nombre: "un identificador de clave de acceso de AWS",
    etiqueta: "clave de acceso de AWS",
    secreto: "AKIACANARIO12345678Q",
    frase: "el despliegue va con AKIACANARIO12345678Q desde marzo",
  },
  {
    nombre: "una clave secreta de AWS, que lleva + y / dentro",
    etiqueta: "clave secreta de AWS",
    secreto: "CANARIOwJalrXUtnFEMI/K7MDENG+bPxRfiCYEXA",
    frase: "aws_secret_access_key = CANARIOwJalrXUtnFEMI/K7MDENG+bPxRfiCYEXA en el perfil",
  },
  {
    nombre: "un token clásico de GitHub",
    etiqueta: "token de GitHub",
    secreto: "ghp_CANARIO1234567890abcdefghijklmnopqrst",
    frase: "clona con ghp_CANARIO1234567890abcdefghijklmnopqrst que tiene permiso de lectura",
  },
  {
    nombre: "un token de acceso personal de GitHub del formato nuevo",
    etiqueta: "token de GitHub",
    secreto: "github_pat_CANARIO1234567890abcdefghij",
    frase: "el CI usa github_pat_CANARIO1234567890abcdefghij y caduca en junio",
  },
  {
    nombre: "una clave de API de Google",
    etiqueta: "clave de API de Google",
    secreto: "AIzaSyCANARIO-1234567890abcdefghijklmno",
    frase: "el mapa carga con AIzaSyCANARIO-1234567890abcdefghijklmno sin restricciones",
  },
  {
    nombre: "un token de bot de Slack",
    etiqueta: "token de Slack",
    secreto: "xoxb-CANARIO-1234567890-abcdefghij",
    frase: "el aviso lo manda xoxb-CANARIO-1234567890-abcdefghij al canal de guardia",
  },
  {
    nombre: "una clave de SendGrid, con sus tres partes",
    etiqueta: "clave de SendGrid",
    secreto: "SG.CANARIO_1234567890abcd.CANARIO_0987654321abcd",
    frase: "el correo sale con SG.CANARIO_1234567890abcd.CANARIO_0987654321abcd",
  },
  {
    nombre: "una clave de Groq",
    etiqueta: "clave de Groq",
    secreto: "gsk_CANARIO1234567890abcdefghij",
    frase: "prueba con gsk_CANARIO1234567890abcdefghij a ver si va más rápido",
  },
  {
    nombre: "una clave de xAI",
    etiqueta: "clave de xAI",
    secreto: "xai-CANARIO1234567890abcdefghij",
    frase: "en el .env local tengo xai-CANARIO1234567890abcdefghij desde ayer",
  },
  {
    nombre: "un JWT de tres partes",
    etiqueta: "token JWT",
    secreto: "eyJhbGciOiJIUzI1NiJ9.eyJDQU5BUklPIjoxfQ.CANARIOfirmaFalsa12345",
    frase: "devolvió eyJhbGciOiJIUzI1NiJ9.eyJDQU5BUklPIjoxfQ.CANARIOfirmaFalsa12345, caducado",
  },
  {
    nombre: "la clave service_role de Supabase, que se etiqueta por su nombre",
    etiqueta: "clave service_role de Supabase",
    secreto: "eyJhbGciOiJIUzI.eyJyb2xlIjoic2VydmljZSJ9.CANARIOfirma",
    frase: "SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI.eyJyb2xlIjoic2VydmljZSJ9.CANARIOfirma",
  },
  {
    nombre: "las credenciales de una URL de conexión a Postgres",
    etiqueta: "credenciales dentro de una URL",
    secreto: "panoma:CANARIO-clave-9d21",
    frase: "DATABASE_URL=postgres://panoma:CANARIO-clave-9d21@db.ejemplo.com:5432/panoma",
  },
  {
    nombre: "las credenciales de una URL de un registro privado",
    etiqueta: "credenciales dentro de una URL",
    secreto: "usuario:CANARIO-clave-77aa",
    frase: "instala desde https://usuario:CANARIO-clave-77aa@registro.ejemplo.com/paquete",
  },
  {
    nombre: "las credenciales de una URL de Redis, que van sin usuario delante",
    etiqueta: "credenciales dentro de una URL",
    secreto: ":CANARIO-clave-0U1R",
    frase: "REDIS_URL=redis://:CANARIO-clave-0U1R@cache.ejemplo.com:6379/0 y no responde",
  },
  {
    nombre: "un token de Twilio pegado a su SID",
    etiqueta: "token de Twilio",
    secreto: "deadbeefdeadbeefdeadbeefdeadbeef",
    frase: "credenciales: AC0123456789abcdef0123456789abcdef deadbeefdeadbeefdeadbeefdeadbeef",
  },
  {
    nombre: "un token de Twilio con su nombre delante",
    etiqueta: "token de Twilio",
    secreto: "cafebabecafebabecafebabecafebabe",
    frase: "TWILIO_AUTH_TOKEN=cafebabecafebabecafebabecafebabe en el fichero de despliegue",
  },
  {
    nombre: "un token corto detrás de una cabecera Bearer",
    etiqueta: "token en una cabecera Bearer",
    secreto: "CANARIO1234567890abcdefghij",
    frase: "iba con Authorization: Bearer CANARIO1234567890abcdefghij y dio 403",
  },
  {
    nombre: "un token con su nombre delante dentro de una URL",
    etiqueta: "credencial en una URL",
    secreto: "CANARIO1234567890abcdefghij",
    frase:
      "el enlace era https://api.ejemplo.com/v1/cosas?access_token=" +
      "CANARIO1234567890abcdefghij&pagina=2 y ya ha caducado",
  },
  {
    nombre: "una tirada larga que no es de nadie conocido",
    etiqueta: "cadena larga sin identificar",
    secreto: "CANARIOZzQqWwEeRrTtYyUuIiOoPpAaSsDdFfGgHhJjKk",
    frase: "respondió 401 con CANARIOZzQqWwEeRrTtYyUuIiOoPpAaSsDdFfGgHhJjKk y nada más",
  },
];

/** A full Ed25519 in PKCS#8: header of the format and 64 base64 characters. */
const ED25519 = "MC4CAQAwBQYDK2VwBCIEICANARIO7Yh2Kq0Zx4Lp9Vb3Nm6Ts1Ur8Wd5Ef2Gh0zQ";

/** A P-256 EC in SEC1: three lines, 164 base64 characters including padding. */
const EC_P256 =
  "MHcCAQEEIICANARIOjealnBQn5eUVtdolwxLafUb3BC0X8+qi/iK7DrRoAoGCCqG\n" +
  "SM49AwEHoUQDQgAE95yEj7e8c1PcRLrHJu/XSJnACANARIO8IkmOsnwluXXx7Jab\n" +
  "m5Fi8fYNa1TUGjkCF02aJ7QoSorHTtkpTA==";

/** The body of an OpenPGP armor, with its checksum line at the end. */
const PGP_ARMOR =
  "lQVYBGbCANARIOBDADQfKp2yF6vWnAdEr3Ty6Ui1Op5As0DgH7Jk2Lm4Nb6Qc8Rd\n" +
  "9Sf0Tg1Uh2Vi3Wj4Xk5Yl6Zm7An8Bo9Cp0Dq1Er2Fs3Gt4Hu5Iv6Jw7Kx8Ly9Mz0N\n" +
  "aObPcQdReSfTgUhViWjXkYlZmAnBoCpDqErFsGtHuIvJwKxLyMzN0O1P2Q3R4S5T\n" +
  "CANARIOfirmaFalsa8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1\n" +
  "X2Y3Z4a5b6c7d8e9f0g1h2i3j4k5l6m7n8o9p0q1r2s3t4u5v6w7x8y9z0A1B2C3\n" +
  "=CANA";

/**
 * Private keys that are not RSA, and the PGP armor.
 *
 * The two things that rule `private-key` assumed to be true but were not: that there is no key
 * below two hundred base64 characters (only valid for RSA) and that the OpenPGP armor ends in
 * `PRIVATE KEY-----` (it ends in `PRIVATE KEY BLOCK-----` ). With both, these three PEMs were
 * saved with the material inside: the first byte by byte identical and with `redacted: false`, and
 * the other two partially and with the label of another.
 */
const PEMS: { nombre: string; texto: string; esperado: string }[] = [
  {
    nombre: "una clave Ed25519, que mide 64 caracteres de base64 y no mil",
    texto: `-----BEGIN PRIVATE KEY-----\n${ED25519}\n-----END PRIVATE KEY-----`,
    esperado: `-----BEGIN PRIVATE KEY-----\n${CENTINELA}\n-----END PRIVATE KEY-----`,
  },
  {
    nombre: "una clave EC P-256 en SEC1, que mide 164 caracteres",
    texto: `-----BEGIN EC PRIVATE KEY-----\n${EC_P256}\n-----END EC PRIVATE KEY-----`,
    esperado: `-----BEGIN EC PRIVATE KEY-----\n${CENTINELA}\n-----END EC PRIVATE KEY-----`,
  },
  {
    nombre: "un bloque de PGP, cuya armadura lleva BLOCK detrás de KEY",
    texto:
      "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n" +
      `${PGP_ARMOR}\n-----END PGP PRIVATE KEY BLOCK-----`,
    esperado:
      "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n" +
      `${CENTINELA}\n-----END PGP PRIVATE KEY BLOCK-----`,
  },
];

describe("redactQuote: cada familia de credencial", () => {
  for (const canario of CANARIOS) {
    it(`tacha ${canario.nombre} y no toca el resto de la frase`, () => {
      const resultado = redactQuote(canario.frase);

      // Both directions at once: the secret is gone, everything else is the same.
      expect(resultado.text).toBe(canario.frase.split(canario.secreto).join(CENTINELA));
      expect(resultado.text).not.toContain(canario.secreto);
      // And without the end of value, in case some rule trimmed it thinking that it is worth that
      // way.
      expect(resultado.text).not.toContain(canario.secreto.slice(-12));
      expect(resultado.redacted).toBe(true);
      expect(resultado.labels).toContain(canario.etiqueta);
    });
  }

  it("tacha el cuerpo de una clave privada y deja los delimitadores", () => {
    const cuerpo = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwCANARIOggSjAgEAAoIBAQ".repeat(5);
    const texto = `-----BEGIN PRIVATE KEY-----\n${cuerpo}\n-----END PRIVATE KEY-----`;

    const resultado = redactQuote(texto);

    expect(resultado.text).toBe(
      `-----BEGIN PRIVATE KEY-----\n${CENTINELA}\n-----END PRIVATE KEY-----`,
    );
    expect(resultado.labels).toContain("clave privada");
  });

  for (const pem of PEMS) {
    it(`tacha el cuerpo de ${pem.nombre} y deja los delimitadores`, () => {
      const resultado = redactQuote(pem.texto);

      expect(resultado.text).toBe(pem.esperado);
      // The exact label, and not `toContain`: half key struck out by the generic network —which is
      // what was happening— appears as 'long unidentified string,' and then whoever reads the quote
      // does not know that what needs to be rotated is a key.
      expect(resultado.labels).toEqual(["clave privada"]);
    });
  }

  it("una clave pegada sin su línea de cierre se sigue tachando por el tamaño", () => {
    // Without `-----END` behind it, the closure cannot decide and sends the old cut: two hundred
    // base64 characters. Lowering the threshold to forty-eight **without** requiring the closure
    // would have marked the README in the test below again.
    const cuerpo = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwCANARIOggSjAgEAAoIBAQ".repeat(4);

    const resultado = redactQuote(`me pasó esto: -----BEGIN PRIVATE KEY-----\n${cuerpo}`);

    expect(resultado.text).toBe(`me pasó esto: -----BEGIN PRIVATE KEY-----\n${CENTINELA}`);
    expect(resultado.labels).toEqual(["clave privada"]);
  });

  it("las claves de arriba miden lo que mide una clave de verdad, no doscientos", () => {
    // The old cut was two hundred base64 characters, 'because a real key is over a thousand.' It's
    // true for RSA and nothing else: these are the sizes returned by `openssl` for the two modern
    // curves, and they are the ones that were in the key in the quote.
    expect(ED25519).toHaveLength(64);
    expect(EC_P256.replace(/\n/g, "")).toHaveLength(164);
  });

  it("tacha la contraseña de una URL de conexión aunque el usuario venga vacío", () => {
    // The canonical form of Redis and a common one in RabbitMQ. With a minimum of one user
    // character, these three were stored whole and `labels` came out empty.
    const frases = [
      ["rediss://:CANARIOx9KpQ2mNz@caching.ejemplo.com:25061/0", "rediss://"],
      ["amqp://:CANARIOguestpassword@rabbit.ejemplo.com:5672", "amqp://"],
      ["mongodb+srv://:CANARIOs3cretPassw0rd@cluster.ejemplo.net/", "mongodb+srv://"],
    ] as const;

    for (const [frase, esquema] of frases) {
      const resultado = redactQuote(frase);

      expect(resultado.text, frase).toBe(frase.replace(/^.*?@/, `${esquema}${CENTINELA}@`));
      expect(resultado.labels, frase).toEqual(["credenciales dentro de una URL"]);
    }
  });
});

describe("redactQuote: lo que tiene que sobrevivir intacto", () => {
  it("una frase normal sobre la interfaz sale byte por byte igual", () => {
    // The corpus of this module is this: what the user writes to their agent. If a phrase like this
    // comes back hurt, the module does more harm than it prevents.
    const frase =
      "El botón «Guardar» del panel de ajustes se sale del contenedor a 375 px: el texto se " +
      "corta y el icono queda pegado al borde derecho. Arréglalo sin tocar el espaciado del " +
      "resto del formulario.";

    const resultado = redactQuote(frase);

    expect(resultado.text).toBe(frase);
    expect(resultado.redacted).toBe(false);
    expect(resultado.labels).toEqual([]);
  });

  it("un SHA de git entero no es una credencial", () => {
    // Forty hexadecimals fall right within the generic network, and it is the most common thing in
    // a programming conversation.
    const frase = "el fallo entró en 3f2a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a, revísalo";

    expect(redactQuote(frase).text).toBe(frase);
    expect(redactQuote(frase).redacted).toBe(false);
  });

  it("una suma SHA-256 de un fichero tampoco", () => {
    const frase =
      "la suma es 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 " +
      "y coincide con la del artefacto";

    expect(redactQuote(frase).text).toBe(frase);
  });

  it("una ruta larga con un hash de compilación dentro sobrevive", () => {
    // The `app_landing_…_00ab11cd22ef33` section alone exceeds forty characters. If the generic
    // network didn't look at the whole piece, the route would become unusable.
    const frase =
      "mira apps/web/.next/static/chunks/" +
      "app_landing_landing-experience_tsx_00ab11cd22ef33.js que pesa 400 kB";

    expect(redactQuote(frase).text).toBe(frase);
    expect(redactQuote(frase).labels).toEqual([]);
  });

  it("una ruta de Windows con barras invertidas también", () => {
    const frase =
      "en Windows queda en C:\\Users\\jesus\\AppData\\Local\\" +
      "panoma_cache_00ab11cd22ef33aabbcc\\db y no se borra";

    expect(redactQuote(frase).text).toBe(frase);
  });

  it("lo que se tachaba de más antes de medir sobre transcripciones de verdad", () => {
    /*
      The ones below are literal: `redactQuote` went over 2,137 turns written by the user in the
      transcripts of this disc and this is what was struck out as extra. They are here so that the
      next rule someone adds will have to go through them again.
     */
    const medidos = [
      "añade `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` al manifiesto de Android",
      "el compilador iba con -Wnon-modular-include-in-framework-module",
      "y también con -fmodules-validate-once-per-build-session",
      "la migración `20260803000000_create_vision_usage_and_policies.sql` ya está aplicada",
      'en el manifiesto pone android:name="android.window.PROPERTY_COMPAT_ALLOW_ORIENTATION"',
      "lo leí en https://support.reddithelp.com/hc/en-us/articles/360043513151-Data-API-Terms",
      "el enlace traía ?_gl=1*164u6de*_ga*MTg4NDM0NTgxLjE3ODM4OTQ0MjY.*_ga_CW55HF8NVT*MTc4Mzg5",
      "el cliente es 203976783733-abc123def456.apps.googleusercontent.com, que es público",
      `el registro separaba los bloques con ${"-".repeat(64)}`,
    ];

    for (const frase of medidos) {
      expect(redactQuote(frase).text, frase).toBe(frase);
      expect(redactQuote(frase).redacted, frase).toBe(false);
    }
  });

  it("un ancla escrita a mano en un enlace no es un token aunque se llame key", () => {
    // The other half of the URL rule: `?token=aBc123…` yes, `?key=guia-de-estilo` no.
    const frase = "está en https://docs.ejemplo.com/guia?key=documentacion-de-referencia-larga";

    expect(redactQuote(frase).text).toBe(frase);
  });

  it("un identificador en kebab-case que empieza por sk- no es una clave de OpenAI", () => {
    // `sk-` is the prefix of the classes of load skeleton libraries. A truth key brings uppercase
    // letters and digits; a handwritten identifier does not.
    const frase = "la animación sk-fading-circle-large-rounded no arranca en Safari";

    expect(redactQuote(frase).text).toBe(frase);
    expect(redactQuote("el idioma sk-SK no está en el diccionario").redacted).toBe(false);
  });

  it("hablar de una clave privada no es filtrarla", () => {
    // The false positive that left twenty-one findings in `secrets.ts`: code removing header to
    // keep the base64.
    const frase = "el código hace .replace('-----BEGIN PRIVATE KEY-----', '') y luego parsea";

    expect(redactQuote(frase).text).toBe(frase);
  });

  it("ni enseñar la cabecera del formato en un README es filtrar una clave", () => {
    // `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw` is not secret material: it is the header of PKCS#8 and
    // it appears the same at the beginning of all RSA keys, so any documentation that explains how
    // to set the environment variable includes it. What separates it from a real key is not being
    // thirty-six long, it is that there is no `-----END` behind it.
    const frase =
      "en el README pone -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw\n" +
      "y luego el resto de la clave";

    expect(redactQuote(frase).text).toBe(frase);
    expect(redactQuote(frase).redacted).toBe(false);
  });

  it("un enlace reescrito por Microsoft sobrevive aunque mida seiscientos caracteres", () => {
    /*
      This is what the sweep window measures: the `&sdata=` at the end falls more than five
      hundred characters from the `https://`, and if the sweep does not reach the scheme, the
      exemption of "this is a URL" does not apply and the link goes back to being strikethrough.
      With the window at 512 it worked —checked— and that is why it is at 1,024.
     */
    const relleno = `%7C${"a1b2c3d4e5".repeat(20)}%7C`;
    const enlace =
      "https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fejemplo.com%2Fdoc" +
      `&data=05${relleno}MTg4NDM0NTgxLjE3ODM4OTQ0MjYuMTc4Mzg5NDQyNi4x${relleno}` +
      "&sdata=Xk92LmQpTvBz4RwYcHnE7aUdFgJiKoPsQ1Zx3Vb5abcd%3D&reserved=0";
    const frase = `el enlace era ${enlace} y no lo abras`;

    expect(enlace.length).toBeGreaterThan(600);
    expect(redactQuote(frase).text).toBe(frase);
  });

  it("una URL con puerto o con un ámbito de npm no lleva credenciales dentro", () => {
    const frases = [
      "abre http://localhost:3000/@vite/client para ver el error",
      "el paquete está en https://cdn.ejemplo.com/npm/@panoma/core/index.js",
      "el remoto es git@github.com:ana-ruiz/mapas.git",
    ];

    for (const frase of frases) {
      expect(redactQuote(frase).text, frase).toBe(frase);
    }
  });

  it("la palabra que sigue a «Bearer» en una frase no es un token", () => {
    const frase = "manda el Bearer authorization header, que es lo que espera la pasarela";

    expect(redactQuote(frase).text).toBe(frase);
  });
});

describe("redactQuote: contenido pegado sin espacios", () => {
  /*
    A JSON of one line, a `.env` stuck whole, an answer from a API: there are no spaces separating
    the credential from what is next to it, and the neighborhood that looks at the generic network
    was cut only at the blank space. That is, the neighborhood was the entire line and a
    `https://` in any field exempted **all** matches.
   */
  const TOKEN = "Xk92LmQpTvBz4RwYcHnE7aUdFgJiKoPsQ1Zx3Vb5CANARIO";

  it("un `https://` en otro campo del JSON no salva al token de al lado", () => {
    // The same token, two entries: without the `docs` field it was crossed out and with it it was
    // not.
    const frase = `{"token":"${TOKEN}","docs":"https://x.dev"}`;

    const resultado = redactQuote(frase);

    expect(resultado.text).toBe(`{"token":"${CENTINELA}","docs":"https://x.dev"}`);
    expect(resultado.labels).toEqual(["cadena larga sin identificar"]);
  });

  it("ni un `https://` detrás del punto y coma de un .env pegado en una línea", () => {
    const frase = `PANOMA_TOKEN=${TOKEN};API_URL=https://x.dev`;

    expect(redactQuote(frase).text).toBe(`PANOMA_TOKEN=${CENTINELA};API_URL=https://x.dev`);
  });

  it("pero la URL de verdad sigue exenta aunque venga pegada dentro del JSON", () => {
    // The other half, and the one that prevents fixing this roughly: cutting the neighborhood
    // cannot break the exemption that is indeed valid. The token lives **inside** the URL and
    // behind a `=`, so here there is no bar that saves the match: only the `://`.
    const frase = `{"enlace":"https://ejemplo.com/informe?v=${TOKEN}"}`;

    expect(redactQuote(frase).text).toBe(frase);
    expect(redactQuote(frase).redacted).toBe(false);
  });

  it("no se vuelve cuadrático cuando la línea no trae un solo espacio", () => {
    /*
      Measured on this laptop before restricting the sweep, with a `data:` URI pasted: 32 KB took
      0.23 s; 64 KB, 0.90 s; 128 KB, 3.7 s; 256 KB, 14.5 s. Four times for each doubling, that is
      O(n²), and the entire pass over the 82 transcriptions on this disk takes four seconds: a
      single pasted line cost more than the entire corpus. The caller (`history/claude-code.ts`)
      accepts lines of 512 KB and trims to 2,000 characters **after** striking through, so the
      ceiling must be in the sweep.
      The lower limit is loose on purpose: with the bounded sweep this takes 91 ms here, so a
      second is only exceeded if the sweep returns without limit.
     */
    const trozo = "CANARIOZzQqWwEeRrTtYyUuIiOoPpAaSsDdFfGgHhJjKkLlMmNnBbVvCcXx0123456789+/";
    const texto = `pegué esto en el chat: data:image/png;base64,${trozo.repeat(1_850)}`;
    expect(texto.length).toBeGreaterThan(128 * 1024);

    const inicio = Date.now();
    redactQuote(texto);

    expect(Date.now() - inicio).toBeLessThan(1_000);
  });
});

describe("redactQuote: lo que se cuenta de lo que se tachó", () => {
  it("las etiquetas van ordenadas, sin repetir, y dicen de quién era cada clave", () => {
    const texto =
      "probé con sk-proj-CANARIO7Yh2Kq0Zx4Lp9Vb3Nm6Ts1Ur8Wd5Ef2Gh, luego con " +
      "sk_live_CANARIO9d21Ab34Cd56Ef78 y al final con sk_test_CANARIO9d21Ab34Cd56Ef78";

    const resultado = redactQuote(texto);

    // Stripe comes out once even if two of its keys have been triggered.
    expect(resultado.labels).toEqual(["clave de OpenAI", "clave de Stripe"]);
    expect(resultado.text).not.toContain("CANARIO");
  });

  it("un texto sin credenciales no se marca como tachado", () => {
    const resultado = redactQuote("¿por qué tarda tanto el primer arranque?");

    expect(resultado.redacted).toBe(false);
    expect(resultado.labels).toEqual([]);
  });

  it("un texto vacío no se rompe", () => {
    expect(redactQuote("")).toEqual({ text: "", redacted: false, labels: [] });
  });
});

describe("redactQuote: volver a pasarlo no cambia nada", () => {
  it("es idempotente sobre un texto con credenciales de varias clases", () => {
    // The important thing is not that the result is the same, it is that the sentinel does not eat
    // anything on the second pass: `«credencial oculta»` cannot resemble a credential.
    const texto =
      "el despliegue usa AKIACANARIO12345678Q, la base está en " +
      "postgres://panoma:CANARIO-clave-9d21@db.ejemplo.com:5432/panoma y el bot manda con " +
      "xoxb-CANARIO-1234567890-abcdefghij desde apps/web/.next/static/chunks/" +
      "app_landing_landing-experience_tsx_00ab11cd22ef33.js";

    const primera = redactQuote(texto);
    const segunda = redactQuote(primera.text);

    expect(segunda.text).toBe(primera.text);
    expect(segunda.redacted).toBe(false);
    expect(segunda.labels).toEqual([]);
    expect(primera.labels).toEqual([
      "clave de acceso de AWS",
      "credenciales dentro de una URL",
      "token de Slack",
    ]);
  });
});
