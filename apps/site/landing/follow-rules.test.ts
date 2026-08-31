import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FOLLOW_HANDLE,
  MAX_ASKS,
  MIN_FILL_MS,
  RETRY_AFTER_MS,
  TRAP_FIELD,
  followIntentUrl,
  looksHuman,
  SUBSCRIBE_PATH,
  shouldAsk,
  type InviteMemory,
} from "./follow-rules";
import { LANDING_COPY } from "./landing-copy";

const AHORA = Date.UTC(2026, 7, 28);
const dia = 24 * 60 * 60 * 1000;

/** Any memory, to not repeat the form in each test. */
function recuerdo(partes: Partial<InviteMemory> = {}): InviteMemory {
  return { v: 1, status: "dismissed", at: AHORA, count: 1, ...partes };
}

/**
 * Where the button goes, which is the half that can be broken without it being noticed.
 *
 * A misspelled address here doesn't cause an error anywhere: it opens a new tab with an X page
 * that is not the account, and the visitor leaves. That's why it's checked.
 */
describe("la dirección de seguir", () => {
  it("apunta a x.com, que es donde vive el intento hoy", () => {
    const url = new URL(followIntentUrl("en"));
    expect(url.origin).toBe("https://x.com");
    expect(url.pathname).toBe("/intent/follow");
  });

  /*
    `twitter.com` keeps responding, but with a 301 to `x.com`: writing it old is one step too many
    at the only moment when the visitor is deciding.
   */
  it("y no al dominio viejo, que solo añadiría un redirigido", () => {
    expect(followIntentUrl("es")).not.toContain("twitter.com");
  });

  it("lleva la cuenta de la casa", () => {
    expect(new URL(followIntentUrl("en")).searchParams.get("screen_name")).toBe(FOLLOW_HANDLE);
  });

  /*
    The last step cannot change language: whoever has been reading in Spanish reaches a screen of
    X in Spanish, which is what the parameter `lang` does.
   */
  it("y le pide a X el idioma que se estaba leyendo aquí", () => {
    expect(new URL(followIntentUrl("es")).searchParams.get("lang")).toBe("es");
    expect(new URL(followIntentUrl("en")).searchParams.get("lang")).toBe("en");
  });
});

/**
 * When asked, that's where this pattern becomes annoying.
 *
 * Everything down here exists so that the card appears little. The test that really matters is the
 * penultimate one: it was a real failure of the first version of this file.
 */
describe("cuándo se pregunta", () => {
  it("a quien no ha visto nunca la tarjeta", () => {
    expect(shouldAsk({ memory: null, askedThisSession: false, visible: true, now: AHORA })).toBe(
      true,
    );
  });

  it("pero nunca dos veces en la misma pestaña", () => {
    expect(shouldAsk({ memory: null, askedThisSession: true, visible: true, now: AHORA })).toBe(
      false,
    );
  });

  /*
    Going back to a tab and finding a dialog that one did not see open is the most disconcerting
    version of this, and it happens by itself if the shot hits with the tab in the background.
   */
  it("ni en una pestaña que nadie está mirando", () => {
    expect(shouldAsk({ memory: null, askedThisSession: false, visible: false, now: AHORA })).toBe(
      false,
    );
  });

  it("al que ya fue no se le vuelve a pedir, pase el tiempo que pase", () => {
    const ido = recuerdo({ status: "followed", at: AHORA - 3650 * dia });
    expect(shouldAsk({ memory: ido, askedThisSession: false, visible: true, now: AHORA })).toBe(
      false,
    );
  });

  it("al que dijo «ahora no» se le espera un mes", () => {
    const ayer = recuerdo({ at: AHORA - dia });
    expect(shouldAsk({ memory: ayer, askedThisSession: false, visible: true, now: AHORA })).toBe(
      false,
    );

    const hace40 = recuerdo({ at: AHORA - 40 * dia });
    expect(shouldAsk({ memory: hace40, askedThisSession: false, visible: true, now: AHORA })).toBe(
      true,
    );
  });

  /*
    The invariant that broke by itself, and deserves to be told because it didn't give any error.
    The first version expired the memory upon READING IT: after a month, `readInvite` returned
    `null`, so the negative counter reset to zero and the limit of two was never reached. The card
    reappeared every thirty days, forever, to someone who had already said no twice. Now reading
    is reading and expiring is decided by this function — and this test is what prevents going
    back.
   */
  it("y a la segunda negativa se deja de preguntar, aunque pase un año", () => {
    const harto = recuerdo({ count: MAX_ASKS, at: AHORA - 365 * dia });
    expect(shouldAsk({ memory: harto, askedThisSession: false, visible: true, now: AHORA })).toBe(
      false,
    );
  });

  it("el plazo es un mes de verdad, no un número cualquiera", () => {
    expect(RETRY_AFTER_MS).toBe(30 * dia);
  });
});

