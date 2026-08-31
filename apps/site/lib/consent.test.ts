import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSENT_SIGNALS, COOKIE_COPY } from "./consent";

const analytics = readFileSync(new URL("../app/analytics.tsx", import.meta.url), "utf8");
const consent = readFileSync(new URL("./consent.ts", import.meta.url), "utf8");
const notice = readFileSync(new URL("./cookie-notice.tsx", import.meta.url), "utf8");
const noticeCss = readFileSync(new URL("./cookie-notice.module.css", import.meta.url), "utf8");

/**
 * The order of the queue of `gtag`, which is the only thing that makes the banner useful.
 *
 * `gtag()` does not call anyone: it does `dataLayer.push(arguments)`. When the Google library
 * loads, it plays that queue in order. So the default consent has to be in the queue BEFORE
 * `config`; if it arrives later, the library first processes `config`, GA4 writes the cookies and
 * sends the first visit, and the `default` that comes after no longer undoes anything — the cookie
 * is set and the data is in Google.
 *
 * The file is read as text because what is stated is an order, and an order is not executed. If
 * this is broken, nothing visible fails: the banner simply becomes decorative and the page writes
 * cookies without permission.
 */
describe("el consentimiento va antes que la medición", () => {
  it("el default está en el script, y por delante del config", () => {
    const posDefault = analytics.indexOf("gtag('consent', 'default'");
    const posConfig = analytics.indexOf("gtag('config'");
    expect(posDefault, "no encuentro el consentimiento por defecto").toBeGreaterThan(-1);
    expect(posConfig, "no encuentro el config").toBeGreaterThan(-1);
    expect(posDefault, "el config va antes que el consentimiento").toBeLessThan(posConfig);
  });

  /*
    Everything in «denied» for output. The opposite — measure and then ask — is exactly what is
    fined: when one asks, the cookie is already written.
   */
  it("y arranca denegando, no concediendo", () => {
    /*
      The line is made by going through the signals, so what is fixed is the template that writes
      them — and that its value is `denied`. A `granted` there would be measuring everyone with a
      banner put on as decoration.
     */
    expect(analytics).toMatch(/\$\{signal\}': 'denied',/);
    expect(analytics).not.toMatch(/\$\{signal\}': 'granted',[\s\S]{0,200}consent', 'default'/);
    expect(CONSENT_SIGNALS).toHaveLength(4);
  });

  /*
    And the four are the ones that a Google product really looks at: the other three of the API do
    not change the behavior of any of its own, and declaring them would imply that they turn
    something off.
   */
  it("y son las cuatro que Google respeta", () => {
    expect([...CONSENT_SIGNALS]).toEqual([
      "ad_storage",
      "ad_user_data",
      "ad_personalization",
      "analytics_storage",
    ]);
  });

  /*
    And it goes in the server script, not in an effect. A `default` inside a `useEffect`, a
    promise or a network response reaches the queue AFTER the `config` — it's the same bug above
    with a different face, and the easiest to introduce accidentally.
   */
  it("el script del consentimiento corre antes que nada del cliente", () => {
    expect(analytics).toMatch(/id="ga-consent"\s+strategy="beforeInteractive"/);
  });

  it("y la librería de Google va después de ese script", () => {
    expect(analytics.indexOf("ga-consent")).toBeLessThan(analytics.indexOf("ga-lib"));
  });

  /*
    The previous response is read synchronously within the script itself, for the same reason: any
    asynchronous reading would arrive late to the queue.
   */
  it("la respuesta guardada se lee en el propio script, no después", () => {
    expect(analytics).toMatch(/window\.localStorage\.getItem\('\$\{CONSENT_KEY\}'\)/);
    /* And what is done with it is a `update`, within the same script. */
    expect(analytics).toMatch(/gtag\('consent', 'update'/);
  });
});

/**
 * And that the answer reaches Google immediately, not on the next reload.
 */
describe("cuando alguien contesta", () => {
  it("se guarda y se manda un update", () => {
    expect(consent).toMatch(/localStorage\.setItem\(/);
    expect(consent).toMatch(/gtag\(\s*"consent",\s*"update"/);
  });

  /*
    `update` and not a second `default`: the `default` is only valid before anything has used the
    consent, and by then the library is already loaded.
   */
  it("con update y nunca con otro default", () => {
    expect(consent).not.toMatch(/"consent",\s*"default"/);
  });

  it("y no revienta si el navegador no deja guardar", () => {
    expect(consent).toMatch(/try \{[\s\S]*catch/);
  });
});

/**
 * That rejecting continues to cost the same as accepting.
 *
 * Consent is only valid if it is free, and it ceases to be so when saying no costs more than
 * saying yes. It is the pattern that European authorities have been sanctioning for years, and the
 * one that returns every time someone wants to 'improve the conversion' of the banner.
 */
describe("los dos botones pesan lo mismo", () => {
  it("comparten la misma clase, sin variante para el de aceptar", () => {
    const botones = notice.match(/className=\{styles\.button\}/g) ?? [];
    expect(botones).toHaveLength(2);
    expect(notice).not.toMatch(/styles\.(accept|primary|highlight)\b/);
  });

  it("y el rechazar va primero, que es donde cae la vista", () => {
    expect(notice.indexOf('answer("denied")')).toBeLessThan(notice.indexOf('answer("granted")'));
  });

  it("la hoja no le pone un fondo distinto a ninguno de los dos", () => {
    /*
      A single rule `.button`: if `.button` appears with a modifier, someone broke the symmetry.
     */
    expect(noticeCss).not.toMatch(/\.button[A-Z]/);
  });
});

/**
 * And may the strip not turn into a wall.
 *
 * Blocking the page until someone responds not only annoys: pressing to get the 'yes' is precisely
 * what invalidates the consent being collected.
 */
describe("la franja no bloquea la página", () => {
  it("no es un diálogo modal", () => {
    expect(notice).not.toContain("showModal");
    expect(notice).not.toContain("<dialog");
    expect(notice).toContain('role="region"');
  });

  it("y tiene nombre para quien no la ve", () => {
    expect(notice).toMatch(/aria-label=\{copy\.label\}/);
  });

  /*
    Without analytics there is nothing to consent to, and asking anyway teaches people to press
    'accept' without reading — which is what makes the next banner useless.
   */
  it("no aparece si no hay analítica que consentir", () => {
    expect(notice).toMatch(/if \(!enabled\) return;/);
  });
});

/**
 * What the stripe says, which is also an obligation and not a matter of style.
 */
describe("el texto dice qué, quién y qué pasa si no", () => {
  for (const [idioma, copy] of Object.entries(COOKIE_COPY)) {
    it(`nombra a Google, que es el tercero (${idioma})`, () => {
      expect(copy.text).toContain("Google");
    });

    it(`y las dos respuestas existen y son cortas (${idioma})`, () => {
      expect(copy.accept.trim().length).toBeGreaterThan(0);
      expect(copy.reject.trim().length).toBeGreaterThan(0);
      expect(copy.text.length).toBeLessThanOrEqual(70);
    });

    /*
      Nor does it apologize. The first version said 'without your permission it doesn't
      activate, and the page works the same': true, but two consecutive defenses against an
      accusation that no one has made — and the owner read it as scary. A justified stripe invites
      looking for the problem; the two buttons already say there is a choice.
     */
    it(`y no se pone a la defensiva (${idioma})`, () => {
      expect(copy.text.toLowerCase()).not.toMatch(/permiso|permission|igual|the same|tranquil/);
    });
  }
});
