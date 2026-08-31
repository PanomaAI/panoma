import { describe, expect, it } from "vitest";
import { composeSummary, composedText } from "./summary";
import type { ProjectAnalysis } from "./types";

/**
 * What does the engine talk about when it composes a description, and in what language does it
 * write it.
 *
 * This sentence is the description of the projects that do not have any —neither manifest
 * described nor README in prose— and on a real disk those are the majority. It was composed here
 * inside, entirely and in Spanish, and it came out exactly like this: on the terminal, which has
 * spoken English since August 25, 2026, and on a record in English.
 *
 * Now the engine delivers **pieces** and whoever has a reader in front puts the words. What comes
 * out of here is still a sentence, but in English and only as a backup: it is read by the
 * terminal, the MCP server, and the tasks to the agents, who are the three monolinguals.
 *
 * What **does not** change, and is the old promise: only what is proven is affirmed. Each piece is
 * optional, and from a project about which little is known, a short sentence comes out instead of
 * one filled with what such a project usually has.
 */
function analysis(parts: Partial<ProjectAnalysis>): ProjectAnalysis {
  return {
    technologies: [],
    distributions: [],
    links: [],
    ...parts,
  } as unknown as ProjectAnalysis;
}

/*
  The type crosses like in `analysis()`: here only the four fields that the composer reads matter,
  and writing the rest of `DetectedTechnology` would not test anything else.
 */
const tech = (id: string, name: string, kind = "framework", confidence = 0.9) =>
  ({ id, name, kind, confidence, evidence: [] }) as unknown as ProjectAnalysis["technologies"][number];

describe("composeSummary", () => {
  it("dice de qué clase es el proyecto como identificador, no como frase", () => {
    /*
      Before, this returned 'Mobile App' and that string traveled to the screen. As an identifier,
      it can be named in each language where it applies.
     */
    expect(composeSummary(analysis({ technologies: [tech("flutter", "Flutter")] })).kind).toBe(
      "mobile-app",
    );
    expect(composeSummary(analysis({ technologies: [tech("nextjs", "Next.js")] })).kind).toBe(
      "web-app",
    );
    expect(composeSummary(analysis({})).kind, "sin señales, no se inventa una clase").toBe("project");
  });

  it("los nombres propios salen tal cual, sin tocar", () => {
    const composition = composeSummary(
      analysis({
        technologies: [tech("flutter", "Flutter"), tech("dart", "Dart", "language")],
        links: [{ kind: "deep", service: "Stripe" }, { kind: "deep", service: "Firebase" }],
        distributions: [{ kind: "app_store", label: "App Store" }],
      } as unknown as Partial<ProjectAnalysis>),
    );
    expect(composition.stack).toEqual(["Flutter", "Dart"]);
    expect(composition.services).toEqual(["Stripe", "Firebase"]);
    expect(composition.stores).toEqual(["App Store"]);
  });

  it("no cuenta GitHub como un servicio del proyecto", () => {
    // Almost every repository links to GitHub: saying it does not distinguish any of them from the
    // others.
    const composition = composeSummary(
      analysis({
        links: [{ kind: "deep", service: "GitHub" }, { kind: "deep", service: "Supabase" }],
      } as unknown as Partial<ProjectAnalysis>),
    );
    expect(composition.services).toEqual(["Supabase"]);
  });

  it("una tecnología dudosa no entra", () => {
    const composition = composeSummary(
      analysis({ technologies: [tech("astro", "Astro", "framework", 0.4)] }),
    );
    expect(composition.stack).toEqual([]);
  });

  it("un agente entra solo si escribió una parte reconocible del historial", () => {
    const con = (commits: number, total: number) =>
      composeSummary(
        analysis({
          git: { commitCount: total, agentContributors: [{ name: "Claude", commits }] },
        } as unknown as Partial<ProjectAnalysis>),
      ).topAgent;

    expect(con(64, 100), "dos tercios del historial es una señal").toEqual({ name: "Claude", share: 64 });
    expect(con(3, 100), "un 3 % en un historial largo es ruido").toBeUndefined();
  });
});

describe("composedText", () => {
  it("escribe la frase en inglés, que es quien la lee", () => {
    expect(
      composedText({
        kind: "mobile-app",
        stack: ["Flutter", "Dart"],
        services: ["Firebase", "Stripe"],
        stores: ["App Store"],
        topAgent: { name: "Claude", share: 64 },
      }),
    ).toBe(
      "Mobile app in Flutter and Dart, uses Firebase and Stripe, published on App Store, 64% of the history written by Claude.",
    );
  });

  it("de un proyecto del que no se sabe nada sale una frase corta, no una rellena", () => {
    expect(composedText({ kind: "project", stack: [], services: [], stores: [] })).toBe("Project.");
  });

  it("y no queda castellano dentro", () => {
    /*
      The backup is read by the terminal, the MCP server, and the orders to the agents: all three
      monolingual in English. One word in Spanish here comes out through all three at once.
     */
    const frase = composedText({
      kind: "backend",
      stack: ["Django"],
      services: ["Stripe"],
      stores: ["npm"],
      topAgent: { name: "Cursor", share: 30 },
    });
    expect(frase).not.toMatch(/[áéíóúñ¿¡]/);
    expect(frase).not.toMatch(/\b(en|usa|se publica|del historial|escribió)\b/);
  });
});
