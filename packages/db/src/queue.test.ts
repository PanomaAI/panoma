import { describe, expect, it, vi } from "vitest";
import { queueWrite } from "./queue";

/**
 * What is proven here is that the tail **really sorts**, not that it exists.
 *
 * That is why each test keeps a trace of inputs and outputs instead of just looking at the
 * returned value: the fact that two promises resolve in order proves nothing —`Promise.all`
 * returns them in order no matter what—; what needs to be demonstrated is that the second task did
 * not start until the first one finished. If the `entra` /`sale` are interleaved, the queue is
 * serving no purpose even if the value tests pass.
 */

/** A job that notes when one enters and when one leaves, and takes as long as one is told. */
function slowWork(name: string, ms: number, trace: string[]) {
  return async () => {
    trace.push(`${name}:entra`);
    await new Promise((listo) => setTimeout(listo, ms));
    trace.push(`${name}:sale`);
    return name;
  };
}

describe("la cola única de escritura", () => {
  it("ejecuta en orden de llegada aunque el primero sea el más lento", async () => {
    const trace: string[] = [];
    // The first one takes forty times longer than the second one on purpose: without a queue, “b”
    // overtakes it. It is exactly the race that corrupts the catalog when the file system watchdog
    // triggers an ingestion while another is halfway through.
    const a = queueWrite(slowWork("a", 40, trace));
    const b = queueWrite(slowWork("b", 1, trace));

    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(trace).toEqual(["a:entra", "a:sale", "b:entra", "b:sale"]);
  });

  it("sin la cola, esos mismos dos trabajos sí se solapan", async () => {
    /*
      The control of the test above. Without this, that assertion could be happening by chance
      —because the delays turned out round, because the scheduler was kind— and no one would
      notice. Here the same two jobs are executed without queuing, and it is checked that the
      natural order is the opposite: if someday this check starts to fail, the test above has
      stopped testing what it claims to test.
     */
    const trace: string[] = [];
    await Promise.all([slowWork("a", 40, trace)(), slowWork("b", 1, trace)()]);

    expect(trace).toEqual(["a:entra", "b:entra", "b:sale", "a:sale"]);
  });

  it("un trabajo que falla devuelve su error y no se lleva por delante al siguiente", async () => {
    const trace: string[] = [];
    const roto = queueWrite(async () => {
      trace.push("roto");
      throw new Error("la ingesta se cayó a mitad");
    });
    const next = queueWrite(async () => {
      trace.push("siguiente");
      return "done";
    });

    // The rejection reaches the caller intact: the glue neither swallows nor wraps it.
    await expect(roto).rejects.toThrow("la ingesta se cayó a mitad");
    // And the chain is still alive. If the rejection were to propagate through the tail, this would
    // be left hanging or rejected with someone else's error.
    await expect(next).resolves.toBe("done");
    expect(trace).toEqual(["roto", "siguiente"]);
  });

  it("un trabajo que revienta antes del primer await tampoco atasca la cola", async () => {
    // A synchronous `throw` does not manage to return a promise. Without the `.then(work)` that
    // converts the exception into a rejection, this would blow up inside the queue itself and leave
    // it broken for everything that came afterward.
    const blowsUp = queueWrite((() => {
      throw new Error("ni siquiera empezó");
    }) as () => Promise<never>);

    await expect(blowsUp).rejects.toThrow("ni siquiera empezó");
    await expect(queueWrite(async () => "sigo aquí")).resolves.toBe("sigo aquí");
  });

  it("dos instancias del módulo comparten una sola cola", async () => {
    /*
      The reason for the existence of the state in `globalThis`. The hot reload of Next
      re-evaluates the modules, so web routes may end up talking to different instances of this
      file. `vi.resetModules()` reproduces exactly that.
      If the queue lived in a module variable, there would be two queues and each would order only
      its own: the trace would come out interleaved and the catalog would have two writers.
     */
    const trace: string[] = [];
    const first = await import("./queue");
    vi.resetModules();
    const second = await import("./queue");

    expect(second).not.toBe(first);

    const a = first.queueWrite(slowWork("a", 40, trace));
    const b = second.queueWrite(slowWork("b", 1, trace));
    await Promise.all([a, b]);

    expect(trace).toEqual(["a:entra", "a:sale", "b:entra", "b:sale"]);
  });
});
