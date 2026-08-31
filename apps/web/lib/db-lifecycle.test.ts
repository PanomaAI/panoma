import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_EVERY_MS,
  SHUTDOWN_GRACE_MS,
  SIGNALS,
  manageLifecycle,
  type Closable,
  type Hooks,
} from "./db-lifecycle";

/**
 * A test bench with the hands out.
 *
 * No real signs or waiting five minutes: the triggers are stored and fired by hand, which is
 * exactly what they exist for.
 */
function banco(base: Partial<Closable> = {}) {
  const manos = new Map<string, () => void>();
  const registro: string[] = [];
  const salidas: number[] = [];
  const intervalos: { ms: number; mano: () => void; sinReferencia: boolean }[] = [];
  const esperas: number[] = [];

  const database: Closable = {
    close: base.close ?? (() => Promise.resolve()),
    checkpoint: base.checkpoint ?? (() => Promise.resolve()),
  };

  const hooks: Hooks = {
    onSignal: (signal, handler) => manos.set(signal, handler),
    everyMs: (ms, mano) => {
      const entrada = { ms, mano, sinReferencia: false };
      intervalos.push(entrada);
      return {
        unref: () => {
          entrada.sinReferencia = true;
        },
      };
    },
    wait: (ms) => {
      esperas.push(ms);
      // The wait for the closure never wins on its own: it just gives up its turn and that's it.
      // That way the `Promise.race` decides the real closure, unless it never ends.
      return Promise.resolve();
    },
    exit: (code) => salidas.push(code),
    log: (text) => registro.push(text),
  };

  return { database, hooks, manos, registro, salidas, intervalos, esperas };
}

const espirar = () => new Promise((listo) => setImmediate(listo));

describe("el catálogo se cierra antes de que muera el proceso", () => {
  it("escucha las tres señales que significan que te vas", () => {
    const b = banco();
    manageLifecycle(b.database, b.hooks);
    expect([...b.manos.keys()]).toEqual([...SIGNALS]);
  });

  it("cierra la base y sale con el código de la señal", async () => {
    let cerrada = 0;
    const b = banco({
      close: () => {
        cerrada++;
        return Promise.resolve();
      },
    });
    const { shutdown } = manageLifecycle(b.database, b.hooks);

    await shutdown("SIGTERM");

    expect(cerrada).toBe(1);
    expect(b.salidas).toEqual([143]);
  });

  it("un Ctrl-C impaciente no cierra dos veces la misma base", async () => {
    let cerrada = 0;
    const b = banco({
      close: () => {
        cerrada++;
        return Promise.resolve();
      },
    });
    const { shutdown } = manageLifecycle(b.database, b.hooks);

    await Promise.all([shutdown("SIGINT"), shutdown("SIGINT")]);

    expect(cerrada).toBe(1);
    expect(b.salidas).toEqual([130]);
  });

  /*
    A hung closure cannot turn into a process that does not die: whoever sent the signal would end
    up sending a `kill -9`, which is the case against which there is no defense and precisely the
    one that corrupted the database.
   */
  it("se va igualmente si el cierre no termina, y lo dice", async () => {
    const b = banco({ close: () => new Promise(() => {}) });
    const { shutdown } = manageLifecycle(b.database, b.hooks);

    await shutdown("SIGTERM");

    expect(b.esperas).toEqual([SHUTDOWN_GRACE_MS]);
    expect(b.salidas).toEqual([143]);
    expect(b.registro.join(" ")).toContain("no terminó");
  });

  it("si el cierre falla, se sale con el motivo escrito", async () => {
    const b = banco({ close: () => Promise.reject(new Error("disco lleno")) });
    const { shutdown } = manageLifecycle(b.database, b.hooks);

    await shutdown("SIGHUP");

    expect(b.registro.join(" ")).toContain("disco lleno");
    expect(b.salidas).toEqual([129]);
  });

  it("hace punto de control cada cinco minutos, sin sostener el proceso", async () => {
    let puntos = 0;
    const b = banco({
      checkpoint: () => {
        puntos++;
        return Promise.resolve();
      },
    });
    manageLifecycle(b.database, b.hooks);

    expect(b.intervalos).toHaveLength(1);
    expect(b.intervalos[0]!.ms).toBe(CHECKPOINT_EVERY_MS);
    expect(b.intervalos[0]!.sinReferencia).toBe(true);

    b.intervalos[0]!.mano();
    await espirar();
    expect(puntos).toBe(1);
  });

  it("un punto de control fallido se anota y no tumba nada", async () => {
    const b = banco({ checkpoint: () => Promise.reject(new Error("WAL ocupado")) });
    const { checkpointNow } = manageLifecycle(b.database, b.hooks);

    await expect(checkpointNow()).resolves.toBeUndefined();
    expect(b.registro.join(" ")).toContain("WAL ocupado");
  });

  /*
    During the shutdown, no checkpoint is made: `close` already does its own, and doing two at
    once on a system that is shutting down is asking for an error that fixes nothing.
   */
  it("no hace punto de control mientras se está cerrando", async () => {
    let puntos = 0;
    const b = banco({
      close: () => new Promise(() => {}),
      checkpoint: () => {
        puntos++;
        return Promise.resolve();
      },
    });
    const { shutdown, checkpointNow } = manageLifecycle(b.database, b.hooks);

    void shutdown("SIGTERM");
    await espirar();
    await checkpointNow();

    expect(puntos).toBe(0);
  });
});
