import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "./memory-contract";
import { MemoryShapeError } from "./predicates";
import {
  CHECK_KINDS,
  CHECK_LIMITS,
  CHECK_PURPOSES,
  environmentIdOf,
  evaluateCheck,
  inspectedFingerprint,
  isStoredCheck,
  readEnvironment,
  readGitHead,
  validateCheck,
  type Check,
  type CheckEvaluation,
  type InspectedFile,
} from "./checks-eval";

/*
  What is held here is the plan's own list for the evaluator (§9.1, §9.2, §20.3, C02/T46,
  C03/T48): every check kind passes and fails on fixtures the test writes; an unreadable file, a
  symlink that leaves the root, a file over the cap and a malformed, too deep or too wide document
  are `unknown` with the reason and the coverage — never `fail`, so nothing is challenged by an
  accident of access; two worktrees at one HEAD with different dirty files are two environments;
  an observation is stale at ten minutes or when a hash moved, whichever first. The validator's
  half is the closed grammar of a check: every kind's shape, the legacy anchor normalized, an
  extra key refused with a code.
 */

let scratch = "";
let cases = 0;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "panoma-checks-")));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A fresh project folder with these files, under the suite's scratch. */
function project(files: Record<string, string | Buffer>): string {
  cases += 1;
  const root = join(scratch, `case-${cases}`);
  mkdirSync(root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function check(definition: Omit<Check, "schemaVersion" | "purpose"> & { purpose?: Check["purpose"] }): Check {
  return validateCheck({ schemaVersion: 1, purpose: "grounds", ...definition });
}

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MemoryShapeError) return error.code;
    throw error;
  }
  throw new Error("expected a shape error");
}

const HASH = "a".repeat(64);
const noPrivileges = process.platform === "win32" || process.getuid?.() === 0;

