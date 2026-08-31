import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_FILL_MS, TRAP_FIELD } from "../landing/follow-rules";

const servidor = readFileSync(new URL("./subscribe.ts", import.meta.url), "utf8");
const ruta = readFileSync(new URL("../app/api/subscribe/route.ts", import.meta.url), "utf8");

/**
 * The route that writes the discharges, which is the only one in the entire public site that
 * writes anything.
 *
 * It is read as text —the pattern of the house— because what needs to be fixed are formal
 * decisions: an order, an absence, a header. None of them breaks with a visible mistake: if any
 * falls, the path keeps responding 202 and the list fills with garbage, or worse, it turns into
 * something it was not supposed to be.
 */
describe("la puerta de las altas", () => {
  /*
    Against the function and not against the table. Two reasons, and the second one is the
    important one: the Panoma schema is not exposed in the API of the project — it's a project
    that hosts another product and its global settings are not touched —, and this way the hourly
    lock and the write happen within the same transaction, without a gap between reading and
    writing through which two requests could slip in at the same time.
   */
  it("escribe llamando a la función, no a la tabla", () => {
    expect(servidor).toContain("/rest/v1/rpc/panoma_subscribe");
    expect(servidor).not.toMatch(/\/rest\/v1\/subscribers/);
  });

  /*
    Two headers that do NOT work, and both were removed after measuring them against the actual
    project on August 28, 2026:
    - `Authorization`: the new keys are not JWT and the documentation says they should not travel
    there. Today the gateway tolerates it — it responds identically with and without — but it is
    undocumented behavior.
    - `Prefer: return=minimal`: asks not to send a body, and the body is the verdict that this
    function reads. Today it does not suppress it in a function call; the day it does, `invalid`
    and `rate_limited` would be read as `ok` without anything failing.
   */
  it("manda la clave por apikey y nada más", () => {
    expect(servidor).toMatch(/headers: \{\s*\n\s*apikey: key,/);
    expect(servidor).not.toMatch(/Authorization: `Bearer/);
    expect(servidor).not.toMatch(/Prefer: "return=minimal"/);
  });

  /*
    Cheap first: discarding a robot shouldn't cost a database query. The two traps go before
    touching anything, and **on the server**, not just in the browser: whoever calls this route
    with `curl` doesn't go through the form, and these two lines are the only thing that awaits
    them.
   */
  it("las trampas se comprueban aquí, no solo en el navegador", () => {
    expect(ruta).toContain("TRAP_FIELD");
    expect(ruta).toContain("MIN_FILL_MS");
    const cebo = ruta.indexOf("cebo.trim()");
    const escritura = ruta.indexOf("await subscribe(");
    expect(cebo).toBeGreaterThan(-1);
    expect(escritura).toBeGreaterThan(-1);
    expect(cebo, "la escritura va antes que las trampas").toBeLessThan(escritura);
  });

  /*
    And they are the same two that the form uses: two different thresholds on each side would
    cause the client to let through what the server rejects, or vice versa.
   */
  it("y son las mismas que mira el formulario", () => {
    expect(TRAP_FIELD).toBe("website");
    expect(MIN_FILL_MS).toBeGreaterThan(0);
  });

  /*
    The address is normalized HERE. Doing it only in the browser is doing it at the home of
    whoever controls the problem: two additions of `A@B.com` and `a@b.com` would be two rows if
    the server trusts.
   */
  it("normaliza la dirección en el servidor", () => {
    expect(ruta).toMatch(/\.trim\(\)\.toLowerCase\(\)/);
  });

  /*
    The IP is not saved: it becomes a fingerprint. To count requests, it is not necessary to know
    whose they are, and a IP address is personal data. And only the FIRST of the header matters —
    the others may have been written by whoever is calling.
   */
  it("la IP se convierte en huella y solo se lee la primera", () => {
    expect(ruta).toMatch(/x-forwarded-for.*\.split\(","\)\[0\]/s);
    expect(ruta).toContain("fingerprint(");
    expect(servidor).toMatch(/createHash\("sha256"\)/);
  });

  /*
    And without salt you can't invent one: a fixed salt written in the code is having none but
    seeming like you do — the trace disappears by testing the addresses that exist.
   */
  it("y sin sal configurada, el freno se apaga en vez de fingir", () => {
    expect(servidor).toMatch(/if \(!salt \|\| !ip\) return undefined;/);
  });

  /*
    The invariant that truly protects the list: **the same response for a new address and for one
    that was already there**. Distinguishing them would turn this into a search engine for “is
    so-and-so signed up for Panoma?”, which is exactly what a mailing list cannot be.
   */
  it("no dice si una dirección ya estaba apuntada", () => {
    /*
      The declared verdicts are looked at and not the prose of the file: the first version of this
      test searched for words and got caught with its own comments. The four values are the whole
      assertion — "it was already" is not among them, and adding it would require touching this
      line.
     */
    const declarados = /export type SubscribeResult =([^;]+);/.exec(servidor)?.[1] ?? "";
    expect(declarados.trim()).toBe('"ok" | "invalid" | "rate_limited" | "unavailable"');
  });

  /*
    Not even the database message: Postgres errors contain column and constraint names, and
    that is a free blueprint of the table.
   */
  it("y nunca devuelve el error de la base", () => {
    expect(ruta).toMatch(/console\.error/);
    expect(ruta).toMatch(/error: "unavailable"/);
  });
});
