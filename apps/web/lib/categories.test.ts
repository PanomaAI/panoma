import { describe, expect, it } from "vitest";
import { projectCategories, type ClassifiableProject } from "./categories";

/**
 * The categories of the catalog broke in silence and it was noticed by what was missing.
 *
 * `dricopilot-landing` —a landing page in JavaScript deployed on Vercel— was classified as
 * "Tools," so when filtering by "Web" it didn't appear. The cause was a single letter: the tools
 * rule was looking for `script`, and `script` is inside `javascript`. No test would have let it
 * through; there weren't any.
 *
 * These tests are the real cases from their author's catalog, with the name they had.
 */

const project = (over: Partial<ClassifiableProject>): ClassifiableProject => ({
  name: "x",
  primaryLanguage: null,
  technologies: [],
  ...over,
});

const tech = (name: string, kind: string) => ({ name, kind });

describe("lo que se clasificaba mal", () => {
  it("una página de aterrizaje en JavaScript y Vercel es web, no una herramienta", () => {
    const cats = projectCategories(
      project({
        name: "dricopilot-landing",
        primaryLanguage: "JavaScript",
        technologies: [tech("Vercel", "platform")],
      }),
    );
    expect([...cats]).toEqual(["web"]);
  });

  it("«javascript» ya no cuenta como «script»", () => {
    const cats = projectCategories(project({ name: "algo", primaryLanguage: "JavaScript" }));
    expect(cats.has("tools")).toBe(false);
  });

  it("un proyecto en HTML sin ninguna tecnología detectada sigue siendo web", () => {
    expect([...projectCategories(project({ name: "appstore_screenshots", primaryLanguage: "HTML" }))]).toEqual(["web"]);
  });

  it("«control» dentro del nombre no convierte una web en herramienta", () => {
    const cats = projectCategories(
      project({
        name: "dri-control-panel",
        primaryLanguage: "JavaScript",
        technologies: [tech("React", "framework"), tech("Express", "framework")],
      }),
    );
    expect(cats.has("tools")).toBe(false);
    expect(cats.has("web")).toBe(true);
    expect(cats.has("backend")).toBe(true);
  });
});

describe("un proyecto puede ser más de una cosa", () => {
  /*
    It's the fundamental change: before, the rules were tested in order and the first one won, so
    a Next.js with PostgreSQL had to choose. Choosing by whom it filters is exactly what a filter
    should not do.
   */
  it("Next.js con base de datos sale en web y en backend", () => {
    const cats = projectCategories(
      project({
        name: "dropsea",
        primaryLanguage: "TypeScript",
        technologies: [tech("Next.js", "framework"), tech("PostgreSQL", "database")],
      }),
    );
    expect([...cats].sort()).toEqual(["backend", "web"]);
  });

  it("una app de Flutter que llama a un modelo sale en móvil y en IA", () => {
    const cats = projectCategories(
      project({
        name: "cabeman",
        primaryLanguage: "Dart",
        technologies: [tech("Flutter", "framework"), tech("Google AI", "model")],
      }),
    );
    expect([...cats].sort()).toEqual(["ai", "mobile"]);
  });
});

describe("la IA se detecta por lo que el proyecto declara", () => {
  /*
    The 'AI' filter always came up empty: it checked for 'openai' in the name and in the list of
    technologies, and the engine had no rule to detect it. Now it is the engine's `kind` that says
    it, so any model added tomorrow enters automatically.
   */
  it("cualquier tecnología de tipo `model` basta", () => {
    const cats = projectCategories(
      project({ name: "loquesea", technologies: [tech("Anthropic", "model")] }),
    );
    expect(cats.has("ai")).toBe(true);
  });

  it("el nombre por sí solo no basta: llamarse «ai-cosas» no es usar un modelo", () => {
    expect(projectCategories(project({ name: "ai-cosas" })).has("ai")).toBe(false);
  });
});

describe("señales que no separan nada", () => {
  /*
    They were included, as discovered while auditing the entire catalog: together they were adding
    projects into a category for something that almost everyone has.
   */
  it("tener CI no convierte un backtester en Python en una herramienta", () => {
    const cats = projectCategories(
      project({
        name: "Travocato",
        primaryLanguage: "Python",
        technologies: [tech("FastAPI", "framework"), tech("GitHub Actions", "tool"), tech("Vercel", "platform")],
      }),
    );
    expect(cats.has("tools")).toBe(false);
    expect([...cats].sort()).toEqual(["backend", "web"]);
  });

  it("SQLite es el almacén local de una app móvil, no un backend", () => {
    const cats = projectCategories(
      project({
        name: "dricopilot",
        primaryLanguage: "Dart",
        technologies: [tech("Flutter", "framework"), tech("SQLite", "database")],
      }),
    );
    expect([...cats]).toEqual(["mobile"]);
  });

  it("una base de datos de servidor sí cuenta", () => {
    const cats = projectCategories(
      project({ name: "algo", technologies: [tech("PostgreSQL", "database")] }),
    );
    expect([...cats]).toEqual(["backend"]);
  });

  it("un servidor MCP sí es una herramienta: existe para que otro programa lo use", () => {
    expect(projectCategories(project({ name: "panoma", technologies: [tech("MCP", "tool")] })).has("tools")).toBe(true);
  });
});

describe("los últimos recursos", () => {
  it("un nombre de herramienta cuenta solo si no se ha reconocido nada más", () => {
    expect([...projectCategories(project({ name: "backup-script" }))]).toEqual(["tools"]);
    // With React involved, the same name no longer decides.
    const conWeb = projectCategories(
      project({ name: "backup-script", technologies: [tech("React", "framework")] }),
    );
    expect([...conWeb]).toEqual(["web"]);
  });

  it("solo un runtime de servidor y nada más es un servicio", () => {
    const cats = projectCategories(
      project({
        name: "cabeman-shopify-app",
        primaryLanguage: "JavaScript",
        technologies: [tech("Node.js", "runtime")],
      }),
    );
    expect([...cats]).toEqual(["backend"]);
  });

  it("Node.js no arrastra a backend a todo lo que tenga package.json", () => {
    const cats = projectCategories(
      project({
        name: "una-spa",
        technologies: [tech("Node.js", "runtime"), tech("React", "framework")],
      }),
    );
    expect([...cats]).toEqual(["web"]);
  });

  it("lo que no encaja en nada cae en «otros», y solo ahí", () => {
    expect([...projectCategories(project({ name: "carpeta", primaryLanguage: "C" }))]).toEqual(["other"]);
  });
});
