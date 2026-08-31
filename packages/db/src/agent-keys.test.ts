import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import { authenticateAgent, createAgent, deleteAgent, rotateAgentKey } from "./agents";

/**
 * Connect the same agent twice.
 *
 * From the «Agents» page you connect with a button, and a button is pressed more than once — to
 * test, to reconnect after changing machines, or accidentally. With `createAgent` alone that
 * filled the list with «Cursor Agent, Cursor Agent, Cursor Agent», which is literally what
 * happened when testing this.
 *
 * The two promises that are verified here are the ones that make reconnecting safe: the token is
 * **the same** —and with it its history, which cascades— and the previous key **becomes invalid**
 * immediately.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-claves-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(t.agents);
});

describe("reconectar un agente", () => {
  it("no crea una segunda ficha", async () => {
    const first = await rotateAgentKey(db, { name: "Cursor Agent", kind: "cursor-agent" });
    const second = await rotateAgentKey(db, { name: "Cursor Agent", kind: "cursor-agent" });

    expect(second.id).toBe(first.id);
    expect(await db.select().from(t.agents)).toHaveLength(1);
  });

  it("emite una clave nueva y tira la anterior", async () => {
    const first = await rotateAgentKey(db, { name: "Cursor Agent", kind: "cursor-agent" });
    const second = await rotateAgentKey(db, { name: "Cursor Agent", kind: "cursor-agent" });

    expect(second.apiKey).not.toBe(first.apiKey);
    expect(await authenticateAgent(db, second.apiKey)).toBeDefined();
    /* The previous one immediately becomes worthless: that is what is expected from reconnecting. */
    expect(await authenticateAgent(db, first.apiKey)).toBeUndefined();
  });

  it("adopta la ficha que ya existía aunque la creara el CLI", async () => {
    const viejo = await createAgent(db, { name: "Cursor Agent", kind: "cursor-agent" });
    const nuevo = await rotateAgentKey(db, { name: "Cursor Agent", kind: "cursor-agent" });
    expect(nuevo.id).toBe(viejo.id);
  });

  it("y también la que guardó el CLI viejo con otro nombre para lo mismo", async () => {
    /*
      The CLI deducted `claude_code` from the name and the web saves `claude-cli`. Without
      recognizing the two, connecting from the application an agent that you had already been
      using through the terminal left two records of the same Claude Code, with half of the
      history in each one.
     */
    await db.insert(t.agents).values({
      id: "agt_legado",
      name: "Claude Code",
      kind: "claude_code",
      apiKeyHash: "hash-de-antes",
    });

    const nuevo = await rotateAgentKey(db, { name: "Claude Code", kind: "claude-cli" });
    expect(nuevo.id).toBe("agt_legado");
    expect(await db.select().from(t.agents)).toHaveLength(1);

    /* And incidentally it stays with the canonical name, so as not to depend on the alias next time. */
    const [fila] = await db.select({ kind: t.agents.kind }).from(t.agents);
    expect(fila?.kind).toBe("claude-cli");
  });

  it("y cada herramienta tiene la suya", async () => {
    const cursor = await rotateAgentKey(db, { name: "Cursor Agent", kind: "cursor-agent" });
    const codex = await rotateAgentKey(db, { name: "Codex", kind: "codex-cli" });
    expect(codex.id).not.toBe(cursor.id);
    expect(await db.select().from(t.agents)).toHaveLength(2);
  });
});

describe("desconectar", () => {
  it("deja la clave sin valor", async () => {
    const agent = await rotateAgentKey(db, { name: "Codex", kind: "codex-cli" });
    expect(await deleteAgent(db, agent.id)).toBe(true);
    expect(await authenticateAgent(db, agent.apiKey)).toBeUndefined();
  });

  it("y desconectar dos veces no finge que había algo", async () => {
    const agent = await rotateAgentKey(db, { name: "Codex", kind: "codex-cli" });
    await deleteAgent(db, agent.id);
    expect(await deleteAgent(db, agent.id)).toBe(false);
  });
});
