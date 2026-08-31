import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContainerExecutor, HardenedExecutor, resolveExecutor, scrubEnvironment } from "./executor";

/**
 * What is verified here is not that the isolation isolates —that is only shown by running
 * something inside— but that **Panoma does not promise more than it delivers**. It is the mistake
 * this project has already made twice: a comment that said "read-only" without `--read-only`, and
 * a `describe` that said "no access to your credentials" while the process read the entire home
 * directory. A promise that the code does not fulfill turns a review into a confirmation.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("qué dice cada nivel de sí mismo", () => {
  /*
    The invariant is not a concrete sentence but that the sentence and reality do not separate:
    either the sandbox exists and `describe` says so, or it does not exist and `unmetPromise()`
    confesses it. Never both, never none. It is the way to prevent what happened with 'without
    access to your credentials' on top of a process that read the entire home from happening
    again.
   */
  it("describe e incumplido nunca se contradicen", () => {
    const executor = new HardenedExecutor("/tmp/x");
    const promisesSandbox = /sandbox/i.test(executor.describe);
    const admits = executor.unmetPromise() !== undefined;
    expect(promisesSandbox).toBe(!admits);
  });

  it("nunca dice proteger credenciales sin más", () => {
    // The old phrase appeared on the interface and it was false. Don't come back for copy and
    // paste.
    expect(new HardenedExecutor("/tmp/x").describe).not.toMatch(/sin acceso a tus credenciales/i);
  });

  it("en macOS promete cerrar tu carpeta personal; fuera, lo confiesa", () => {
    const executor = new HardenedExecutor("/tmp/x");
    if (process.platform === "darwin") {
      expect(executor.describe).toMatch(/carpeta personal/i);
      expect(executor.unmetPromise()).toBeUndefined();
    } else {
      expect(executor.describe).toMatch(/ve tu disco/i);
      expect(executor.unmetPromise()).toMatch(/leer tu carpeta personal/i);
    }
  });

  it("hardened sí quita las variables con secretos, que es lo que de verdad hace", () => {
    const clean = scrubEnvironment({
      PATH: "/usr/bin",
      HOME: "/Users/x",
      NPM_TOKEN: "npm_secreto",
      GITHUB_TOKEN: "ghp_secreto",
      AWS_SECRET_ACCESS_KEY: "secreto",
      MI_VARIABLE: "cualquiera",
    });
    expect(clean["PATH"]).toBe("/usr/bin");
    expect(clean["NPM_TOKEN"]).toBeUndefined();
    expect(clean["GITHUB_TOKEN"]).toBeUndefined();
    expect(clean["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
    // Everything that is not on the short list goes, even if it doesn't seem like a secret.
    expect(clean["MI_VARIABLE"]).toBeUndefined();
  });
});

describe("qué nivel se coge cuando no se pide ninguno", () => {
  /*
    The defect was `hardened` and the container only appeared if someone typed it by name — that
    is, almost no execution used the isolation that the machine did have. Searching for the
    runtime takes 0.1 s when there is none installed, so convenience was not the reason.
   */
  it("el contenedor, si hay runtime", async () => {
    vi.spyOn(ContainerExecutor, "findRuntime").mockResolvedValue("docker");
    const { executor, downgradedFrom } = await resolveExecutor({ cwd: "/tmp/x", image: "node" });
    expect(executor.isolation).toBe("container");
    expect(downgradedFrom).toBeUndefined();
  });

  it("y si no hay, hardened diciendo qué se ha perdido", async () => {
    vi.spyOn(ContainerExecutor, "findRuntime").mockResolvedValue(undefined);
    const { executor, downgradedFrom, reason } = await resolveExecutor({
      cwd: "/tmp/x",
      image: "node",
    });
    expect(executor.isolation).toBe("hardened");
    expect(downgradedFrom).toBe("container");
    // Going down in silence would leave the execution marked with an isolation that it did not
    // have.
    expect(reason).toMatch(/no se pudo aislar la red ni el resto del disco/i);
  });

  it("pedir un nivel por su nombre manda sobre el defecto", async () => {
    const spy = vi.spyOn(ContainerExecutor, "findRuntime").mockResolvedValue("docker");

    const duro = await resolveExecutor({ cwd: "/tmp/x", image: "node", requested: "hardened" });
    expect(duro.executor.isolation).toBe("hardened");

    const local = await resolveExecutor({ cwd: "/tmp/x", image: "node", requested: "local" });
    expect(local.executor.isolation).toBe("local");

    // It does not even look for a runtime when it already knows it will not use
    // it.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("el sandbox, ejecutando de verdad", () => {
  /*
    The tests above check what Panoma *says*. This one checks what *happens*, which is the only
    thing that closes the case: a real process is launched and asked to read the home.
    It only runs on macOS because `sandbox-exec` exists only there. On other platforms, `hardened`
    does not promise this, and `unmetPromise()` says it, which is what the test above checks.
   */
  const macOnly = process.platform === "darwin" ? it : it.skip;

  macOnly("el proceso no puede leer tu carpeta personal", async () => {
    const work = realpathSync(await mkdtemp(join(tmpdir(), "panoma-sb-")));
    const executor = new HardenedExecutor(work);
    try {
      const step = await executor.run({
        name: "sonda",
        command: process.execPath,
        args: [
          "-e",
          `try { require("fs").readdirSync(${JSON.stringify(homedir())}); console.log("LEE"); }
           catch (e) { console.log("BLOQUEADO:" + e.code); }`,
        ],
        timeoutMs: 30_000,
      });
      expect(step.output).toContain("BLOQUEADO:EPERM");
      expect(step.output).not.toContain("LEE");
    } finally {
      await executor.dispose();
      await rm(work, { recursive: true, force: true });
    }
  });

  macOnly("pero sí puede trabajar en su worktree", async () => {
    // A sandbox that also prevented working would be a sandbox that someone turns off.
    const work = realpathSync(await mkdtemp(join(tmpdir(), "panoma-sb-")));
    const executor = new HardenedExecutor(work);
    try {
      const step = await executor.run({
        name: "sonda",
        command: process.execPath,
        args: ["-e", `require("fs").writeFileSync("salida.txt", "ok"); console.log("ESCRIBE");`],
        timeoutMs: 30_000,
      });
      expect(step.output).toContain("ESCRIBE");
      expect(await readFile(join(work, "salida.txt"), "utf8")).toBe("ok");
    } finally {
      await executor.dispose();
      await rm(work, { recursive: true, force: true });
    }
  });

  macOnly("y el paso registra el comando real, no el envoltorio", async () => {
    // The execution record has to say what was executed, not what it was wrapped in.
    const work = realpathSync(await mkdtemp(join(tmpdir(), "panoma-sb-")));
    const executor = new HardenedExecutor(work);
    try {
      const step = await executor.run({ name: "x", command: "echo", args: ["hola"], timeoutMs: 10_000 });
      expect(step.command).toBe("echo hola");
      expect(step.command).not.toContain("sandbox-exec");
    } finally {
      await executor.dispose();
      await rm(work, { recursive: true, force: true });
    }
  });
});