describe("validateCheck — the closed grammar of a check", () => {
  it("accepts every kind with its shape and returns a fresh object of validated keys only", () => {
    expect(CHECK_KINDS).toHaveLength(7);
    expect(CHECK_PURPOSES).toEqual(["grounds", "applicability", "violation", "completion"]);
    const stored = validateCheck({
      schemaVersion: 1, checkId: "chk_0123456789ab", revision: 3, purpose: "violation",
      kind: "text_absent", target: "apps/web/lib/x.ts", expected: "console.log",
    });
    expect(stored).toEqual({
      schemaVersion: 1, checkId: "chk_0123456789ab", revision: 3, purpose: "violation",
      kind: "text_absent", target: "apps/web/lib/x.ts", expected: "console.log",
    });
    expect(isStoredCheck(stored)).toBe(true);

    expect(check({ kind: "path_exists", target: "ops/x.mjs", expected: false })).toMatchObject({ expected: false });
    expect(check({ kind: "file_hash", target: "a.txt", expected: HASH })).toMatchObject({ expected: HASH });
    expect(check({ kind: "text_present", target: "a.txt", expected: "x" })).toMatchObject({ kind: "text_present" });
    expect(check({ kind: "manifest_script", target: "package.json", expected: { name: "test" } })).toMatchObject({ expected: { name: "test" } });
    expect(check({ kind: "manifest_script", target: "apps/web/package.json", expected: { name: "test", definition: "vitest run" } }))
      .toMatchObject({ expected: { name: "test", definition: "vitest run" } });
    expect(check({ kind: "direct_dependency", target: "package.json", expected: { ecosystem: "npm", name: "react" } }))
      .toMatchObject({ expected: { ecosystem: "npm", name: "react" } });
    expect(check({ kind: "direct_dependency", target: "Cargo.toml", expected: { ecosystem: "cargo", name: "serde", version: "1" } }))
      .toMatchObject({ expected: { version: "1" } });
    expect(check({ kind: "direct_dependency", target: "requirements-dev.txt", expected: { ecosystem: "pip", name: "requests" } })).toBeTruthy();
    expect(check({ kind: "direct_dependency", target: "pyproject.toml", expected: { ecosystem: "pip", name: "requests" } })).toBeTruthy();
    expect(check({ kind: "direct_dependency", target: "go.mod", expected: { ecosystem: "go", name: "github.com/x/y" } })).toBeTruthy();
    expect(check({ kind: "structured_key", target: "config.yml", expected: { path: ["a", "b"], value: { c: [1, "2", null] } } }))
      .toMatchObject({ expected: { path: ["a", "b"], value: { c: [1, "2", null] } } });
    const proposed = check({ kind: "path_exists", target: "x", expected: true });
    expect(isStoredCheck(proposed)).toBe(false);
    expect("checkId" in proposed).toBe(false);
  });

  it("normalizes a legacy sentinel: grounds purpose, file_contains → text_present, no id or revision", () => {
    expect(validateCheck({ kind: "path_exists", target: "ops/migrate.mjs", expected: true })).toEqual({
      schemaVersion: 1, purpose: "grounds", kind: "path_exists", target: "ops/migrate.mjs", expected: true,
    });
    expect(validateCheck({ kind: "file_contains", target: "README.md", expected: "pnpm install" })).toEqual({
      schemaVersion: 1, purpose: "grounds", kind: "text_present", target: "README.md", expected: "pnpm install",
    });
    expect(validateCheck({ kind: "file_hash", target: "a.txt", expected: "0123456789abcdef" })).toMatchObject({ kind: "file_hash", expected: "0123456789abcdef" });
    expect(code(() => validateCheck({ kind: "file_contains", target: "x", expected: true }))).toBe("expected");
    expect(code(() => validateCheck({ kind: "file_hash", target: "x", expected: "abc" }))).toBe("expected");
    expect(code(() => validateCheck({ kind: "path_exists", target: "x", expected: true, purpose: "grounds" }))).toBe("extra_key");
    // A new-shape kind without a version is not a legacy anchor.
    expect(code(() => validateCheck({ kind: "text_present", target: "x", expected: "y" }))).toBe("schema_version");
  });

  it("refuses the envelope: not an object, extra keys, schemaVersion, purpose, kind, id and revision pairing", () => {
    expect(code(() => validateCheck(null))).toBe("not_object");
    expect(code(() => validateCheck([]))).toBe("not_object");
    expect(code(() => validateCheck({ schemaVersion: 1, purpose: "grounds", kind: "path_exists", target: "x", expected: true, note: 1 }))).toBe("extra_key");
    expect(code(() => validateCheck({ schemaVersion: 2, purpose: "grounds", kind: "path_exists", target: "x", expected: true }))).toBe("schema_version");
    expect(code(() => validateCheck({ schemaVersion: 1, purpose: "obedience", kind: "path_exists", target: "x", expected: true }))).toBe("unknown_purpose");
    expect(code(() => validateCheck({ schemaVersion: 1, purpose: "grounds", kind: "regex", target: "x", expected: ".*" }))).toBe("unknown_kind");
    expect(code(() => validateCheck({ schemaVersion: 1, purpose: "grounds", kind: "file_contains", target: "x", expected: "y" }))).toBe("unknown_kind");
    expect(code(() => validateCheck({ schemaVersion: 1, checkId: "chk_0123456789ab", purpose: "grounds", kind: "path_exists", target: "x", expected: true }))).toBe("check_id");
    expect(code(() => validateCheck({ schemaVersion: 1, revision: 1, purpose: "grounds", kind: "path_exists", target: "x", expected: true }))).toBe("check_id");
    expect(code(() => validateCheck({ schemaVersion: 1, checkId: "note_1", revision: 1, purpose: "grounds", kind: "path_exists", target: "x", expected: true }))).toBe("check_id");
    expect(code(() => validateCheck({ schemaVersion: 1, checkId: "chk_0123456789ab", revision: 0, purpose: "grounds", kind: "path_exists", target: "x", expected: true }))).toBe("revision");
  });

  it.each([
    ["../x", "path_exists", true],
    ["/etc/passwd", "path_exists", true],
    ["a/*", "path_exists", true],
    ["x".repeat(CHECK_LIMITS.targetLength + 1), "path_exists", true],
    ["", "path_exists", true],
    ["scripts.txt", "manifest_script", { name: "x" }],
    ["Cargo.toml", "direct_dependency", { ecosystem: "npm", name: "x" }],
    ["package.json", "direct_dependency", { ecosystem: "cargo", name: "x" }],
    ["setup.py", "direct_dependency", { ecosystem: "pip", name: "x" }],
    ["go.sum", "direct_dependency", { ecosystem: "go", name: "x" }],
    ["config.ini", "structured_key", { path: ["a"] }],
  ])("refuses target %j for %s", (target, kind, expected) => {
    expect(code(() => validateCheck({ schemaVersion: 1, purpose: "grounds", kind, target, expected }))).toBe("target");
  });

  it.each([
    ["path_exists", "yes"],
    ["file_hash", "A".repeat(64)],
    ["file_hash", "abc"],
    ["text_present", ""],
    ["text_present", "x".repeat(2_049)],
    ["text_absent", 3],
    ["manifest_script", "test"],
    ["manifest_script", { name: "" }],
    ["manifest_script", { name: "te st" }],
    ["manifest_script", { name: "test", definition: "" }],
    ["direct_dependency", { ecosystem: "maven", name: "x" }],
    ["direct_dependency", { ecosystem: "npm" }],
    ["direct_dependency", { ecosystem: "npm", name: "a b" }],
    ["direct_dependency", { ecosystem: "npm", name: "x", version: "" }],
    ["structured_key", { path: [] }],
    ["structured_key", { path: ["a", 1] }],
    ["structured_key", { path: Array.from({ length: 21 }, (_, i) => `k${i}`) }],
    ["structured_key", { path: ["a"], value: () => 1 }],
    ["structured_key", { path: ["a"], value: "v".repeat(2_100) }],
    ["structured_key", { path: ["a"], value: Number.POSITIVE_INFINITY }],
  ])("refuses a bad expected for %s: %j", (kind, expected) => {
    const target = kind === "manifest_script" ? "package.json" : kind === "direct_dependency" ? "package.json" : kind === "structured_key" ? "a.json" : "a.txt";
    expect(code(() => validateCheck({ schemaVersion: 1, purpose: "grounds", kind, target, expected }))).toBe("expected");
  });

  it("refuses extra keys inside a structured expected", () => {
    expect(code(() => check({ kind: "manifest_script", target: "package.json", expected: { name: "x", command: "rm" } as never }))).toBe("extra_key");
    expect(code(() => check({ kind: "direct_dependency", target: "package.json", expected: { ecosystem: "npm", name: "x", regex: ".*" } as never }))).toBe("extra_key");
    expect(code(() => check({ kind: "structured_key", target: "a.json", expected: { path: ["a"], module: "fs" } as never }))).toBe("extra_key");
  });
});