/**
 * May the card remain short.
 *
 * It started out verbose —a preheadline, two long sentences, and a two-line note— and was cut at
 * the owner's request. This test does not judge style: it sets a ceiling. Without a ceiling, the prose
 * returns on its own, word by word, and no one sees the moment it stopped being short.
 */
describe("la tarjeta no se vuelve a llenar de texto", () => {
  for (const [idioma, copy] of Object.entries(LANDING_COPY)) {
    it(`el título y la frase caben en un vistazo (${idioma})`, () => {
      expect(copy.follow.title.length).toBeLessThanOrEqual(34);
      expect(copy.follow.body.length).toBeLessThanOrEqual(58);
    });

    it(`y la letra pequeña también (${idioma})`, () => {
      expect(copy.follow.emailNote.length).toBeLessThanOrEqual(58);
      expect(copy.follow.xLink.length).toBeLessThanOrEqual(24);
    });

    /*
      Both buttons are buttons, so their labels are short commands and none start with a
      conjunction: an 'or continue in X' would presuppose that they are two paths to the same
      place, and they are not — they are two different things that can both be done.
     */
    it(`las etiquetas de los dos botones son órdenes, no conjunciones (${idioma})`, () => {
      expect(copy.follow.xLink).not.toMatch(/^(o|or)\s/i);
      expect(copy.follow.subscribe).not.toMatch(/^(o|or)\s/i);
      expect(copy.follow.subscribe.length).toBeLessThanOrEqual(18);
    });

    /*
      The acknowledgment repeats the typed address, and it is not a matter of style: without a
      confirmation email, a typo never bounces — nobody ever finds out — so this line is the only
      chance to catch it that will exist.
     */
    it(`el acuse devuelve la dirección tecleada (${idioma})`, () => {
      expect(copy.follow.done).toContain("{email}");
    });

    /* And it no longer promises a confirmation that is not sent. */
    it(`y nada promete un correo de confirmación (${idioma})`, () => {
      for (const linea of [copy.follow.emailNote, copy.follow.done, copy.follow.body]) {
        expect(linea.toLowerCase()).not.toMatch(/confirm/);
      }
    });

    it(`cada pieza dice algo (${idioma})`, () => {
      for (const pieza of [
        copy.follow.title,
        copy.follow.body,
        copy.follow.emailLabel,
        copy.follow.emailPlaceholder,
        copy.follow.subscribe,
        copy.follow.emailNote,
        copy.follow.xLink,
        copy.follow.sending,
        copy.follow.done,
        copy.follow.error,
        copy.follow.newTab,
        copy.follow.close,
      ]) {
        expect(pieza.trim().length).toBeGreaterThan(0);
      }
      /*
        The account name no longer fits on the button — 'Follow on X' and that's it —, but the
        destination is still that of the house: the address block confirms it.
       */
      expect(followIntentUrl("en")).toContain(FOLLOW_HANDLE);
    });
  }
});

/**
 * The email form, which only exists if there is someone to send it to.
 *
 * A `<form>` pointing to Buttondown with the empty user would not give an error: it would give a
 * broken address that silently swallows the sign-ups. Without a user there is no form, and the
 * card is left with the only thing that always works — the link to X.
 */
