import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectCliAgents } from "./cli-agent";
import type { Provider } from "./providers";

/**
 * Find an agent that is installed, wherever it is.
 *
 * The real case that caused this: on the author's machine, `/usr/local/bin/codex` existed — a link
 * to the npm wrapper — and the native binary that this wrapper launches did not. At the same time,
 * the ChatGPT app had a `codex` of 200 MB that worked. Panoma said 'not installed' for something
 * the user had twice, and with that it started looking in the wrong place.
 *
 * The three things that this file sets, because all three are read differently on the screen: it
 * is and responds, it is and does not start, and it is not.
 */

function agente(extra: Partial<Provider> = {}): Provider {
  return {
    id: "prueba-cli",
    name: "Agente de prueba",
    auth: "cli",
    description: "",
    command: "panoma-agente-que-no-existe",
    ...extra,
  } as Provider;
}

describe("encontrar un agente instalado", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "panoma-agente-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  /**
   * A fake executable that responds to `--version` as the real one would.
   *
   * It is tested by what it does —what it says, what it reports, and its exit code— rather than by
   * the script that implements it. Previously, a piece of `sh` was passed to it, and that
   * tied the test to a specific system: in Windows there is no `#!/bin/sh` that works nor `chmod`
   * that serves, so the four tests that depended on this failed because of the scaffolding and not
   * because of what they were testing.
   */
  async function ejecutable(
    name: string,
    { dice = "", protesta = "", codigo = 0 }: { dice?: string; protesta?: string; codigo?: number },
  ): Promise<string> {
    if (process.platform === "win32") {
      const path = join(home, `${name}.cmd`);
      const lines = ["@echo off"];
      if (dice) lines.push(`echo ${dice}`);
      if (protesta) lines.push(`echo ${protesta} 1>&2`);
      lines.push(`exit /b ${codigo}`);
      await writeFile(path, `${lines.join("\r\n")}\r\n`);
      return path;
    }

    const path = join(home, name);
    const lines = ["#!/bin/sh"];
    if (dice) lines.push(`echo "${dice}"`);
    if (protesta) lines.push(`echo "${protesta}" >&2`);
    lines.push(`exit ${codigo}`);
    await writeFile(path, `${lines.join("\n")}\n`);
    await chmod(path, 0o755);
    return path;
  }

  it("lo da por instalado cuando el del PATH responde", async () => {
    const command = await ejecutable("responde", { dice: "v1.2.3" });
    const [found] = await detectCliAgents([agente({ command })]);
    expect(found?.installed).toBe(true);
    expect(found?.version).toBe("v1.2.3");
    expect(found?.command).toBe(command);
  });

  it("cae al binario de dentro de la app cuando el del PATH no arranca", async () => {
    const roto = await ejecutable("roto", { protesta: "falta el binario nativo", codigo: 1 });
    const bueno = await ejecutable("bueno", { dice: "codex-cli 0.148.0" });

    const [found] = await detectCliAgents([agente({ command: roto, bundles: [bueno] })]);

    expect(found?.installed).toBe(true);
    expect(found?.version).toBe("codex-cli 0.148.0");
    // The important thing: the one that will be executed is the one that responds, not the one that
    // is in PATH.
    expect(found?.command).toBe(bueno);
    expect(found?.broken).toBeUndefined();
  });

  it("también busca en la app cuando el comando no existe en el PATH", async () => {
    const bueno = await ejecutable("solo-en-la-app", { dice: "1.0.0" });
    const [found] = await detectCliAgents([
      agente({ command: "panoma-agente-que-no-existe", bundles: [bueno] }),
    ]);
    expect(found?.installed).toBe(true);
    expect(found?.command).toBe(bueno);
  });

  it("«está y no arranca» no se confunde con «no está»", async () => {
    const roto = await ejecutable("roto", { protesta: "vendor/codex: ENOENT", codigo: 1 });
    const [found] = await detectCliAgents([agente({ command: roto })]);

    expect(found?.installed).toBe(false);
    // With the motive, which is the only thing that allows it to be fixed: without it, whoever has
    // it installed starts to install it again.
    expect(found?.broken).toContain("ENOENT");
  });

  it("lo que no está en ninguna parte se calla", async () => {
    const [found] = await detectCliAgents([
      agente({ bundles: [join(home, "tampoco-existe")] }),
    ]);
    expect(found?.installed).toBe(false);
    expect(found?.broken).toBeUndefined();
  });
});
