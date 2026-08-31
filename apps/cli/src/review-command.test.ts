import { describe, expect, it } from "vitest";
import type { CriticFinding, CriticReport } from "@panoma/core";
import { findingRow, groupByKind, reasonOf, reviewLines } from "./review-command";

/**
 * The painters are tested on command, not the process.
 *
 * It is the same decision as in `twin-command.test.ts` and for the same two reasons: truly
 * reviewing requires a project on the disk —and the result would depend on what is on that
 * laptop—, and `review-command.ts` loads the engine with `await import(…)` inside the command, so
 * this file can read it without having `@panoma/core` rebuilt with the critical inside.
 *
 * What is monitored is not the layout, which will change, but the promises of the output: that
 * silence is written instead of left blank, that no finding is lost due to the row limit, that
 * what is not known — the line of a color, the file of a radio — is not invented, and that the two
 * sentences in the dictionary exist in both languages. A bilingual command that is only tested in
 * Spanish is a command that debuts broken in English.
 */

/*
  The colors come off before looking, as in `next-command.test.ts` and its siblings.
  It's not cosmetic: Picocolors lights up the color when `CI` exists, so this file worked on the
  laptop of the person who wrote it and would turn red in the six jobs of the matrix — the headers
  came wrapped in `\x1b[1m` and no `startsWith` recognized them. A test that asserts on already
  colored text is measuring the terminal, not the program.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function plain(lines: string[]): string[] {
  return lines.map((line) => line.replace(ANSI, ""));
}

function report(findings: CriticFinding[], over: Partial<CriticReport> = {}): CriticReport {
  return { findings, sourcesRead: 24, truncated: false, ...over };
}

const COLOR: CriticFinding = {
  kind: "color-drift",
  claim: "#2195f3",
  hint: "#2196f3",
  file: "lib/chatbot/widgets/chatbot_widget.dart",
};

const RADIUS: CriticFinding = { kind: "radius-drift", claim: "16.0px", hint: "15px" };

const IMAGE: CriticFinding = {
  kind: "image-no-alt",
  claim: "assets/hero.png",
  file: "index.html",
  line: 12,
};

const LINK: CriticFinding = {
  kind: "broken-link",
  claim: "lib/pantallas/menu.dart",
  hint: "lib/auth/menu.dart",
  file: "SEGUIMIENTO.md",
  line: 4,
};

describe("reviewLines", () => {
  it("sin nada que denunciar lo dice, y dice cuánto miró", () => {
    const text = reviewLines(report([])).join("\n");

    expect(text).toContain("24 files read");
    // And make it clear that this is not the whole review: the other half needs an eye.
    expect(text).toContain("What is left —whether it looks good, whether it matches the rest— needs an eye, and this command hasn’t got one.");
    expect(text).not.toContain("Corners");
  });

  it("agrupa por clase de defecto, en el orden en que las ordena el motor", () => {
    const lines = plain(reviewLines(report([COLOR, RADIUS, IMAGE, LINK])));
    const heads = lines
      .map((line) => line.trim())
      .filter((line) => line.startsWith("Colours") || line.startsWith("Corners") ||
        line.startsWith("Images") || line.startsWith("Links"));

    expect(heads).toEqual([
      "Colours that are not in the palette",
      "Corners that do not match",
      "Images that do not say what they show",
      "Links that lead nowhere",
    ]);
  });

  it("cuenta las pegas y no las esconde detrás del tope de filas", () => {
    const muchos = Array.from({ length: 90 }, (_, at) => ({
      ...LINK,
      claim: `lib/pantallas/${at}.dart`,
      line: at + 1,
    }));

    const text = reviewLines(report(muchos)).join("\n");

    expect(text).toContain("90 mechanical problems");
    expect(text).toContain("and 78 more of the same");
    expect(text).toContain("lib/pantallas/0.dart");
    expect(text).not.toContain("lib/pantallas/50.dart");
  });

  it("una sola pega no se cuenta en plural", () => {
    const text = reviewLines(report([IMAGE])).join("\n");

    expect(text).toContain("1 mechanical problem ·");
    expect(text).not.toContain("1 pegas");
  });

  it("con el paseo corto se avisa, haya hallazgos o no", () => {
    const conPegas = reviewLines(report([IMAGE], { truncated: true })).join("\n");
    const sinPegas = reviewLines(report([], { truncated: true })).join("\n");

    expect(conPegas).toContain("more files than the index holds");
    // The case that matters: 'there is nothing' about a short walk is 'we have seen nothing,' and
    // without this line the partial silence would be read as a full pass.
    expect(sinPegas).toContain("more files than the index holds");
  });
});

describe("findingRow", () => {
  it("escribe dónde estaba cuando se sabe, con su línea", () => {
    expect(findingRow(LINK)).toContain("SEGUIMIENTO.md:4");
    expect(findingRow(LINK)).toContain("lib/pantallas/menu.dart");
  });

  it("no inventa la línea de un color ni el fichero de un radio", () => {
    const color = findingRow(COLOR);
    const radio = findingRow(RADIUS);

    expect(color).toContain("chatbot_widget.dart");
    expect(color).not.toContain("chatbot_widget.dart:");
    expect(radio.trim().startsWith("16.0px")).toBe(true);
  });
});

describe("reasonOf", () => {
  it("dice por qué está mal", () => {
    expect(reasonOf(COLOR)).toBe("used once or twice; the project uses #2196f3");
    expect(reasonOf(RADIUS)).toBe(
      "and 15px are the same corner by eye, written several ways",
    );
    expect(reasonOf(IMAGE)).toContain("does not say what it shows: whoever cannot see it, misses it");
    expect(reasonOf(LINK)).toBe("missing; there is one at lib/auth/menu.dart");
    expect(reasonOf({ ...LINK, hint: undefined })).toBe("does not exist in the project");
  });

  it("agrupa los hallazgos por tipo y conserva su orden", () => {
    const otro = { ...LINK, line: 9 };
    const groups = groupByKind([LINK, IMAGE, otro]);

    expect([...groups.keys()]).toEqual(["broken-link", "image-no-alt"]);
    expect(groups.get("broken-link")?.map((finding) => finding.line)).toEqual([4, 9]);
  });
});
