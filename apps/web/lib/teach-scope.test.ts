import { describe, expect, it } from "vitest";
import { scopable } from "./teach";

/**
 * The rule that decides whether a rule may name one project, checked on its own.
 *
 * It used to live inside `teachBelief` and nothing else could ask it, so `/twin` built its scope
 * menu from the whole catalog: on this disk that is twenty options reading `kiosk_new`, and
 * every one of them threw `TeachingError("scope")` after the press. A predicate the screen can
 * call is the difference between a menu that refuses and a menu that does not offer.
 */
describe("scopable", () => {
  const names = { "git:aa": "panoma-monorepo", "git:bb": "kiosk_new", "git:cc": "kiosk_new" };

  it("accepts a project whose name belongs to it alone", () => {
    expect(scopable("git:aa", names)).toBe(true);
  });

  it("refuses a name two projects share, in both directions", () => {
    expect(scopable("git:bb", names)).toBe(false);
    expect(scopable("git:cc", names)).toBe(false);
  });

  it("refuses a project with no identity to hang a name on", () => {
    expect(scopable(null, names)).toBe(false);
  });

  it("refuses an identity the name table does not know", () => {
    expect(scopable("git:zz", names)).toBe(false);
  });

  it("refuses the names TASTE.md cannot carry", () => {
    /* A colon and a comment marker would end the scope early or open a hole in the file. */
    expect(scopable("x", { x: "left: right" })).toBe(false);
    expect(scopable("x", { x: "one<!--two" })).toBe(false);
    expect(scopable("x", { x: "a\nb" })).toBe(false);
    expect(scopable("x", { x: " padded " })).toBe(false);
    expect(scopable("x", { x: "n".repeat(61) })).toBe(false);
    expect(scopable("x", { x: "n".repeat(60) })).toBe(true);
  });

  it("counts what a real catalog cannot offer, which is most of it", () => {
    /*
      Measured against the author's own disk on 9-Sep-2026: 75 projects with an identity, 26 of
      them with a name no other project shares. The other 49 were listed by the scope menu and
      every one of them threw. The screen now offers 26 and says how many it left out — the number
      is here so a future change to the rule shows up as a moved figure and not as a quieter menu.
     */
    const catalog: Record<string, string> = {};
    const add = (name: string, times: number) => {
      for (let n = 0; n < times; n += 1) catalog[`git:${name}${n}`] = name;
    };
    add("kiosk_new", 20);
    add("leaselab", 13);
    add("pocket_bot", 4);
    add("leaselab_admin", 3);
    add("kiosk", 3);
    for (const name of ["shop-web", "api-backend", "reader"]) add(name, 2);
    for (let n = 0; n < 26; n += 1) add(`solo-${n}`, 1);

    const identities = Object.keys(catalog);
    const offered = identities.filter((identity) => scopable(identity, catalog));
    expect(identities).toHaveLength(75);
    expect(offered).toHaveLength(26);
    expect(identities.length - offered.length).toBe(49);
  });
});
