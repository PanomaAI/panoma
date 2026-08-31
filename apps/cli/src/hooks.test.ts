import { describe, expect, it } from "vitest";
import { mergePreToolUse, mergeStop, postCommitScript, removeStop } from "./hooks";

/**
 * The same as in `mcp.test.ts`: here the settings of a tool that is not ours are rewritten. An
 * external `Stop` that disappears is not noticed immediately — it is noticed the day someone
 * wonders why their formatter stopped running at the end of the shift.
 */

const ORDER = "panoma scan /repo --save --api http://localhost:4173  # panoma-hooks";
const FOREIGN = { hooks: [{ type: "command", command: "npm run format" }] };

describe("añadir el gancho Stop", () => {
  it("lo pone donde no había nada", () => {
    const { result, updatedAt } = mergeStop({}, ORDER);
    expect(updatedAt).toBe(false);
    expect(result["hooks"]).toEqual({ Stop: [{ hooks: [{ type: "command", command: ORDER }] }] });
  });

  it("convive con el gancho de otro en vez de sustituirlo", () => {
    const { result } = mergeStop({ hooks: { Stop: [FOREIGN] } }, ORDER);
    const stop = (result["hooks"] as { Stop: unknown[] }).Stop;
    expect(stop).toHaveLength(2);
    expect(stop[0]).toEqual(FOREIGN);
  });

  it("no toca los demás eventos ni el resto de los ajustes", () => {
    const antes = {
      permissions: { allow: ["Bash(git status)"] },
      hooks: { PreToolUse: [FOREIGN] },
    };
    const { result } = mergeStop(antes, ORDER);
    expect(result["permissions"]).toEqual(antes.permissions);
    expect((result["hooks"] as Record<string, unknown>)["PreToolUse"]).toEqual([FOREIGN]);
  });

  it("al reinstalar actualiza el nuestro en vez de duplicarlo", () => {
    const old = "panoma scan /repo --save --api http://localhost:9999  # panoma-hooks";
    const { result, updatedAt } = mergeStop(
      { hooks: { Stop: [{ hooks: [{ type: "command", command: old }] }] } },
      ORDER,
    );
    expect(updatedAt).toBe(true);
    const stop = (result["hooks"] as { Stop: { hooks: { command: string }[] }[] }).Stop;
    expect(stop).toHaveLength(1);
    expect(stop[0]?.hooks[0]?.command).toBe(ORDER);
  });

  it("se planta ante unos ajustes con otra forma", () => {
    expect(() => mergeStop({ hooks: "sí" }, ORDER)).toThrow();
    expect(() => mergeStop({ hooks: { Stop: "sí" } }, ORDER)).toThrow();
  });
});

describe("quitar el gancho Stop", () => {
  it("se lleva solo el nuestro", () => {
    const { result } = mergeStop({ hooks: { Stop: [FOREIGN] } }, ORDER);
    const { result: clean, removed } = removeStop(result);
    expect(removed).toBe(1);
    expect((clean["hooks"] as { Stop: unknown[] }).Stop).toEqual([FOREIGN]);
  });

  it("no deja restos vacíos cuando el nuestro era el único", () => {
    const { result } = mergeStop({}, ORDER);
    const { result: clean, removed } = removeStop(result);
    expect(removed).toBe(1);
    expect(clean["hooks"]).toBeUndefined();
  });

  it("con unos ajustes sin ganchos no hace nada", () => {
    expect(removeStop({ permissions: {} }).removed).toBe(0);
  });
});

describe("el guion de post-commit", () => {
  /*
    The three properties that make this hook not get manually erased: it doesn't block the commit,
    it doesn't make it fail, and it doesn't print anything over the git output.
   */
  it("nunca bloquea ni tumba el commit", () => {
    const script = postCommitScript("panoma scan . --save --api http://localhost:4173");
    expect(script.startsWith("#!/bin/sh")).toBe(true);
    expect(script).toContain(">/dev/null 2>&1 &");
    expect(script.trimEnd().endsWith("exit 0")).toBe(true);
  });

  it("lleva la marca que lo distingue del gancho de otro", () => {
    expect(postCommitScript("x")).toContain("# panoma-hooks");
  });
});

describe("el gancho de las señales", () => {
  it("entra con su matcher de herramientas de edición, sin tocar lo ajeno", () => {
    const { result } = mergePreToolUse(
      { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "otro" }] }] } },
      "panoma signal /p --api http://localhost:4173  # panoma-hooks",
    );
    const groups = (result["hooks"] as Record<string, unknown>)["PreToolUse"] as {
      matcher?: string;
      hooks: { command: string }[];
    }[];
    expect(groups).toHaveLength(2);
    expect(groups[0]?.hooks[0]?.command).toBe("otro");
    expect(groups[1]?.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
  });

  it("quitar barre todos los eventos nuestros de una vez, y solo los nuestros", () => {
    const installed = mergePreToolUse(
      mergeStop({}, "panoma scan /p --save  # panoma-hooks").result,
      "panoma signal /p  # panoma-hooks",
    ).result;
    (installed["hooks"] as Record<string, unknown>)["Stop"] = [
      ...((installed["hooks"] as Record<string, unknown>)["Stop"] as unknown[]),
      { hooks: [{ type: "command", command: "ajeno" }] },
    ];

    const { result, removed } = removeStop(installed);
    expect(removed).toBe(2);
    const hooks = result["hooks"] as Record<string, unknown>;
    expect(hooks["PreToolUse"]).toBeUndefined();
    expect(JSON.stringify(hooks["Stop"])).toContain("ajeno");
  });
});