describe("evaluateCheck — every kind on fixtures", () => {
  it("path_exists answers existence for files, folders and absence; expected false inverts", async () => {
    const root = project({ "ops/migrate.mjs": "export {}", "docs/README.md": "# x" });
    const on = async (target: string, expected: boolean) => evaluateCheck(root, check({ kind: "path_exists", target, expected }));
    expect(await on("ops/migrate.mjs", true)).toEqual({ result: "pass", reason: "exists", inspected: [{ path: "ops/migrate.mjs", state: "read" }] });
    expect(await on("docs", true)).toMatchObject({ result: "pass", reason: "exists" });
    expect(await on("ops/gone.mjs", true)).toEqual({ result: "fail", reason: "absent", inspected: [{ path: "ops/gone.mjs", state: "missing" }] });
    expect(await on("ops/gone.mjs", false)).toMatchObject({ result: "pass", reason: "absent" });
    expect(await on("ops/migrate.mjs", false)).toMatchObject({ result: "fail", reason: "exists" });
    // A file where a folder was expected on the way: not there.
    expect(await on("ops/migrate.mjs/inner", true)).toMatchObject({ result: "fail", reason: "absent" });
  });

  it("file_hash compares the whole digest, or the legacy prefix, and reports the digest seen", async () => {
    const root = project({ "a.txt": "hello\n" });
    const digest = sha256Hex("hello\n");
    const match = await evaluateCheck(root, check({ kind: "file_hash", target: "a.txt", expected: digest }));
    expect(match).toEqual({ result: "pass", reason: "hash_match", inspected: [{ path: "a.txt", hash: digest, state: "read" }], observed: digest });
    expect(await evaluateCheck(root, check({ kind: "file_hash", target: "a.txt", expected: "b".repeat(64) }))).toMatchObject({ result: "fail", reason: "hash_mismatch", observed: digest });
    const legacy = validateCheck({ kind: "file_hash", target: "a.txt", expected: digest.slice(0, 16) });
    expect(await evaluateCheck(root, legacy)).toMatchObject({ result: "pass", reason: "hash_match" });
    const wrongPrefix = validateCheck({ kind: "file_hash", target: "a.txt", expected: "0".repeat(16) });
    expect(await evaluateCheck(root, wrongPrefix)).toMatchObject({ result: "fail", reason: "hash_mismatch" });
  });

  it("text_present and text_absent look for the literal, through a BOM and Unicode", async () => {
    const root = project({ "README.md": "\uFEFF# panoma\n\nRun `pnpm install` — el número al final.\n" });
    expect(await evaluateCheck(root, check({ kind: "text_present", target: "README.md", expected: "pnpm install" }))).toMatchObject({ result: "pass", reason: "present" });
    expect(await evaluateCheck(root, check({ kind: "text_present", target: "README.md", expected: "número al final" }))).toMatchObject({ result: "pass" });
    expect(await evaluateCheck(root, check({ kind: "text_present", target: "README.md", expected: "yarn install" }))).toMatchObject({ result: "fail", reason: "absent" });
    expect(await evaluateCheck(root, check({ kind: "text_absent", target: "README.md", expected: "yarn" }))).toMatchObject({ result: "pass", reason: "absent" });
    expect(await evaluateCheck(root, check({ kind: "text_absent", target: "README.md", expected: "pnpm" }))).toMatchObject({ result: "fail", reason: "present" });
    // The literal is a literal: a regex in it matches nothing but itself.
    expect(await evaluateCheck(root, check({ kind: "text_present", target: "README.md", expected: "pnpm.*install" }))).toMatchObject({ result: "fail" });
  });

  it("manifest_script says a script exists, with its definition when asked, and never runs it", async () => {
    const root = project({
      "package.json": JSON.stringify({ name: "x", scripts: { test: "vitest run", build: "tsup" } }),
      "apps/site/package.json": JSON.stringify({ scripts: "not an object" }),
    });
    const on = async (expected: { name: string; definition?: string }, target = "package.json") =>
      evaluateCheck(root, check({ kind: "manifest_script", target, expected }));
    expect(await on({ name: "test" })).toMatchObject({ result: "pass", reason: "script_defined" });
    expect(await on({ name: "test", definition: "vitest run" })).toMatchObject({ result: "pass", reason: "script_defined" });
    expect(await on({ name: "test", definition: "vitest run --coverage" })).toMatchObject({ result: "fail", reason: "script_differs" });
    expect(await on({ name: "lint" })).toMatchObject({ result: "fail", reason: "script_missing" });
    expect(await on({ name: "test" }, "apps/site/package.json")).toMatchObject({ result: "fail", reason: "script_missing" });
    expect(await on({ name: "hasOwnProperty" })).toMatchObject({ result: "fail", reason: "script_missing" });
    const evaluation = await on({ name: "test", definition: "vitest run --coverage" });
    expect(JSON.stringify(evaluation)).not.toContain("vitest");
  });

  it("direct_dependency reads npm and pnpm manifests: the four tables, the version, absence", async () => {
    const root = project({
      "package.json": JSON.stringify({
        dependencies: { react: "^19.0.0" }, devDependencies: { vitest: "4.1.10" }, peerDependencies: { next: "*" }, optionalDependencies: { fsevents: "2" },
      }),
    });
    const on = async (expected: { ecosystem: "npm" | "pnpm"; name: string; version?: string }) =>
      evaluateCheck(root, check({ kind: "direct_dependency", target: "package.json", expected }));
    expect(await on({ ecosystem: "npm", name: "react" })).toMatchObject({ result: "pass", reason: "dependency_declared", observed: "^19.0.0" });
    expect(await on({ ecosystem: "pnpm", name: "vitest", version: "4.1.10" })).toMatchObject({ result: "pass", reason: "dependency_declared" });
    expect(await on({ ecosystem: "npm", name: "next" })).toMatchObject({ result: "pass" });
    expect(await on({ ecosystem: "npm", name: "fsevents" })).toMatchObject({ result: "pass" });
    expect(await on({ ecosystem: "npm", name: "react", version: "^18.0.0" })).toMatchObject({ result: "fail", reason: "version_differs", observed: "^19.0.0" });
    expect(await on({ ecosystem: "npm", name: "left-pad" })).toMatchObject({ result: "fail", reason: "dependency_missing" });
    expect(await on({ ecosystem: "npm", name: "constructor" })).toMatchObject({ result: "fail", reason: "dependency_missing" });
  });

  it("direct_dependency reads Cargo.toml: strings, tables, workspace, dev, build and target tables", async () => {
    const root = project({
      "Cargo.toml": [
        "[package]", 'name = "x"', "",
        "[dependencies]", 'serde = "1.0"', 'tokio = { version = "1.40", features = ["full"] }', "anyhow = { workspace = true }", 'local = { path = "../local" }', "",
        "[dev-dependencies]", 'insta = "1"', "",
        "[build-dependencies]", 'cc = "1"', "",
        "[target.'cfg(unix)'.dependencies]", 'nix = "0.29"', "",
        "[workspace.dependencies]", 'shared = "2"',
      ].join("\n"),
    });
    const on = async (name: string, version?: string) =>
      evaluateCheck(root, check({ kind: "direct_dependency", target: "Cargo.toml", expected: { ecosystem: "cargo", name, version } }));
    expect(await on("serde", "1.0")).toMatchObject({ result: "pass", observed: "1.0" });
    expect(await on("tokio", "1.40")).toMatchObject({ result: "pass" });
    expect(await on("anyhow")).toMatchObject({ result: "pass", observed: "workspace" });
    expect(await on("local")).toMatchObject({ result: "pass" });
    expect(await on("local", "1")).toMatchObject({ result: "fail", reason: "version_differs", observed: "unversioned" });
    expect(await on("insta")).toMatchObject({ result: "pass" });
    expect(await on("cc")).toMatchObject({ result: "pass" });
    expect(await on("nix", "0.29")).toMatchObject({ result: "pass" });
    expect(await on("shared", "2")).toMatchObject({ result: "pass" });
    expect(await on("rand")).toMatchObject({ result: "fail", reason: "dependency_missing" });
  });

  it("direct_dependency reads requirements.txt and pyproject.toml with PEP 503 names", async () => {
    const root = project({
      "requirements.txt": [
        "# pinned", "-r base.txt", "Requests>=2.31.0  # http", "Django[argon2]==5.0 ; python_version > '3.9'", "zope.interface", "",
      ].join("\n"),
      "pyproject.toml": [
        "[project]", 'name = "x"', 'dependencies = ["httpx>=0.27", "pydantic"]', "",
        "[project.optional-dependencies]", 'dev = ["pytest>=8"]', "",
        "[dependency-groups]", 'lint = ["ruff==0.6.0", { include-group = "dev" }]',
      ].join("\n"),
    });
    const on = async (target: string, name: string, version?: string) =>
      evaluateCheck(root, check({ kind: "direct_dependency", target, expected: { ecosystem: "pip", name, version } }));
    expect(await on("requirements.txt", "requests", ">=2.31.0")).toMatchObject({ result: "pass", observed: ">=2.31.0" });
    expect(await on("requirements.txt", "django", "==5.0")).toMatchObject({ result: "pass" });
    expect(await on("requirements.txt", "Zope-Interface")).toMatchObject({ result: "pass" });
    expect(await on("requirements.txt", "requests", ">=2.32")).toMatchObject({ result: "fail", reason: "version_differs" });
    expect(await on("requirements.txt", "flask")).toMatchObject({ result: "fail", reason: "dependency_missing" });
    expect(await on("pyproject.toml", "httpx", ">=0.27")).toMatchObject({ result: "pass" });
    expect(await on("pyproject.toml", "pydantic")).toMatchObject({ result: "pass" });
    expect(await on("pyproject.toml", "pytest")).toMatchObject({ result: "pass" });
    expect(await on("pyproject.toml", "ruff", "==0.6.0")).toMatchObject({ result: "pass" });
    expect(await on("pyproject.toml", "numpy")).toMatchObject({ result: "fail", reason: "dependency_missing" });
  });

  it("direct_dependency reads go.mod: single requires, blocks, and never an indirect line", async () => {
    const root = project({
      "go.mod": [
        "module example.com/app", "", "go 1.22", "", "require github.com/one/alpha v1.2.3", "",
        "require (", "\tgithub.com/two/beta v0.4.0", "\tgithub.com/three/gamma v2.0.0 // indirect", ")",
      ].join("\n"),
    });
    const on = async (name: string, version?: string) =>
      evaluateCheck(root, check({ kind: "direct_dependency", target: "go.mod", expected: { ecosystem: "go", name, version } }));
    expect(await on("github.com/one/alpha", "v1.2.3")).toMatchObject({ result: "pass", observed: "v1.2.3" });
    expect(await on("github.com/two/beta")).toMatchObject({ result: "pass" });
    expect(await on("github.com/two/beta", "v0.5.0")).toMatchObject({ result: "fail", reason: "version_differs" });
    expect(await on("github.com/three/gamma")).toMatchObject({ result: "fail", reason: "dependency_missing" });
  });

  it("structured_key walks JSON, TOML and YAML by segments, with array indexes and values", async () => {
    const root = project({
      "a.json": JSON.stringify({ build: { targets: ["node", "browser"], strict: true }, name: "x" }),
      "b.toml": '[tool.panoma]\nport = 4173\nname = "catalog"\nsince = 2026-09-14\n[[tool.list]]\nid = 1\n',
      "c.yaml": "server:\n  port: 4173\n  hosts:\n    - localhost\n    - 127.0.0.1\nflags: {}\n",
    });
    const on = async (target: string, path: string[], value?: unknown) =>
      evaluateCheck(root, check({ kind: "structured_key", target, expected: value === undefined ? { path } : { path, value: value as never } }));
    expect(await on("a.json", ["build", "strict"])).toMatchObject({ result: "pass", reason: "key_present" });
    expect(await on("a.json", ["build", "strict"], true)).toMatchObject({ result: "pass", reason: "value_matches" });
    expect(await on("a.json", ["build", "strict"], false)).toMatchObject({ result: "fail", reason: "value_differs" });
    expect(await on("a.json", ["build", "targets", "1"], "browser")).toMatchObject({ result: "pass" });
    expect(await on("a.json", ["build", "targets"], ["node", "browser"])).toMatchObject({ result: "pass" });
    expect(await on("a.json", ["build", "targets", "2"])).toMatchObject({ result: "fail", reason: "key_missing" });
    expect(await on("a.json", ["build", "targets", "01"])).toMatchObject({ result: "fail", reason: "key_missing" });
    expect(await on("a.json", ["name", "first"])).toMatchObject({ result: "fail", reason: "key_missing" });
    expect(await on("a.json", ["__proto__"])).toMatchObject({ result: "fail", reason: "key_missing" });
    expect(await on("b.toml", ["tool", "panoma", "port"], 4173)).toMatchObject({ result: "pass" });
    expect(await on("b.toml", ["tool", "list", "0", "id"], 1)).toMatchObject({ result: "pass" });
    expect(await on("b.toml", ["tool", "panoma", "host"])).toMatchObject({ result: "fail", reason: "key_missing" });
    // A TOML date compares as the text it was written in, never as an empty object.
    expect(await on("b.toml", ["tool", "panoma", "since"], "2026-09-14")).toMatchObject({ result: "pass" });
    expect(await on("b.toml", ["tool", "panoma", "since"], {})).toMatchObject({ result: "fail", reason: "value_differs" });
    expect(await on("c.yaml", ["server", "hosts", "0"], "localhost")).toMatchObject({ result: "pass" });
    expect(await on("c.yaml", ["server", "port"], "4173")).toMatchObject({ result: "fail", reason: "value_differs" });
    expect(await on("c.yaml", ["flags"], {})).toMatchObject({ result: "pass" });
    const evaluation = await on("c.yaml", ["server", "port"], 1);
    expect(evaluation.inspected).toEqual([{ path: "c.yaml", hash: sha256Hex("server:\n  port: 4173\n  hosts:\n    - localhost\n    - 127.0.0.1\nflags: {}\n"), state: "read" }]);
    expect(evaluation.observed).toBeUndefined();
  });

  it("a content check on a missing file is unknown with reason missing, not fail (absence has one owner)", async () => {
    const root = project({});
    const kinds: Check[] = [
      check({ kind: "file_hash", target: "gone.txt", expected: HASH }),
      check({ kind: "text_present", target: "gone.txt", expected: "x" }),
      check({ kind: "text_absent", target: "gone.txt", expected: "x" }),
      check({ kind: "manifest_script", target: "package.json", expected: { name: "x" } }),
      check({ kind: "direct_dependency", target: "go.mod", expected: { ecosystem: "go", name: "x" } }),
      check({ kind: "structured_key", target: "a.json", expected: { path: ["a"] } }),
    ];
    for (const one of kinds) {
      expect(await evaluateCheck(root, one)).toEqual({ result: "unknown", reason: "missing", inspected: [{ path: one.target, state: "missing" }] });
    }
  });
});

