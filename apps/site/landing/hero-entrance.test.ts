import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fuente = readFileSync(new URL("./hero-entrance.tsx", import.meta.url), "utf8");
const hoja = readFileSync(new URL("./hero-entrance.module.css", import.meta.url), "utf8");

/**
 * May the post never take away anyone's scroll again.
 *
 * For seven seconds and a bit, this piece pinned the document: `overflow: hidden` in the root,
 * `position: fixed` in the body, and a scroll listener that returned the page to the top if anyone
 * tried it. No skip button, and again on each visit.
 *
 * Four reference homepages were measured on Aug-28-2026 —Linear, Vercel, Stripe, and Raycast—
 * reading `overflow` and `position` from the document every few milliseconds after loading: **none
 * block scrolling at any time**. And NN/g's usability research on scroll hijacking explains the
 * cost: most participants got disoriented, and interpreted it as the page being **broken** — the
 * worst possible diagnosis for a tool's homepage.
 *
 * These tests read the file as text because what needs to be asserted are absences, and an absence
 * does not execute. If someone puts the lock back in, nothing would fail: the animation would
 * continue to look just as good.
 */
describe("la entrada no secuestra el scroll", () => {
  it("no toca el overflow del documento", () => {
    expect(fuente).not.toMatch(/\.style\.overflow\s*=/);
    expect(fuente).not.toMatch(/style\.overscrollBehavior\s*=/);
  });

  it("ni clava el cuerpo con position fixed", () => {
    expect(fuente).not.toMatch(/body\.style\.position\s*=/);
    expect(fuente).not.toMatch(/body\.style\.inset\s*=/);
  });

  /*
    The listener that returned the page to the top on every scroll attempt was the part that
    really felt like a browser failure.
   */
  it("ni devuelve la página arriba cuando alguien hace scroll", () => {
    expect(fuente).not.toMatch(/window\.scrollTo\(0,\s*0\)/);
    expect(fuente).not.toMatch(/scrollRestoration/);
  });
});

/**
 * And may there always be a way out.
 */
describe("la entrada se puede dejar", () => {
  it("cualquier gesto la cierra: rueda, dedo, tecla o clic", () => {
    for (const gesto of ["wheel", "touchstart", "scroll", "keydown", "pointerdown"]) {
      expect(fuente, `falta el oyente de ${gesto}`).toContain(`addEventListener("${gesto}", leave`);
    }
  });

  /*
    Passive, and it is not a micro-optimization: declaring the listener as passive is the promise
    that the gesture will NOT be canceled. Without it, the browser has to wait to see if you
    cancel it, and the scroll freezes right at the moment the person wants to leave.
   */
  it("y sin estorbar el gesto que los dispara", () => {
    expect(fuente).toMatch(/const opciones = \{ passive: true \} as const;/);
  });

  it("hay un botón de saltar, y no es solo un adorno visual", () => {
    expect(fuente).toMatch(/<button[\s\S]{0,120}onClick=\{leave\}/);
    expect(fuente).toMatch(/\{skipLabel\}/);
  });

  /*
    The button lives OUTSIDE of the `aria-hidden`. The entire decorative part —the hands, the
    particles— is hidden from screen readers, and if the button fell inside, the only announced
    exit would cease to exist for those who cannot see the screen.
   */
  it("y el botón no queda dentro de lo que se oculta a los lectores", () => {
    const botón = fuente.indexOf("onClick={leave}");
    const oculto = fuente.indexOf("<div className={styles.art} aria-hidden>");
    expect(botón).toBeGreaterThan(-1);
    expect(oculto).toBeGreaterThan(-1);
    expect(botón, "el botón de saltar está dentro del bloque aria-hidden").toBeLessThan(oculto);
  });

  it("y su área es la que se puede tocar con un pulgar", () => {
    expect(hoja).toMatch(/\.skip \{[\s\S]*?min-height: 44px;/);
  });
});

/**
 * The three cases in which it should not even start.
 */
describe("cuándo la entrada no se enseña", () => {
  it("a quien pidió menos movimiento", () => {
    expect(fuente).toMatch(/prefers-reduced-motion: reduce/);
  });

  it("a quien ya la vio en esta pestaña", () => {
    expect(fuente).toMatch(/if \(alreadySeen\(\)\)/);
    expect(fuente).toMatch(/sessionStorage/);
  });

  /*
    And to whom the browser restored the scroll to the middle of the page. Before, this was
    "solved" by pinning the document at the top — Chrome's late restoration would unsettle the
    destination of the particles — and that fix is exactly what the blocking brought. Without
    input, there is no destination to unsettle.
   */
  it("y a quien recargó a media página", () => {
    expect(fuente).toMatch(/window\.scrollY > 4/);
  });

  /*
    In the session and not forever: the entry is the presentation of the brand and deserves to be
    seen once per visit. `localStorage` would kill it for the rest of the year.
   */
  it("el recuerdo dura lo que la pestaña", () => {
    expect(fuente).not.toMatch(/localStorage[\s\S]{0,40}INTRO_SEEN_KEY/);
    expect(fuente).toMatch(/sessionStorage\.setItem\(INTRO_SEEN_KEY/);
  });
});
