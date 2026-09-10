import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * What the catalog may say about its own version, and above all when it must stay quiet.
 *
 * The seal it reads is a fragile file by construction — written once by `panoma up`, never
 * refreshed, left behind by a crash, absent under `next dev` — and the whole design is that every
 * one of those cases comes out as silence instead of a wrong number. A notice that says "you are
 * on 0.1.9" to somebody who is not is worse than no notice: it sends them to reinstall something
 * that was never the problem.
 */

let home: string;
const original = process.env["PANOMA_HOME"];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-notice-"));
  process.env["PANOMA_HOME"] = home;
});

afterEach(async () => {
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

/** The seal as `panoma up` leaves it. By default it describes this very process. */
async function seal(stamp: Record<string, unknown>) {
  await writeFile(join(home, "web.json"), JSON.stringify({ pid: process.pid, ...stamp }));
}

/** What the terminal remembers the registry said. */
async function remembered(ultima?: string) {
  await writeFile(join(home, "version.json"), JSON.stringify({ visto: 1, ...(ultima ? { ultima } : {}) }));
}

async function notice() {
  const { versionNotice } = await import("./version-notice");
  return versionNotice();
}

describe("when the catalog says nothing about its version", () => {
  it("with no seal at all: nobody knows what is running here", async () => {
    await remembered("9.9.9");
    expect(await notice()).toBeUndefined();
  });

  it("when the seal is somebody else's process", async () => {
    /*
      The case that would make this lie: a seal left behind by a crash or a reboot, or one written
      inside the repository, where the spawned process is `pnpm` and the server is its grandchild.
      The pid is the whole gate.
     */
    await seal({ pid: process.pid + 1, version: "0.1.0" });
    await remembered("9.9.9");
    expect(await notice()).toBeUndefined();
  });

  it("when the seal carries no version, which happens when the manifest could not be read", async () => {
    // `JSON.stringify` drops the field entirely when `cliVersion()` returns undefined.
    await seal({ version: undefined });
    await remembered("9.9.9");
    expect(await notice()).toBeUndefined();
  });

  it("when the seal is not readable JSON", async () => {
    await writeFile(join(home, "web.json"), "{ this is not json");
    await remembered("9.9.9");
    expect(await notice()).toBeUndefined();
  });

  it("when nothing has ever asked the registry and the disk holds no newer copy", async () => {
    await seal({ version: "0.1.9" });
    expect(await notice()).toBeUndefined();
  });

  it("when the version running is the one published", async () => {
    await seal({ version: "0.1.9" });
    await remembered("0.1.9");
    expect(await notice()).toBeUndefined();
  });

  it("and it never says the reader is behind on a prerelease of what they already run", async () => {
    // The rule lives in `isNewerVersion`; what is checked here is that this surface obeys it.
    await seal({ version: "0.2.0" });
    await remembered("0.2.0-rc.2");
    expect(await notice()).toBeUndefined();
  });
});

describe("when there is something to say", () => {
  it("names the version the registry publishes and the one running here", async () => {
    await seal({ version: "0.1.9" });
    await remembered("0.2.0");
    expect(await notice()).toEqual({ kind: "newer", running: "0.1.9", latest: "0.2.0" });
  });
});

describe("which of the two things it says, when both could be said", () => {
  it("tells you to restart, not to install what you have already installed", async () => {
    /*
      The sharpest case of the feature and the one the files alone cannot stage: you ran
      `npm i -g panoma@latest`, the disk now holds 0.2.0, and this page is still being served by
      the 0.1.9 that has been up for three weeks. Sending that person to npm again would be the
      notice being wrong at the exact moment it finally mattered.
     */
    const { composeNotice } = await import("./version-notice");
    expect(composeNotice({ running: "0.1.9", installed: "0.2.0", latest: "0.2.0" })).toEqual({
      kind: "restart",
      running: "0.1.9",
      installed: "0.2.0",
    });
  });

  it("falls back to the registry's answer when the disk holds nothing newer", async () => {
    const { composeNotice } = await import("./version-notice");
    expect(composeNotice({ running: "0.1.9", installed: "0.1.9", latest: "0.2.0" })).toEqual({
      kind: "newer",
      running: "0.1.9",
      latest: "0.2.0",
    });
  });

  it("and says nothing at all without a running version, whatever else is known", async () => {
    const { composeNotice } = await import("./version-notice");
    expect(composeNotice({ installed: "9.9.9", latest: "9.9.9" })).toBeUndefined();
  });
});

describe("what the off switch silences", () => {
  const original = process.env["PANOMA_NO_UPDATE_CHECK"];
  afterEach(() => {
    if (original === undefined) delete process.env["PANOMA_NO_UPDATE_CHECK"];
    else process.env["PANOMA_NO_UPDATE_CHECK"] = original;
  });

  it("with PANOMA_NO_UPDATE_CHECK=1 there is no news about a newer release", async () => {
    /*
      Whoever sets that is not asking for a cheaper query, they are asking not to be told. Reading
      it from an answer cached before they set it would nag for ever — and nothing refreshes it any
      more, so «for ever» is literal.
     */
    process.env["PANOMA_NO_UPDATE_CHECK"] = "1";
    await seal({ version: "0.1.9" });
    await remembered("0.2.0");
    expect(await notice()).toBeUndefined();
  });

  it("but «you already updated, restart it» survives, because it asks nobody anything", async () => {
    process.env["PANOMA_NO_UPDATE_CHECK"] = "1";
    const { composeNotice } = await import("./version-notice");
    expect(composeNotice({ running: "0.1.9", installed: "0.2.0" })).toEqual({
      kind: "restart",
      running: "0.1.9",
      installed: "0.2.0",
    });
  });
});

describe("the promise this file makes about the network", () => {
  it("does not ask anybody anything: the daily question stays in the terminal", async () => {
    /*
      The doctrine is argued at length in `apps/cli/src/version-check.ts` and it is about **whose**
      server is asked, never a panoma one. This half does not ask at all — it reads the answer the
      terminal already wrote — and that is worth an assertion, because the cheapest way to break it
      is to add a convenient `fetch` here and never notice.
     */
    const source = await readFile(new URL("./version-notice.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toContain("registry.npmjs.org");
  });
});