describe("C02/T46 — what cannot be read is unknown with the reason and the coverage, never fail", () => {
  function expectUnknown(evaluation: CheckEvaluation, reason: string, state: InspectedFile["state"], path: string): void {
    expect(evaluation.result).toBe("unknown");
    expect(evaluation.reason).toBe(reason);
    expect(evaluation.inspected).toHaveLength(1);
    expect(evaluation.inspected[0]).toMatchObject({ path, state });
  }

  it.skipIf(noPrivileges)("an unreadable file (mode 000)", async () => {
    const root = project({ "sealed.txt": "secret" });
    chmodSync(join(root, "sealed.txt"), 0o000);
    try {
      expectUnknown(await evaluateCheck(root, check({ kind: "text_present", target: "sealed.txt", expected: "secret" })), "unreadable", "unreadable", "sealed.txt");
      expectUnknown(await evaluateCheck(root, check({ kind: "file_hash", target: "sealed.txt", expected: HASH })), "unreadable", "unreadable", "sealed.txt");
      // Existence needs no read: it still answers.
      expect(await evaluateCheck(root, check({ kind: "path_exists", target: "sealed.txt", expected: true }))).toMatchObject({ result: "pass" });
    } finally {
      chmodSync(join(root, "sealed.txt"), 0o600);
    }
  });

  it("a folder where a file's content was expected", async () => {
    const root = project({ "docs/x.md": "", "config.json/inner.json": "{}" });
    expectUnknown(await evaluateCheck(root, check({ kind: "text_absent", target: "docs", expected: "x" })), "unreadable", "unreadable", "docs");
    expectUnknown(await evaluateCheck(root, check({ kind: "structured_key", target: "config.json", expected: { path: ["a"] } })), "unreadable", "unreadable", "config.json");
  });

  it.skipIf(process.platform === "win32")("a symlink that leaves the root, whatever it points at", async () => {
    const outside = join(scratch, "outside-secret.json");
    writeFileSync(outside, JSON.stringify({ scripts: { test: "x" }, key: 1 }));
    const root = project({ "inside.txt": "x" });
    symlinkSync(outside, join(root, "link.json"));
    symlinkSync(dirname(outside), join(root, "linkdir"));
    for (const one of [
      check({ kind: "text_present", target: "link.json", expected: "x" }),
      check({ kind: "file_hash", target: "link.json", expected: HASH }),
      check({ kind: "manifest_script", target: "link.json", expected: { name: "test" } }),
      check({ kind: "structured_key", target: "link.json", expected: { path: ["key"] } }),
      check({ kind: "path_exists", target: "link.json", expected: true }),
      check({ kind: "path_exists", target: "linkdir/outside-secret.json", expected: true }),
    ]) {
      expectUnknown(await evaluateCheck(root, one), "outside_root", "outside", one.target);
    }
    // A symlink that stays inside is followed like any file.
    symlinkSync(join(root, "inside.txt"), join(root, "alias.txt"));
    expect(await evaluateCheck(root, check({ kind: "text_present", target: "alias.txt", expected: "x" }))).toMatchObject({ result: "pass" });
  });

  it("a file over the byte cap, with the default MiB and with a lowered limit", async () => {
    const root = project({ "big.txt": Buffer.alloc(CHECK_LIMITS.fileBytes + 1, 0x61), "exact.txt": Buffer.alloc(CHECK_LIMITS.fileBytes, 0x61), "small.txt": "hello" });
    expectUnknown(await evaluateCheck(root, check({ kind: "text_present", target: "big.txt", expected: "a" })), "limit_reached", "too_large", "big.txt");
    expect(await evaluateCheck(root, check({ kind: "text_present", target: "exact.txt", expected: "a" }))).toMatchObject({ result: "pass" });
    expectUnknown(await evaluateCheck(root, check({ kind: "file_hash", target: "small.txt", expected: HASH }), { fileBytes: 4 }), "limit_reached", "too_large", "small.txt");
    expect(await evaluateCheck(root, check({ kind: "path_exists", target: "big.txt", expected: true }))).toMatchObject({ result: "pass" });
  });

  it("a malformed JSON, TOML or YAML document, and a package.json that is not JSON", async () => {
    const root = project({
      "a.json": "{ not json",
      "b.toml": "[broken\nx = ",
      "c.yaml": "a: [1, 2\nb: : :",
      "d.yaml": "--- 1\n--- 2\n",
      "package.json": "{",
      "Cargo.toml": "[[[",
      "pyproject.toml": "= = =",
    });
    const hashOf = (text: string) => sha256Hex(text);
    const a = await evaluateCheck(root, check({ kind: "structured_key", target: "a.json", expected: { path: ["x"] } }));
    expect(a).toEqual({ result: "unknown", reason: "malformed", inspected: [{ path: "a.json", hash: hashOf("{ not json"), state: "malformed" }] });
    expectUnknown(await evaluateCheck(root, check({ kind: "structured_key", target: "b.toml", expected: { path: ["x"] } })), "malformed", "malformed", "b.toml");
    expectUnknown(await evaluateCheck(root, check({ kind: "structured_key", target: "c.yaml", expected: { path: ["x"] } })), "malformed", "malformed", "c.yaml");
    expectUnknown(await evaluateCheck(root, check({ kind: "structured_key", target: "d.yaml", expected: { path: ["x"] } })), "malformed", "malformed", "d.yaml");
    expectUnknown(await evaluateCheck(root, check({ kind: "manifest_script", target: "package.json", expected: { name: "x" } })), "malformed", "malformed", "package.json");
    expectUnknown(await evaluateCheck(root, check({ kind: "direct_dependency", target: "package.json", expected: { ecosystem: "npm", name: "x" } })), "malformed", "malformed", "package.json");
    expectUnknown(await evaluateCheck(root, check({ kind: "direct_dependency", target: "Cargo.toml", expected: { ecosystem: "cargo", name: "x" } })), "malformed", "malformed", "Cargo.toml");
    expectUnknown(await evaluateCheck(root, check({ kind: "direct_dependency", target: "pyproject.toml", expected: { ecosystem: "pip", name: "x" } })), "malformed", "malformed", "pyproject.toml");
    // The same bytes read as text are readable: the literal kinds do not parse.
    expect(await evaluateCheck(root, check({ kind: "text_present", target: "a.json", expected: "not json" }))).toMatchObject({ result: "pass" });
  });

  it("a document wider or deeper than the walker accepts is limit_reached, not key_missing", async () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < CHECK_LIMITS.documentKeys + 1; i += 1) wide[`k${i}`] = i;
    let deep: unknown = "leaf";
    for (let i = 0; i < CHECK_LIMITS.documentDepth + 2; i += 1) deep = { d: deep };
    const root = project({
      "wide.json": JSON.stringify({ ...wide }),
      "narrow.json": JSON.stringify({ outer: wide, k0: 0 }),
      "deep.json": JSON.stringify({ top: deep }),
      "nested.yaml": "a:\n  b:\n    c:\n      d: 1\n",
    });
    // Thirty-three keys at the root: the walk through it stops.
    expectUnknown(await evaluateCheck(root, check({ kind: "structured_key", target: "wide.json", expected: { path: ["k0"] } })), "limit_reached", "read", "wide.json");
    // The wide table is not on the path: the walk never counts it.
    expect(await evaluateCheck(root, check({ kind: "structured_key", target: "narrow.json", expected: { path: ["k0"], value: 0 } }))).toMatchObject({ result: "pass" });
    expectUnknown(await evaluateCheck(root, check({ kind: "structured_key", target: "narrow.json", expected: { path: ["outer", "k1"] } })), "limit_reached", "read", "narrow.json");
    // Presence of a key whose value is bottomless is still a presence; comparing the value is not.
    expect(await evaluateCheck(root, check({ kind: "structured_key", target: "deep.json", expected: { path: ["top"] } }))).toMatchObject({ result: "pass", reason: "key_present" });
    expectUnknown(await evaluateCheck(root, check({ kind: "structured_key", target: "deep.json", expected: { path: ["top"], value: { d: "x" } } })), "limit_reached", "read", "deep.json");
    // A lowered depth limit stops a walk that the default would allow.
    expectUnknown(await evaluateCheck(root, check({ kind: "structured_key", target: "nested.yaml", expected: { path: ["a", "b", "c", "d"] } }), { documentDepth: 3 }), "limit_reached", "read", "nested.yaml");
    expect(await evaluateCheck(root, check({ kind: "structured_key", target: "nested.yaml", expected: { path: ["a", "b", "c", "d"], value: 1 } }), { documentDepth: 5 })).toMatchObject({ result: "pass" });
  });

  it("a root that is not on this disk is unknown with nothing inspected", async () => {
    const evaluation = await evaluateCheck(join(scratch, "nowhere"), check({ kind: "path_exists", target: "x", expected: true }));
    expect(evaluation).toEqual({ result: "unknown", reason: "unreadable", inspected: [] });
  });
});

