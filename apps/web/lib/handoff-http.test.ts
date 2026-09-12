import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HANDOFF_FAULTS, HandoffFault, isHandoffFaultCode } from "@panoma/handoff/faults";
import { describe, expect, it } from "vitest";
import { HANDOFF_STATUS, handoffHttpError, isAppLink, projectFor, resumeLineOf } from "./handoff-http";

/** The first half of a resume line from another folder, as the running platform spells it: `cd` on POSIX, `Set-Location` on Windows. */
const enter = (folder: string) => (process.platform === "win32" ? `Set-Location -LiteralPath '${folder}'; ` : `cd '${folder}' && `);

/*
  The status of each handoff failure, written down, and the sweep that keeps every thrown code
  inside the vocabulary — the same two guards `apps-http.test.ts` keeps for the apps family.
 */
async function answered(error: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = handoffHttpError(error);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("what a failed handoff request answers", () => {
  it.each([
    ["invalid-id", 400],
    ["cwd-missing", 400],
    ["target-store-missing", 400],
    ["conversation-not-found", 404],
    ["store-missing", 404],
    ["ambiguous-id", 409],
    ["same-store", 409],
    ["too-large", 413],
    ["import-command-missing", 501],
    ["unsupported-target", 501],
    ["write-failed", 500],
    ["import-command-failed", 500],
    ["unreadable-transcript", 500],
    ["no-space-left", 500],
  ] as const)("%s answers %i", async (code, status) => {
    expect((await answered(new HandoffFault(code))).status).toBe(status);
  });

  it("every status in the table belongs to a code that exists", () => {
    for (const code of Object.keys(HANDOFF_STATUS)) expect(isHandoffFaultCode(code), code).toBe(true);
    expect(HANDOFF_FAULTS.every((code) => HANDOFF_STATUS[code] === undefined || HANDOFF_STATUS[code]! >= 400)).toBe(true);
  });

  it("answers with the code, and the detail beside it", async () => {
    expect(await answered(new HandoffFault("ambiguous-id", "claude-cli:7b1e2c3d, codex-cli:7b1e2c3d"))).toEqual({
      status: 409,
      body: { error: "ambiguous-id", detail: "claude-cli:7b1e2c3d, codex-cli:7b1e2c3d" },
    });
    expect(await answered(new HandoffFault("same-store"))).toEqual({ status: 409, body: { error: "same-store" } });
  });

  it("adds the caller's hint for the codes it has one for, and the caller's headers to every answer", async () => {
    const options = { hints: { "same-store": "The person's doors do this." }, headers: { "Cache-Control": "private, no-store" } };
    const hinted = handoffHttpError(new HandoffFault("same-store", "codex-cli"), options);
    expect(hinted.status).toBe(409);
    expect(hinted.headers.get("cache-control")).toBe("private, no-store");
    expect(await hinted.json()).toEqual({ error: "same-store", detail: "codex-cli", hint: "The person's doors do this." });
    // A code without a hint answers as before; the headers still travel, on a 500 too.
    const plain = handoffHttpError(new HandoffFault("too-large", "99"), options);
    expect(await plain.json()).toEqual({ error: "too-large", detail: "99" });
    const unknown = handoffHttpError(new Error("nobody named this"), options);
    expect(unknown.status).toBe(500);
    expect(unknown.headers.get("cache-control")).toBe("private, no-store");
    expect(await unknown.json()).toEqual({ error: "handoff-failed", detail: "nobody named this" });
  });

  it("scrubs the machine's paths out of the detail", async () => {
    const { body } = await answered(new HandoffFault("cwd-missing", "/Users/someone/dev/lemonade"));
    expect(body.error).toBe("cwd-missing");
    expect(String(body.detail)).not.toContain("/Users/someone");
  });

  it("maps the disk's own refusals to their codes", async () => {
    const full = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    expect(await answered(full)).toMatchObject({ status: 500, body: { error: "no-space-left" } });
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    expect((await answered(denied)).body.error).toBe("permission-denied");
  });

  it("answers 500 with a generic word for what it does not recognise, keeping the message as detail", async () => {
    expect(await answered(new Error("something nobody named"))).toEqual({
      status: 500,
      body: { error: "handoff-failed", detail: "something nobody named" },
    });
    expect(await answered(undefined)).toEqual({ status: 500, body: { error: "handoff-failed" } });
  });
});

describe("which project a conversation belongs to", () => {
  const roots = [
    { id: "dev", slug: "dev", root: "/Users/ana/Dev" },
    { id: "shop", slug: "shop", root: "/Users/ana/Dev/shop" },
    { id: "blog", slug: "blog", root: "/Users/ana/blog" },
  ];

  it("picks the deepest root that contains the folder", () => {
    expect(projectFor("/Users/ana/Dev/shop/api", roots, "darwin")?.id).toBe("shop");
    expect(projectFor("/Users/ana/Dev/shop", roots, "darwin")?.id).toBe("shop");
    expect(projectFor("/Users/ana/Dev/other", roots, "darwin")?.id).toBe("dev");
    expect(projectFor("/Users/ana/blog", roots, "darwin")?.id).toBe("blog");
  });

  it("does not match a sibling that merely shares a prefix, nor an empty folder", () => {
    expect(projectFor("/Users/ana/Dev/shopping", roots, "darwin")?.id).toBe("dev");
    expect(projectFor("/Users/ana/blogs", roots, "darwin")).toBeUndefined();
    expect(projectFor("", roots, "darwin")).toBeUndefined();
  });
});

describe("the display line of a receipt", () => {
  it("is derived from the agent and the id, and refuses an id that does not fit the agent", () => {
    expect(resumeLineOf("codex-cli", "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5", "/x")).toBe(
      `${enter("/x")}codex resume 01a08fab-9c49-7bcd-9bf1-ffc0d78795a5`,
    );
    expect(resumeLineOf("codex-cli", "01a08fab; rm -rf ~", "/x")).toBeNull();
    expect(resumeLineOf("cursor-agent", "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5", "/x")).toBeNull();
    expect(resumeLineOf("nobody", "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5", "/x")).toBeNull();
  });

  it("is the deep link for the app surface on a Mac, and the agent's own command elsewhere", () => {
    const id = "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5";
    const app = resumeLineOf("codex-cli", id, "/x", "app");
    if (process.platform === "darwin") expect(app).toBe(`open 'codex://threads/${id}'`);
    else expect(app).toBe(`${enter("/x")}codex resume ${id}`);
    // An agent without an app keeps its command on either surface.
    expect(resumeLineOf("opencode", "ses_0123456789abcdefghij", "/x", "app")).toBe(`${enter("/x")}opencode -s ses_0123456789abcdefghij`);
    expect(resumeLineOf("codex-cli", "01a08fab; rm -rf ~", "/x", "app")).toBeNull();
  });
});

/*
  The two shapes `open` may receive from the launch, and nothing else: a stored line, a link
  with a query glued on, a third scheme, an id that is not a UUID. The engine builds the URL
  from a validated id; this is the check the route runs on the result before it is an argument.
 */
describe("what may reach `open`", () => {
  const id = "7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e";

  it("accepts exactly the two templates with a UUID", () => {
    expect(isAppLink(`claude://resume?session=${id}`)).toBe(true);
    expect(isAppLink(`codex://threads/${id}`)).toBe(true);
    expect(isAppLink(`codex://threads/${id.toUpperCase()}`)).toBe(true);
  });

  it.each([
    "rm -rf ~",
    "open 'claude://resume?session=7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e'",
    "claude://resume?session=7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e&q=hello",
    "claude://code/new?folder=/tmp",
    "codex://threads/7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e/extra",
    "codex://threads/ses_0123456789abcdefghij",
    "cursor://file/x",
    "https://example.com/7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e",
    "",
  ])("refuses %s", (url) => {
    expect(isAppLink(url)).toBe(false);
  });
});

/*
  Every code a route or a helper throws is one the vocabulary knows, so that the screen has a
  sentence for it (`handoff.fault.<code>` closes the set with `satisfies`). The sweep covers the
  five operator route files, the two doors of the agent channel (`agent/conversations`,
  `agent/handoff`) and every `lib/handoff-*.ts`, so a code invented anywhere along the way is
  caught by the same rule. Not every file throws — the cache and the digest do not — and that
  is fine; what is not fine is a file that throws a word nobody named.
 */
describe("every failure a person can be shown is in the vocabulary", () => {
  // A file path, not a URL's `pathname`: on Windows the latter is `/D:/…`, which `join` reads as `D:\D:\…`.
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(path);
    }
  };
  walk(join(ROOT, "app", "api", "handoff"));
  walk(join(ROOT, "app", "api", "agent", "conversations"));
  walk(join(ROOT, "app", "api", "agent", "handoff"));
  for (const name of readdirSync(join(ROOT, "lib"))) {
    if (name.startsWith("handoff-") && name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(join(ROOT, "lib", name));
  }
  /** The file's path under `ROOT`, spelled with `/` on every platform, so the names below read the same everywhere. */
  const under = (file: string) => relative(ROOT, file).split(sep).join("/");
  const swept = files.map(under);

  it("sweeps the routes and the helpers", () => {
    expect(swept).toContain("app/api/handoff/route.ts");
    expect(swept).toContain("app/api/agent/handoff/route.ts");
    expect(swept).toContain("app/api/agent/conversations/route.ts");
    expect(swept).toContain("lib/handoff-http.ts");
    expect(swept).toContain("lib/handoff-write.ts");
  });

  it.each(swept)("%s", (file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    const thrown = [...source.matchAll(/new HandoffFault\("([a-z0-9_-]+)"/g)].map((match) => match[1]!);
    for (const code of thrown) {
      expect(isHandoffFaultCode(code), `${file} throws "${code}", which no sentence covers`).toBe(true);
    }
  });

  it("finds the throw sites it exists for", () => {
    const thrown = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/new HandoffFault\("([a-z0-9_-]+)"/g)]);
    expect(thrown.length).toBeGreaterThan(3);
  });
});
