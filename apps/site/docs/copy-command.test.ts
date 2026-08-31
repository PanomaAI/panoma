import { describe, expect, it } from "vitest";
import { copyCommand } from "./copy-command";
import { DOCS_COMMANDS } from "./docs-copy";

describe("copyCommand", () => {
  it("writes the given command string and nothing else", async () => {
    const given = "panoma enrich --force";
    let written = "";
    await copyCommand(given, {
      writeText: async (value) => {
        written = value;
      },
    });
    expect(written).toBe(given);
  });

  it("writes each documented block as that block's exact command", async () => {
    const written: string[] = [];
    for (const block of DOCS_COMMANDS) {
      await copyCommand(block.command, {
        writeText: async (value) => {
          written.push(value);
        },
      });
    }
    expect(written).toEqual(DOCS_COMMANDS.map((block) => block.command));
  });
});
