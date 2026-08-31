import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./ai-panel.tsx", import.meta.url), "utf8");

/**
 * That the AI screen renders itself when entering through the menu.
 *
 * The bug, reported and reproduced on 28-Aug-2026: entering “AI” from the sidebar would leave
 * “reading configuration…” forever, with the server healthy responding in 0.4 s. Typing the
 * address did work, which is why it seemed intermittent — but it wasn’t: what separates the two
 * cases is whether the mount is the first on the page or a client one.
 *
 * The cause is a one-off. The component carries a `mounted` flag to avoid calling `setState` on
 * something that has been unmounted, and it clears it during the effect cleanup. `useRef(true)`
 * only sets it the first time the instance is created, so **no one was setting it again**: in
 * development React mounts, cleans up, and remounts on purpose, and from that first flash the flag
 * stayed at `false`. From there, all the `if (!mounted.current) return` in this file were going
 * out the back door, including the one immediately after `fetch` — the response arrived fully and
 * was discarded.
 *
 * The component is read as text instead of being mounted, which is how shape invariants are tested
 * here: what must be asserted is that the effect **raises** the flag in addition to lowering it,
 * and that can be seen in the code.
 */
describe("la bandera de montado del panel de IA", () => {
  /** The effect that the flag manages, with its cleanliness. */
  const efecto =
    /useEffect\(\(\) => \{\s*\n\s*mounted\.current = true;[\s\S]*?\n {2}\}, \[\]\);/.exec(panel)?.[0] ??
    "";

  it("el efecto levanta la bandera al montar", () => {
    expect(efecto, "el efecto no empieza subiendo mounted.current").not.toBe("");
  });

  it("y la baja al desmontar, que era lo único que hacía antes", () => {
    expect(efecto).toMatch(/return \(\) => \{[\s\S]*mounted\.current = false;/);
    expect(efecto).toMatch(/waiting\.current\?\.abort\(\)/);
  });

  /*
    The order matters and it is not seen on its own. Effects run in the order in which they are
    declared, so the one for the flag has to go BEFORE the one that calls `load`: if the order is
    reversed, `load` would look at a flag that has not yet been raised and would throw the
    response again.
   */
  it("y va declarado antes que el efecto que dispara la carga", () => {
    const bandera = panel.indexOf("mounted.current = true;");
    const carga = panel.indexOf("void load();");
    expect(bandera).toBeGreaterThan(-1);
    expect(carga).toBeGreaterThan(-1);
    expect(bandera, "la carga se dispara antes de levantar la bandera").toBeLessThan(carga);
  });

  /*
    And the flag continues keeping what it had to keep. If someone 'simplifies' by removing the
    checks, the error that caused them returns: `setNotice` on a component dismantled after a
    login that took six minutes.
   */
  it("las comprobaciones que la usan siguen ahí", () => {
    const guardas = panel.match(/if \(!mounted\.current\) return;/g) ?? [];
    expect(guardas.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * And that, no matter what happens, the wait has an end.
 *
 * It is the other path to the same symptom. `loadError` covers the response that arrives
 * incorrectly; without a roof, the one that **does not arrive** left the panel waiting
 * indefinitely: no error, no button, and nothing to distinguish 'it's slow' from 'it's dead'.
 */
describe("la espera de la pantalla de IA", () => {
  const techoDelPanel = () => {
    const encontrado = /const AWAIT_CEILING_MS = ([\d_]+);/.exec(panel);
    expect(encontrado, "no encuentro el techo del panel").not.toBeNull();
    return Number(encontrado![1]!.replaceAll("_", ""));
  };

  it("la carga lleva un techo, no espera indefinidamente", () => {
    const carga = /const load = useCallback\([\s\S]*?\n {2}\}, \[t\]\);/.exec(panel)?.[0] ?? "";
    expect(carga, "no encuentro la función de carga").not.toBe("");
    expect(carga).toMatch(/signal:\s*AbortSignal\.timeout\(AWAIT_CEILING_MS\)/);
  });

  /*
    The invariant that really breaks by itself.
    The route starts a process for each CLI agent to ask for its version, with a limit of fifteen
    seconds per probe. They run in parallel, so a legitimate response can take those fifteen
    seconds. A client-side cap lower than that would turn a slow machine into a false error — and
    it would be a one-digit change, in another package, with nothing red.
   */
  it("el techo deja pasar el sondeo más lento que el servidor permite", () => {
    const cli = readFileSync(
      new URL("../../../packages/ai/src/cli-agent.ts", import.meta.url),
      "utf8",
    );
    const sondeo = /timeout:\s*([\d_]+)\s*\}/.exec(cli);
    expect(sondeo, "no encuentro el tope del sondeo en packages/ai").not.toBeNull();
    const topeSondeo = Number(sondeo![1]!.replaceAll("_", ""));

    expect(topeSondeo).toBeGreaterThan(0);
    expect(techoDelPanel()).toBeGreaterThan(topeSondeo);
  });

  /*
    And not so long that it stops being a roof: half an hour looking at a gray text is the same as
    having none.
   */
  it("pero sigue siendo una espera humana", () => {
    expect(techoDelPanel()).toBeLessThanOrEqual(60_000);
  });

  /*
    To win and not to arrive are two different things, and they are said differently.
    Without this separation, a catalog loaded but slowly would answer "could not contact the
    catalog," which prompts to check if the server is down — and it is in front, working. Measured
    at both sites on 28-Aug-2026: in the browser the expiration is a `DOMException` named
    `TimeoutError` and the network down a `TypeError`; in Node both are `TypeError`. This file
    runs in the browser, so the distinction matters.
   */
  it("distingue el vencimiento de la red caída", () => {
    expect(panel).toMatch(/error\.name === "TimeoutError"/);
    expect(panel).toMatch(/t\("ai\.loadTimeout"\)/);
    expect(panel).toMatch(/t\("task\.unreachable"\)/);
  });

  /*
    The intermediate notice. It doesn't speed anything up: it prevents fifteen legitimate seconds
    from being read as a freeze. And it goes with `role="status"` because it is a text that
    **changes** by itself, and a change that is only seen does not exist for someone using a
    screen reader.
   */
  it("avisa antes de vencer, y el aviso se anuncia", () => {
    const aviso = /const SLOW_NOTICE_MS = ([\d_]+);/.exec(panel);
    expect(aviso, "no encuentro el aviso intermedio").not.toBeNull();
    const cuando = Number(aviso![1]!.replaceAll("_", ""));

    expect(cuando).toBeGreaterThan(0);
    expect(cuando, "avisar después de vencer no avisa de nada").toBeLessThan(techoDelPanel());
    expect(panel).toMatch(/role="status"[\s\S]{0,120}ai\.loadingSlow/);
  });

  /*
    And the warning timer turns off no matter what happens, including the good return: if not, the
    text jumps to 'keep reading…' six seconds after the panel is already rendered.
   */
  it("el temporizador del aviso se limpia siempre", () => {
    expect(panel).toMatch(/\} finally \{\s*\n\s*window\.clearTimeout\(aviso\);/);
  });
});
