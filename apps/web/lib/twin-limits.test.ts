import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUESTION_MAX, TEACH_MAX } from "./twin-limits";

/**
 * The caps the browser counts with are the caps the server refuses with.
 *
 * Read as text, like the other guards in this tree, because the point is not that the numbers are
 * equal today but that the file the browser may safely import stays in step with the one it may
 * not. `lib/teach.ts` reaches `@panoma/db`; a client component that imports it breaks the build
 * with `UnhandledSchemeError: node:buffer`, so the counter cannot simply read the enforcing module.
 */
const at = (path: string) => readFileSync(new URL(path, new URL("../../../", import.meta.url)), "utf8");

describe("the Twin form caps", () => {
  it("match what the rehearsal route enforces", () => {
    const source = at("packages/db/src/consultations.ts");
    const declared = /export const CONSULT_MAX = (\d+);/.exec(source);
    expect(declared, "CONSULT_MAX moved or was renamed").not.toBeNull();
    expect(Number(declared![1])).toBe(QUESTION_MAX);
  });

  it("are the numbers the two forms actually count to", () => {
    expect(at("apps/web/components/twin-teach.tsx")).toContain("maxLength={TEACH_MAX}");
    expect(at("apps/web/components/twin-lab.tsx")).toContain("maxLength={QUESTION_MAX}");
  });

  it("are not written into the sentence that reports them", () => {
    /* «Caracteres: {n} / 300» made the cap a fourth copy, in two languages. */
    const dictionary = at("apps/web/lib/i18n.ts");
    expect(dictionary).not.toContain('"twinTeach.characters": "Caracteres: {n} / 300"');
    expect(dictionary).not.toContain('"twinTeach.characters": "Characters: {n} / 300"');
  });

  it("keep a criterion and a question on the same measure", () => {
    /* They have always been the same 300; if one moves, the sentence below it must move too. */
    expect(TEACH_MAX).toBe(QUESTION_MAX);
  });
});