describe("adónde va el alta", () => {
  /*
    To a route of this same house, and that is the whole decision: the list is ours.
    Two suppliers were discarded along the way, and it is advisable to have it fixed, because
    'since we are here, this can be done with a three-line form' is a reform that someone will
    propose: Buttondown does not allow turning off the confirmation email in public sign-up forms,
    and Loops does, but the list would stay at their house.
   */
  it("apunta a una ruta nuestra, no a un dominio ajeno", () => {
    expect(SUBSCRIBE_PATH.startsWith("/")).toBe(true);
    expect(SUBSCRIBE_PATH).not.toContain("//");
  });

  /*
    And the route really exists. A handwritten path that has no file behind it returns a 404 that
    the browser shows as "could not be registered," with no other hint.
   */
  it("y esa ruta tiene fichero", () => {
    const manejador = new URL(`../app${SUBSCRIBE_PATH}/route.ts`, import.meta.url);
    expect(existsSync(manejador), `no existe ${manejador.pathname}`).toBe(true);
  });
});

/**
 * That the base keys cannot descend to the browser.
 *
 * It is the kind of failure that does not cause an error and is not visible: it is enough for
 * someone to rename the variable with the public prefix — or import the server module from a
 * client component — to expose a credential that bypasses all row policies.
 */
describe("la llave se queda en el servidor", () => {
  const servidor = readFileSync(new URL("../lib/subscribe.ts", import.meta.url), "utf8");
  const cliente = readFileSync(new URL("./follow-invite.tsx", import.meta.url), "utf8");

  /*
    `server-only` turns the import from the client into a compilation error. It is the only guard
    that acts alone, without anyone remembering to check.
   */
  it("el módulo que la usa está marcado como de servidor", () => {
    expect(servidor.startsWith('import "server-only";')).toBe(true);
  });

  /*
    The prefix `NEXT_PUBLIC_` puts the value into the package that the visitor downloads. With
    this specific key, that is giving away the entire database.
   */
  it("y su variable no lleva el prefijo que la publicaría", () => {
    /*
      The variable is named, it is read directly or through the slicing: what is stated is which
      one is read, not how.
     */
    expect(servidor).toContain('"SUPABASE_SECRET_KEY"');
    expect(servidor).not.toMatch(/NEXT_PUBLIC_SUPABASE/);
  });

  /*
    And it gets cut off. Pasting a key into a provider's panel easily drags a line break, and a
    header HTTP with a break inside is not valid: the request doesn't even go through, and the
    symptom is a 'could not write' without any clue. It happened in production on August 28, 2026.
   */
  it("y se recorta antes de meterla en una cabecera", () => {
    expect(servidor).toMatch(/return \(process\.env\[nombre\] \?\? ""\)\.trim\(\);/);
  });

  /*
    And when something fails, the log shows the code: without it, the three possible causes—key,
    address, network—look exactly the same from the outside.
   */
  it("y un fallo deja dicho el código en el registro", () => {
    expect(servidor).toMatch(/Supabase contestó \$\{response\.status\}/);
  });

  it("y el componente de la tarjeta no la nombra siquiera", () => {
    expect(cliente).not.toMatch(/SUPABASE/);
  });
});

/**
 * The two traps for robots, and what they really reach.
 *
 * This form sends to an external domain, so anyone can skip the entire page and talk to the Loops
 * endpoint directly: there's nothing here against that, and that's what Loops handles. What they
 * do stop are the bots that crawl pages and fill out forms, which is where the noise comes from on
 * a small site.
 */