describe("readEnvironment — C03/T48 two dirty worktrees at one HEAD are two environments", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";

  function repo(files: Record<string, string>, git: Record<string, string>): string {
    const root = project(files);
    for (const [path, content] of Object.entries(git)) {
      mkdirSync(dirname(join(root, ".git", path)), { recursive: true });
      writeFileSync(join(root, ".git", path), content);
    }
    return root;
  }

  it("reads HEAD from a detached HEAD, a ref file and packed-refs, and nothing without a repository", async () => {
    expect(await readGitHead(repo({}, { HEAD: `${SHA}\n` }))).toBe(SHA);
    expect(await readGitHead(repo({}, { HEAD: "ref: refs/heads/main\n", "refs/heads/main": `${SHA}\n` }))).toBe(SHA);
    expect(await readGitHead(repo({}, {
      HEAD: "ref: refs/heads/main\n",
      "packed-refs": `# pack-refs with: peeled fully-peeled sorted\n${"f".repeat(40)} refs/heads/other\n${SHA} refs/heads/main\n^${"e".repeat(40)}\n`,
    }))).toBe(SHA);
    // Unborn branch: no commit to name.
    expect(await readGitHead(repo({}, { HEAD: "ref: refs/heads/main\n" }))).toBeUndefined();
    expect(await readGitHead(repo({}, { HEAD: "ref: ../../etc/passwd\n" }))).toBeUndefined();
    expect(await readGitHead(project({ "README.md": "" }))).toBeUndefined();
    expect(await readGitHead(project({ ".git": "not a pointer" }))).toBeUndefined();
  });

  it("follows a linked worktree's gitdir pointer and its common dir", async () => {
    const main = repo({}, { HEAD: "ref: refs/heads/main\n", "refs/heads/main": `${SHA}\n`, "refs/heads/feature": `${"b".repeat(40)}\n` });
    mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
    writeFileSync(join(main, ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/feature\n");
    writeFileSync(join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
    const linked = project({});
    writeFileSync(join(linked, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
    expect(await readGitHead(linked)).toBe("b".repeat(40));
    expect(await readGitHead(main)).toBe(SHA);
  });

  it("two worktrees at one HEAD with different dirty files get different ids; the same files, the same id", async () => {
    const git = { HEAD: "ref: refs/heads/main\n", "refs/heads/main": `${SHA}\n` };
    const clean = repo({ "package.json": '{"name":"x"}', "src/a.ts": "export const a = 1;\n" }, git);
    const dirty = repo({ "package.json": '{"name":"x"}', "src/a.ts": "export const a = 2;\n" }, git);
    const look = async (root: string) => {
      const one = await evaluateCheck(root, check({ kind: "text_present", target: "src/a.ts", expected: "export" }));
      const two = await evaluateCheck(root, check({ kind: "structured_key", target: "package.json", expected: { path: ["name"] } }));
      return readEnvironment(root, [...one.inspected, ...two.inspected], { projectRef: "proj_x", now: new Date("2026-09-14T10:00:00Z") });
    };
    const first = await look(clean);
    const second = await look(dirty);
    expect(first.head).toBe(SHA);
    expect(second.head).toBe(SHA);
    expect(first.environmentId).not.toBe(second.environmentId);
    expect(first.dirtyFingerprint).not.toBe(second.dirtyFingerprint);
    expect(first).toMatchObject({ schemaVersion: 1, projectRef: "proj_x", resolvedRoot: clean, observedAt: "2026-09-14T10:00:00.000Z" });
    expect(first.inspected.map((file) => file.path)).toEqual(["src/a.ts", "package.json"]);
    expect(first.environmentId).toBe(environmentIdOf({ resolvedRoot: clean, head: SHA, dirtyFingerprint: first.dirtyFingerprint }));
    expect(first.environmentId).toBe(sha256Hex(`${clean}\n${SHA}\n${first.dirtyFingerprint}`));
    // The same look at the same worktree is the same environment; a different root is not.
    expect((await look(clean)).environmentId).toBe(first.environmentId);
    const twin = repo({ "package.json": '{"name":"x"}', "src/a.ts": "export const a = 1;\n" }, git);
    const third = await look(twin);
    expect(third.dirtyFingerprint).toBe(first.dirtyFingerprint);
    expect(third.environmentId).not.toBe(first.environmentId);
  });

  it("the fingerprint is the sorted, unique path\\thash lines; a state stands in when no bytes were read", () => {
    const a: InspectedFile = { path: "b.txt", hash: "2".repeat(64), state: "read" };
    const b: InspectedFile = { path: "a.txt", hash: "1".repeat(64), state: "read" };
    expect(inspectedFingerprint([a, b])).toBe(inspectedFingerprint([b, a, a]));
    expect(inspectedFingerprint([a, b])).toBe(sha256Hex(`a.txt\t${"1".repeat(64)}\nb.txt\t${"2".repeat(64)}`));
    expect(inspectedFingerprint([{ path: "x", state: "missing" }])).toBe(sha256Hex("x\tmissing"));
    expect(inspectedFingerprint([{ path: "x", state: "missing" }])).not.toBe(inspectedFingerprint([{ path: "x", state: "read" }]));
    expect(inspectedFingerprint([])).toBe(sha256Hex(""));
  });

  it("without a repository the id still binds the root and the files; a root off the disk resolves lexically", async () => {
    const root = project({ "a.txt": "1" });
    const environment = await readEnvironment(root, [{ path: "a.txt", hash: "1".repeat(64), state: "read" }]);
    expect(environment.head).toBeUndefined();
    expect(environment.projectRef).toBe(root);
    expect(environment.environmentId).toBe(sha256Hex(`${root}\n\n${environment.dirtyFingerprint}`));
    const gone = await readEnvironment(join(scratch, "vanished"), []);
    expect(gone.resolvedRoot).toBe(join(scratch, "vanished"));
    expect(gone.head).toBeUndefined();
  });
});

