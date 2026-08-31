import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./providers";

/**
 * Two providers cannot be told apart by their names alone.
 *
 * The list showed «Codex» and «ChatGPT (Codex)» one above the other. They are not two flavours of
 * the same thing: one runs the `codex` binary on your machine as a subprocess, the other talks to
 * OpenAI over your ChatGPT sign-in with no local binary at all. Somebody picked the first, it
 * failed for a reason of their own machine, and they had no way of knowing the working one was the
 * other line — because the screen gave them the same word twice.
 *
 * The rule that catches it is containment and not equality: identical names would have been caught
 * by anybody reading the list, and these were not identical. One name wholly inside another is what
 * makes a list unreadable, and it is what happened.
 */
describe("cada proveedor se distingue por su nombre", () => {
  const names = PROVIDERS.map((provider) => ({ id: provider.id, name: provider.name }));

  it("ninguno se repite", () => {
    const seen = new Map<string, string>();
    for (const { id, name } of names) {
      expect(seen.has(name), `${id} y ${seen.get(name)} se llaman igual: «${name}»`).toBe(false);
      seen.set(name, id);
    }
  });

  it("y ninguno contiene entero el nombre de otro", () => {
    for (const a of names) {
      for (const b of names) {
        if (a.id === b.id) continue;
        expect(
          a.name.toLowerCase().includes(b.name.toLowerCase()),
          `«${a.name}» (${a.id}) lleva dentro «${b.name}» (${b.id}): en una lista son la misma cosa para quien lee`,
        ).toBe(false);
      }
    }
  });
});