describe("las trampas para robots", () => {
  it("una persona pasa: campo cebo vacío y tiempo de sobra", () => {
    expect(looksHuman({ trap: "", renderedAt: 0, now: MIN_FILL_MS + 1 })).toBe(true);
  });

  it("el que rellena el cebo no pasa, por mucho que espere", () => {
    expect(looksHuman({ trap: "http://spam.example", renderedAt: 0, now: 60_000 })).toBe(false);
  });

  it("ni el que contesta antes de que dé tiempo a leer", () => {
    expect(looksHuman({ trap: "", renderedAt: 0, now: 300 })).toBe(false);
  });

  /*
    The name of the bait matters in both directions: `honeypot` or `hp` the robots recognize them
    and skip them; `company`, `phone` or `name` would be filled in by a person's password manager
    and we would be blocking who we want.
   */
  it("el cebo se llama como un cebo y no como un dato de nadie", () => {
    expect(TRAP_FIELD).toBe("website");
  });

  /* Two seconds: what it takes to read, click, and type an address. */
  it("y el reloj deja tiempo humano", () => {
    expect(MIN_FILL_MS).toBeGreaterThanOrEqual(1500);
    expect(MIN_FILL_MS).toBeLessThanOrEqual(5000);
  });
});

/**
 * The form of the dialogue, read from the component.
 *
 * They are four decisions that have no way of being executed in a test —an absence, an element, an
 * attribute— and all four fail without giving an error: the dialog would continue to open, only
 * without trapped focus, without escape, or interrupting the reading.
 */
describe("la forma de la tarjeta", () => {
  const fuente = readFileSync(new URL("./follow-invite.tsx", import.meta.url), "utf8");
  const hoja = readFileSync(new URL("./follow-invite.module.css", import.meta.url), "utf8");

  /*
    The trap that took out the subscribe button, and it didn't give any error.
    `landing.module.css` opens with `.page button { border: 0; background: none; }`, and this card
    lives inside `.page`. That selector has specificity (0,1,1) versus (0,1,0) for a loose class, so it won: the
    button came out without a background, with light text on white, unreadable. The rule applied —
    another one won. It was seen in a capture with a real browser, not in any test.
    And the same family as the centered one: the `<dialog>` modal is centered by the browser with
    a `margin: auto` that Tailwind's reset deletes, so it is also handwritten.
   */
  it("lo interactivo gana a las reglas de la landing", () => {
    for (const clase of ["subscribe", "close", "email", "xButton"]) {
      expect(hoja, `.${clase} sin prefijo pierde contra .page button`).toMatch(
        new RegExp(`\\.dialog \\.${clase} \\{`),
      );
    }
  });

  it("y el centrado va escrito, no heredado del navegador", () => {
    expect(hoja).toMatch(/position: fixed;\s*\n\s*inset: 0;\s*\n\s*margin: auto;/);
  });

  /*
    `<dialog>` with `showModal()` gives the capture of the focus, the escape key, the inert
    background, and the top layer for free. A `<div>` with `position: fixed` gives none.
   */
  it("es un dialog nativo abierto con showModal", () => {
    expect(fuente).toContain("<dialog");
    expect(fuente).toMatch(/dialog\.current\?\.showModal\(\)/);
  });

  /*
    And never with the attribute `open` written: that gives a NON-modal dialog —without
    background, without trapped focus, without escape— that seems to work until someone presses
    Escape. It is the classic trap of this element.
   */
  it("y nunca con el atributo open puesto a mano", () => {
    expect(fuente).not.toMatch(/<dialog[^>]*\sopen[\s>]/);
  });

  /*
    What is remembered is remembered in `close`, which is the only point through which the four
    outputs pass: the propeller, 'not now,' the escape key, and the click on the background.
   */
  it("guarda la respuesta en el cierre, no en cada botón", () => {
    expect(fuente).toMatch(/onClose=\{remember\}/);
    expect(fuente).toMatch(/writeInvite\(/);
  });

  /*
    The sentinel is what delays the card until the end of the page. Without it, or placed higher
    up, this becomes one of those interrupting interstitials.
   */
  it("y espera a que el visitante llegue al final para asomar", () => {
    expect(fuente).toContain("IntersectionObserver");
    expect(fuente).toMatch(/data-follow-sentinel/);
  });
});
