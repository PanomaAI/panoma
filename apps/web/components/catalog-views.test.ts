import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The catalog draws every project twice — as a row and as a tile — and the tile is the one that
 * opens by default. Twice now a fact has been added to the row and left out of the tile, so the
 * view almost nobody chooses was the only one telling the truth.
 *
 * The first time it was the risk cloud: «this only exists on this disk» was said in a strip above
 * the catalog that spoke about sixty-three projects at once, and on no card in particular. The
 * second time it was `copyCount`, queried, sent to the browser and drawn on the path line — a line
 * the tile does not have. Four folders went on looking like one folder on the default screen.
 *
 * Neither is visible by reading a component: both are visible by crossing the two. So the rule is
 * written as an absence — whatever the row reads from a project, the tile reads too — and the
 * exceptions are listed one by one with the reason each is an exception. Adding a field to the row
 * and not to the tile is then a decision somebody writes down, not an oversight nobody sees.
 */
describe("the two views of the catalog", () => {
  const source = readFileSync(new URL("./project-store.tsx", import.meta.url), "utf8");

  /** The body of a top-level function, up to the next one. */
  function bodyOf(name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start, `${name} is no longer a top-level function of project-store.tsx`).toBeGreaterThan(
      -1,
    );
    const end = source.indexOf("\nfunction ", start + 1);
    return source.slice(start, end === -1 ? undefined : end);
  }

  function fieldsRead(name: string): Set<string> {
    return new Set([...bodyOf(name).matchAll(/project\.(\w+)/g)].map((match) => match[1]!));
  }

  /**
   * What the row shows and the tile deliberately does not. The tile is 142px wide — 118px on a
   * phone — so it cannot be a table: it is a name, an icon and one line underneath.
   */
  const ROW_ONLY: Record<string, string> = {
    technologies: "the row has a stack column; the tile shows the project's own icon in its place",
  };

  /** And the other way round, which is empty today and is here so it cannot fill up in silence. */
  const TILE_ONLY: Record<string, string> = {};

  it("everything the row says about a project, the tile says too", () => {
    const missing = [...fieldsRead("ProjectRow")].filter(
      (field) => !fieldsRead("ProjectTile").has(field) && !(field in ROW_ONLY),
    );

    expect(
      missing,
      `the row reads ${missing.join(", ")} and the tile does not: the tile is the view that opens by default, so this is said only to whoever changed views`,
    ).toEqual([]);
  });

  it("and the other way round", () => {
    const missing = [...fieldsRead("ProjectTile")].filter(
      (field) => !fieldsRead("ProjectRow").has(field) && !(field in TILE_ONLY),
    );

    expect(missing, `the tile reads ${missing.join(", ")} and the row does not`).toEqual([]);
  });

  /*
    An exception that stops being one is worse than no list at all: it reads as a decision that was
    taken, and it is really a line nobody deleted.
   */
  it("every exception is still an exception", () => {
    for (const field of Object.keys(ROW_ONLY)) {
      expect(fieldsRead("ProjectRow").has(field), `${field} is listed and the row no longer reads it`).toBe(true);
      expect(fieldsRead("ProjectTile").has(field), `${field} is listed as row-only and the tile reads it`).toBe(false);
    }
    for (const field of Object.keys(TILE_ONLY)) {
      expect(fieldsRead("ProjectTile").has(field), `${field} is listed and the tile no longer reads it`).toBe(true);
      expect(fieldsRead("ProjectRow").has(field), `${field} is listed as tile-only and the row reads it`).toBe(false);
    }
  });
});
