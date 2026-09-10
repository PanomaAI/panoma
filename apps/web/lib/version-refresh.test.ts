import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The daily question, asked from the server this time — and above all what it must not do.
 *
 * This process lives for weeks and renders a page several times at once, so the mistakes available
 * here are not the terminal's. One query per render, a second question while the first is still in
 * the air, or a clock of its own that ignores what the terminal asked an hour ago: each of those
 * turns a courtesy into a nuisance for a service nobody forces to keep running.
 */

let home: string;
const originalHome = process.env["PANOMA_HOME"];
const originalOff = process.env["PANOMA_NO_UPDATE_CHECK"];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-refresh-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["PANOMA_NO_UPDATE_CHECK"];
  /*
    The seal `panoma up` leaves, describing this very process. Without it the server does not know
    which panoma it is, and a server that cannot compare an answer does not ask for one — so every
    case below would otherwise be testing the same early return.
   */
  await writeFile(join(home, "web.json"), JSON.stringify({ pid: process.pid, version: "0.1.9" }));
  /* The module remembers when it last asked, so each case gets a fresh one. */
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  if (originalOff === undefined) delete process.env["PANOMA_NO_UPDATE_CHECK"];
  else process.env["PANOMA_NO_UPDATE_CHECK"] = originalOff;
  await rm(home, { recursive: true, force: true });
});

/** A registry that answers, and a spy on how it was asked. */
function registryAnswers(version: string) {
  const spy = vi.fn(async () => new Response(JSON.stringify({ version })));
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function refresh() {
  const { refreshLatestIfDue } = await import("./version-refresh");
  return refreshLatestIfDue();
}

async function remembered(): Promise<{ visto?: number; ultima?: string }> {
  try {
    return JSON.parse(await readFile(join(home, "version.json"), "utf8"));
  } catch {
    return {};
  }
}

describe("asking once a day, from the server", () => {
  it("asks when nobody has, and writes the answer where the terminal will read it", async () => {
    const spy = registryAnswers("0.2.0");
    await refresh();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await remembered()).ultima).toBe("0.2.0");
  });

  it("does not ask again for a day, whoever asked", async () => {
    /*
      One clock for both halves. The terminal wrote this an hour ago; the server has nothing to add
      and asking again would be two questions for one answer.
     */
    await writeFile(join(home, "version.json"), JSON.stringify({ visto: Date.now(), ultima: "0.2.0" }));
    const spy = registryAnswers("0.2.0");
    await refresh();
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks again once the day has gone by", async () => {
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    await writeFile(join(home, "version.json"), JSON.stringify({ visto: yesterday, ultima: "0.1.0" }));
    const spy = registryAnswers("0.2.0");
    await refresh();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await remembered()).ultima).toBe("0.2.0");
  });

  it("two renders arriving together produce one question", async () => {
    // Next renders a page several times at once; this server is not the terminal.
    const spy = registryAnswers("0.2.0");
    const { refreshLatestIfDue } = await import("./version-refresh");
    await Promise.all([refreshLatestIfDue(), refreshLatestIfDue(), refreshLatestIfDue()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a failure costs one window and not a question per render", async () => {
    /*
      The mark goes down before asking. Without that, a machine with no network would ask again on
      every single render for as long as the server is up — which is weeks.
     */
    const spy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", spy);
    const { refreshLatestIfDue } = await import("./version-refresh");
    await refreshLatestIfDue();
    await refreshLatestIfDue();
    await refreshLatestIfDue();
    expect(spy).toHaveBeenCalledTimes(1);
    /* And nothing false is written down: the terminal still sees no answer, not a wrong one. */
    expect((await remembered()).ultima).toBeUndefined();
  });

  it("a registry that answers badly leaves the memory alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await writeFile(join(home, "version.json"), JSON.stringify({ visto: 1, ultima: "0.1.9" }));
    await refresh();
    expect((await remembered()).ultima).toBe("0.1.9");
  });

  it("and so does an answer that is not the shape it promised", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{ not json")));
    await refresh();
    expect((await remembered()).ultima).toBeUndefined();
  });
});

describe("who does not ask at all", () => {
  it("a server that does not know which panoma it is stays out of it", async () => {
    /*
      `pnpm dev`, an editor panel, or a seal left behind by a process that died: there is nothing
      to compare an answer against, so asking would spend a free service's time for nothing.
     */
    await writeFile(join(home, "web.json"), JSON.stringify({ pid: process.pid + 1, version: "0.1.9" }));
    const spy = registryAnswers("0.2.0");
    await refresh();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the promises this question makes", () => {
  it("goes to the registry and never to a server of ours", async () => {
    /*
      The line the doctrine draws is *whose* server, not which process, and it is the reason the
      terminal's own test asserts the same thing. A second caller gets the same assertion.
     */
    const spy = registryAnswers("0.2.0");
    await refresh();
    const [url] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("registry.npmjs.org");
    expect(url).not.toContain("panoma.ai");
  });

  it("identifies itself and gives up after two seconds", async () => {
    const spy = registryAnswers("0.2.0");
    await refresh();
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(String((init.headers as Record<string, string>)["user-agent"])).toContain("panoma");
    /* The ceiling is the point: this must never be what a page is waiting for. */
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("asks for a format the registry actually serves on that path", async () => {
    /*
      The bug this pins. npm's abbreviated document is defined for a package's full packument, not
      for `/<name>/latest`, and the registry answers **406** to that pair — three times out of three
      on 7-Sep-2026, from Node and from curl. Every non-200 reads as "no answer" here, so the
      failure was invisible: the visit stamped, nothing learnt, nobody told. It had worked earlier
      the same day, which is what kept it hidden.
     */
    const spy = registryAnswers("0.2.0");
    await refresh();
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    const accept = String((init.headers as Record<string, string>)["accept"]);
    expect(accept).toBe("application/json");
    expect(accept).not.toContain("vnd.npm.install");
  });

  it("stops reading a body that will not fit, instead of measuring it once it is in memory", async () => {
    /*
      Measured before it was fixed: a chunked answer —no `Content-Length`, which is the ordinary
      case— buffered 2.1 GB in the two seconds the ceiling allows, because the size was checked
      after `text()` had already resolved. The bytes are counted as they arrive now, and the read is
      cancelled the moment they pass the cap. It is the same rule `packages/enrich/src/http.ts`
      arrived at, in this same house, for this same reason.
     */
    let cancelled = false;
    const flood = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(32 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(flood, { headers: { "content-type": "application/json" } })));
    await refresh();
    expect(cancelled, "the read was not cut off").toBe(true);
    expect((await remembered()).ultima).toBeUndefined();
  });

  it("says nothing at all when the off switch is set", async () => {
    process.env["PANOMA_NO_UPDATE_CHECK"] = "1";
    const spy = registryAnswers("0.2.0");
    await refresh();
    expect(spy).not.toHaveBeenCalled();
  });
});
