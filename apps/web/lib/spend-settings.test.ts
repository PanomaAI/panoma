import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUDGET_ENV, BUDGET_FAMILIES, FACTORY_CAPS, FAMILY_KINDS, UNBUDGETED_KINDS, capFor, capFrom, capsFor, emptySpendSettings,
  familyOf, parseSpendSettings, patchSpendSettings, rateKey, readSpendSettings, resolveCap, shotPolicy, spendSettingsPath,
  writeSpendSettings,
} from "./spend-settings";

let home: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-spend-"));
  savedEnv["PANOMA_HOME"] = process.env["PANOMA_HOME"];
  process.env["PANOMA_HOME"] = home;
  for (const variable of Object.values(BUDGET_ENV)) {
    savedEnv[variable] = process.env[variable];
    delete process.env[variable];
  }
});

afterEach(async () => {
  for (const [variable, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[variable];
    else process.env[variable] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("the shared cap contract", () => {
  it("falls to the fallback on nothing, and reads what is written", () => {
    expect(capFrom(undefined, 20)).toBe(20);
    expect(capFrom("   ", 20)).toBe(20);
    expect(capFrom(" 40 ", 20)).toBe(40);
    expect(capFrom("1e3", 20)).toBe(1_000);
    expect(capFrom("0", 20)).toBe(0);
  });

  it("never turns a value it cannot read into no limit", () => {
    for (const value of ["cien", "-1", "3.5", "NaN", "Infinity", "10 calls"]) {
      expect(capFrom(value, 20)).toBe(20);
    }
  });
});

describe("every ledger kind answers to one family or to none", () => {
  it("maps the budgeted kinds and leaves the probe out", () => {
    expect(familyOf("distill")).toBe("read");
    expect(familyOf("classify")).toBe("read");
    expect(familyOf("synthesize")).toBe("read");
    expect(familyOf("look")).toBe("look");
    expect(familyOf("memory")).toBe("memory");
    expect(familyOf("ask")).toBe("ask");
    expect(familyOf("rehearse")).toBe("rehearse");
    expect(familyOf("episodes")).toBe("episodes");
    expect(familyOf("describe")).toBe("card");
    expect(familyOf("review")).toBe("card");
    expect(familyOf("handoff")).toBe("handoff");
    for (const kind of UNBUDGETED_KINDS) expect(familyOf(kind)).toBeUndefined();
  });

  it("names no kind twice", () => {
    const all = BUDGET_FAMILIES.flatMap((family) => [...FAMILY_KINDS[family]]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("the precedence of a cap", () => {
  const settings = { ...emptySpendSettings(), caps: { look: 5 } };

  it("uses the factory value when nothing was chosen", () => {
    expect(resolveCap("read", {}, emptySpendSettings())).toEqual({ cap: 300, source: "factory", factory: 300 });
  });

  it("prefers the file over the factory value", () => {
    expect(resolveCap("look", {}, settings)).toEqual({ cap: 5, source: "file", factory: 20 });
  });

  it("prefers the environment over the file, and says what it read", () => {
    expect(resolveCap("look", { PANOMA_LOOK_BUDGET: "7" }, settings)).toEqual({ cap: 7, source: "env", factory: 20, env: "7" });
  });

  it("an unreadable variable still decides, and decides the factory value", () => {
    // Not the file's five: the environment is set, so the file is not applied, and what the
    // environment says cannot be read, so it is the factory value — and the screen can say both.
    expect(resolveCap("look", { PANOMA_LOOK_BUDGET: "cien" }, settings)).toEqual({ cap: 20, source: "env", factory: 20, env: "cien" });
  });

  it("a blank variable is the same as no variable", () => {
    expect(resolveCap("look", { PANOMA_LOOK_BUDGET: "  " }, settings)).toEqual({ cap: 5, source: "file", factory: 20 });
  });

  it("the pause wins over everything, including the environment", () => {
    const paused = { ...settings, paused: true };
    expect(resolveCap("look", { PANOMA_LOOK_BUDGET: "7" }, paused)).toEqual({ cap: 0, source: "paused", factory: 20, env: "7" });
    expect(resolveCap("read", {}, paused)).toEqual({ cap: 0, source: "paused", factory: 300 });
  });

  it("zero in the file switches the organ off", () => {
    expect(resolveCap("memory", {}, { ...emptySpendSettings(), caps: { memory: 0 } }).cap).toBe(0);
  });
});

describe("the file on disk", () => {
  it("lives under PANOMA_HOME", () => {
    expect(spendSettingsPath()).toBe(join(home, "spend.json"));
  });

  it("is empty settings when it does not exist, and not broken", async () => {
    expect(await readSpendSettings()).toEqual({ settings: emptySpendSettings(), broken: false });
  });

  it("round-trips what was written", async () => {
    const settings = {
      caps: { read: 50, card: 0 },
      rates: { [rateKey("anthropic", "claude-opus-5")]: { input: 5, output: 25 } },
      currency: "EUR",
      paused: false,
      shots: "fit" as const,
    };
    await writeSpendSettings(settings);
    expect(await readSpendSettings()).toEqual({ settings, broken: false });
    expect((await capFor("read")).cap).toBe(50);
    expect((await capFor("card")).cap).toBe(0);
    expect((await capsFor()).look).toEqual({ cap: 20, source: "factory", factory: 20 });
    expect(await shotPolicy()).toBe("fit");
  });

  it("shows the critic the whole capture until somebody says otherwise", async () => {
    expect(await shotPolicy()).toBe("full");
  });

  it("reports a file it cannot read as broken and falls to empty settings", async () => {
    await writeFile(spendSettingsPath(), "{ not json");
    expect(await readSpendSettings()).toEqual({ settings: emptySpendSettings(), broken: true });
    await writeFile(spendSettingsPath(), "[]");
    expect((await readSpendSettings()).broken).toBe(true);
  });

  it("keeps what it understands and drops the rest when reading", () => {
    const parsed = parseSpendSettings({
      caps: { read: 10, look: -1, memory: 2.5, ask: "20", nope: 3, episodes: 100_001 },
      rates: { "a/b": { input: 1, output: 2 }, "no-slash": { input: 1, output: 2 }, "c/d": { input: -1, output: 2 }, "e/f": { input: 1 } },
      currency: "usd",
      paused: "yes",
      shots: "tiny",
      extra: true,
    });
    expect(parsed).toEqual({ caps: { read: 10 }, rates: { "a/b": { input: 1, output: 2 } }, currency: "USD", paused: false, shots: "full" });
  });
});

describe("what a form may change", () => {
  const current = { caps: { read: 50 }, rates: { "a/b": { input: 1, output: 2 } }, currency: "USD", paused: false, shots: "full" as const };

  it("replaces caps family by family and clears one with null", () => {
    const result = patchSpendSettings(current, { caps: { look: 3, read: null } });
    expect(result).toEqual({ settings: { ...current, caps: { look: 3 } } });
  });

  it("replaces the whole rate map, skipping rows sent as null", () => {
    const result = patchSpendSettings(current, { rates: { "c/d": { input: 3, output: 15 }, "a/b": null } });
    expect(result).toEqual({ settings: { ...current, rates: { "c/d": { input: 3, output: 15 } } } });
  });

  it("changes the currency and the pause", () => {
    expect(patchSpendSettings(current, { currency: "EUR", paused: true })).toEqual({ settings: { ...current, currency: "EUR", paused: true } });
  });

  it("changes what the critic is shown", () => {
    expect(patchSpendSettings(current, { shots: "fit" })).toEqual({ settings: { ...current, shots: "fit" } });
    expect(patchSpendSettings({ ...current, shots: "fit" }, { shots: "full" })).toEqual({ settings: current });
  });

  it("refuses a wrong field by name and changes nothing", () => {
    expect(patchSpendSettings(current, "no")).toEqual({ fault: "body" });
    expect(patchSpendSettings(current, { caps: { read: "50" } })).toEqual({ fault: "caps" });
    expect(patchSpendSettings(current, { caps: { nope: 1 } })).toEqual({ fault: "caps" });
    expect(patchSpendSettings(current, { caps: { read: 100_001 } })).toEqual({ fault: "caps" });
    expect(patchSpendSettings(current, { rates: { "no-slash": { input: 1, output: 1 } } })).toEqual({ fault: "rates" });
    expect(patchSpendSettings(current, { rates: { "a/b": { input: 1 } } })).toEqual({ fault: "rates" });
    expect(patchSpendSettings(current, { currency: "euros" })).toEqual({ fault: "currency" });
    expect(patchSpendSettings(current, { paused: "true" })).toEqual({ fault: "paused" });
    expect(patchSpendSettings(current, { shots: "half" })).toEqual({ fault: "shots" });
  });

  it("accepts an empty patch as no change", () => {
    expect(patchSpendSettings(current, {})).toEqual({ settings: current });
  });
});

describe("the factory values", () => {
  it("match the nine documented in docs/budgets.md", () => {
    expect(FACTORY_CAPS).toEqual({ read: 300, look: 20, memory: 12, ask: 20, rehearse: 20, episodes: 20, card: 100, app: 20, handoff: 10 });
  });
});
