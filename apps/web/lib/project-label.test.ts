import { describe, expect, it } from "vitest";
import { labelProjects } from "./project-label";

/**
 * The rule this guards is «no two options read alike», and the case that produced it is real: the
 * author's catalog holds twenty folders named `kiosk_new`, and `/twin` drew twenty identical
 * lines in three different `<select>` controls.
 */
const at = (slug: string, name: string, root: string) => ({ slug, name, root });

describe("labelProjects", () => {
  it("leaves a name alone when it belongs to one project", () => {
    const labelled = labelProjects([
      at("panoma", "panoma-monorepo", "/Users/me/Desktop/apuntes"),
      at("shopfront", "shopfront", "/Users/me/Desktop/shopfront"),
    ]);
    expect(labelled.map((row) => row.label)).toEqual(["panoma-monorepo", "shopfront"]);
  });

  it("spends the folder on disk when the names collide", () => {
    const labelled = labelProjects([
      at("kiosk-new", "kiosk_new", "/Users/me/Desktop/flutter/kiosknew/kiosk_new"),
      at("kiosk-new-copy-14", "kiosk_new", "/Users/me/Desktop/flutter/kiosknew/kiosk_new copy 14"),
    ]);
    expect(labelled.map((row) => row.label)).toEqual(["kiosk_new", "kiosk_new copy 14"]);
  });

  it("climbs to the parent only when the folder itself still repeats", () => {
    const labelled = labelProjects([
      at("a", "app", "/Users/me/work/alpha/app"),
      at("b", "app", "/Users/me/work/beta/app"),
    ]);
    expect(labelled.map((row) => row.label)).toEqual(["alpha/app", "beta/app"]);
  });

  it("charges the collision only to the rows that collide", () => {
    const labelled = labelProjects([
      at("a", "app", "/Users/me/work/alpha/app"),
      at("b", "app", "/Users/me/work/beta/app"),
      at("solo", "totem", "/Users/me/work/totem"),
    ]);
    expect(labelled.find((row) => row.slug === "solo")?.label).toBe("totem");
  });

  it("falls back to the slug when even the whole path repeats", () => {
    const labelled = labelProjects([
      at("one", "twin", "/Users/me/twin"),
      at("two", "twin", "/Users/me/twin"),
    ]);
    expect(labelled.map((row) => row.label)).toEqual(["Users/me/twin · one", "Users/me/twin · two"]);
  });

  it("never draws the same label twice, over a list shaped like the real one", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, n) =>
        at(`kiosk-new-${n}`, "kiosk_new", `/Users/me/Desktop/flutter/kiosknew/kiosk_new${n === 0 ? "" : ` copy ${n}`}`)),
      ...Array.from({ length: 14 }, (_, n) =>
        at(`leaselab-${n}`, "leaselab", `/Users/me/Desktop/leaselab${n === 0 ? "" : ` ${n}`}`)),
      at("panoma", "panoma-monorepo", "/Users/me/Desktop/apuntes"),
    ];
    const labels = labelProjects(rows).map((row) => row.label);
    expect(new Set(labels).size).toBe(rows.length);
    expect(labels.at(-1)).toBe("panoma-monorepo");
  });

  it("keeps the order it was given", () => {
    const rows = [at("z", "zeta", "/z"), at("a", "alpha", "/a")];
    expect(labelProjects(rows).map((row) => row.slug)).toEqual(["z", "a"]);
  });

  it("survives a root written with a trailing separator", () => {
    const labelled = labelProjects([
      at("a", "app", "/Users/me/work/alpha/app/"),
      at("b", "app", "/Users/me/work/beta/app"),
    ]);
    expect(labelled.map((row) => row.label)).toEqual(["alpha/app", "beta/app"]);
  });
});
