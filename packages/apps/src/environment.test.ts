import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { APP_ENV_NAMES, buildAppEnvironment, SECRET_PATTERN } from "./environment";

it("inherits only the documented nonsecret environment, never host execution flags or credentials", () => {
  const env = buildAppEnvironment("panoma-video", { source: {
    PATH: "/bin", HOME: "/home/example", NODE_OPTIONS: "--inspect", npm_config_registry: "https://evil.invalid",
    DATABASE_URL: "postgres://secret", PANOMA_OPERATOR_KEY: "secret", OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret",
  } });
  expect(env.PATH).toBe("/bin");
  expect(Object.keys(env).filter((name) => SECRET_PATTERN.test(name))).toEqual([]);
  for (const key of ["DATABASE_URL", "NODE_OPTIONS", "npm_config_registry"]) expect(env).not.toHaveProperty(key);
  expect(APP_ENV_NAMES).toEqual([
    "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "SHELL", "USER", "CI",
    "SystemRoot", "windir", "SystemDrive", "ComSpec", "PATHEXT", "TEMP", "TMP",
    "APPDATA", "LOCALAPPDATA", "USERPROFILE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  ]);
  expect(APP_ENV_NAMES.filter((name) => SECRET_PATTERN.test(name))).toEqual([]);
  expect(readFileSync(new URL("environment.ts", import.meta.url), "utf8")).not.toMatch(/\.\.\.process\.env/);
});

it("carries what Node, cmd.exe and a browser need on Windows, and nothing more", () => {
  // Named as Windows spells them; on this platform the parent has none of them and none travel.
  const env = buildAppEnvironment("panoma-video", { source: {
    SystemRoot: "C:\\Windows", windir: "C:\\Windows", ComSpec: "C:\\Windows\\system32\\cmd.exe",
    PATHEXT: ".COM;.EXE;.BAT;.CMD", TEMP: "C:\\Temp", LOCALAPPDATA: "C:\\Users\\p\\AppData\\Local",
    USERPROFILE: "C:\\Users\\p", PANOMA_OPERATOR_KEY: "secret", DATABASE_URL: "postgres://secret",
  } });
  for (const key of ["SystemRoot", "ComSpec", "PATHEXT", "TEMP", "LOCALAPPDATA", "USERPROFILE"]) {
    expect(env, key + " must reach the child on Windows").toHaveProperty(key);
  }
  for (const key of ["PANOMA_OPERATOR_KEY", "DATABASE_URL"]) expect(env).not.toHaveProperty(key);
});

it("grants only explicitly selected provider keys and a bounded per-job budget", () => {
  const env = buildAppEnvironment("panoma-video", { source: {}, providerEnv: { ELEVENLABS_API_KEY: "authorized" }, maxBrainCalls: 2, jobId: "job-example" });
  expect(env.ELEVENLABS_API_KEY).toBe("authorized");
  expect(env.PANOMA_VIDEO_MAX_BRAIN_CALLS).toBe("2");
  expect(() => buildAppEnvironment("panoma-video", { providerEnv: { PANOMA_KEY: "no" } })).toThrow("provider-key-not-allowed");
  expect(() => buildAppEnvironment("panoma-video", { maxBrainCalls: -1 })).toThrow("invalid-brain-budget");
});
