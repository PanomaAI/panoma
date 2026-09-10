import { describe, expect, it } from "vitest";
import {
  describePlan,
  desktopPreference,
  linkCandidates,
  normalizePlan,
  planFromKeys,
  readPlan,
  resolvePlan,
  stepDisplayName,
  suggestPlan,
  MAX_STEPS,
  type Candidate,
} from "./open-all";

/**
 * The plan of "open everything" is what one click executes, so what is defended here is the
 * border: what a browser may put into it, what a stored plan means once the machine has changed,
 * and what the suggestion decides to open without anyone having read it.
 */

const TOOLS: Candidate[] = [
  { key: "editor:cursor", kind: "editor", name: "Cursor", icon: "cursor" },
  { key: "editor:code", kind: "editor", name: "VS Code", icon: "code" },
  { key: "desktop:claude-app", kind: "desktop", name: "Claude", icon: "claude-app" },
  { key: "agent:claude-cli", kind: "agent", name: "Claude Code", icon: "claude-cli" },
  { key: "terminal", kind: "terminal", name: "Terminal" },
  { key: "folder", kind: "folder", name: "Folder" },
];

const LINKS = linkCandidates({
  links: [
    { serviceId: "repository", service: "GitHub", label: "ana/shop", url: "https://github.com/ana/shop", kind: "deep" },
    { serviceId: "vercel", service: "Vercel", label: "shop", url: "https://vercel.com/dashboard", kind: "console" },
  ],
  distributions: [
    { kind: "npm", label: "npm: shop", url: "https://www.npmjs.com/package/shop", evidence: "package.json" },
    { kind: "web", label: "Web", evidence: "vercel.json" },
  ],
  accounts: [
    { label: "Dev server", url: "http://localhost:3000" },
    { label: "Stripe", url: "https://dashboard.stripe.com" },
    { label: "Domain", email: "x@y.z" } as { label: string; url?: string },
  ],
  gitRemoteUrl: "git@github.com:ana/shop.git",
});

const ALL = [...LINKS, ...TOOLS];

describe("desktop destinations and installed-app actions", () => {
  it("accepts app action segments and rejects the retired desktop prefix", () => {
    expect(normalizePlan({ steps: [{ key: "app:panoma-video:create-video" }] }).ok).toBe(true);
    expect(normalizePlan({ steps: [{ key: ["app", "claude-app"].join(":") }] }).ok).toBe(false);
  });
  it("never suggests an installed-app action", () => {
    const action: Candidate = { key: "app:panoma-video:create-video", kind: "app", name: "Create video" };
    expect(suggestPlan([action], action.key).steps).toEqual([]);
  });
  it("migrates browser destinations and keeps app actions intact", () => {
    expect(desktopPreference(["app", "claude-app"].join(":"))).toBe("desktop:claude-app");
    expect(desktopPreference("app:panoma-video:create-video")).toBe("app:panoma-video:create-video");
  });
});

describe("what the browser may put into a plan", () => {
  it("keeps keys and drops nothing in silence: a bad row is refused with its position", () => {
    const result = normalizePlan({
      steps: [{ key: "editor:cursor" }, { key: "link:service:repository" }, { key: "nope" }],
    });
    expect(result).toEqual({ ok: false, problem: "badKey", at: 2 });
  });

  it("an address has to pass the rule that will open it, not only the one that reads it", () => {
    /*
      Two validators for one address was one too many: a space inside the path is understood by the
      accounts rule and refused by the opener, so the plan saved without complaint and the step
      failed on every single click.
     */
    expect(normalizePlan({ steps: [{ key: "link:custom", url: "https://wiki.corp/my page" }] })).toEqual({
      ok: false,
      problem: "badUrl",
      at: 0,
    });
    expect(
      normalizePlan({ steps: [{ key: "link:custom", url: "https://user:tok@gitlab.com/g/p" }] }),
    ).toEqual({ ok: false, problem: "badUrl", at: 0 });
  });

  it("a control character never reaches the script", () => {
    /*
      What is removed is the character, not the printable tail of the sequence it opened: a NUL
      makes bash skip the line it is on and an ESC is written to the terminal by the script's own
      echo, and neither can survive into a stored command. `[2J` on its own is just text.
     */
    const result = normalizePlan({ steps: [{ key: "terminal", command: "echo\u0000 hi \u001b[2J" }] });
    const command = result.ok ? result.plan.steps[0]!.command! : "";
    // eslint-disable-next-line no-control-regex
    expect(command).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(command).toBe("echo  hi  [2J");
  });

  it("the name a step was saved with travels, bounded like a label", () => {
    const result = normalizePlan({
      steps: [{ key: "agent:claude-cli", name: `  Claude Code${" ".repeat(4)}` }],
    });
    expect(result.ok && result.plan.steps[0]).toEqual({ key: "agent:claude-cli", name: "Claude Code" });
  });

  it("a command only travels with a terminal", () => {
    expect(normalizePlan({ steps: [{ key: "editor:cursor", command: "rm -rf ~" }] })).toEqual({
      ok: false,
      problem: "commandWhere",
      at: 0,
    });
    const good = normalizePlan({ steps: [{ key: "terminal", command: "  pnpm run dev \n" }] });
    expect(good.ok && good.plan.steps[0]).toEqual({ key: "terminal", command: "pnpm run dev" });
  });

  it("a custom link needs an address the accounts editor would accept, and nothing else may carry one", () => {
    expect(normalizePlan({ steps: [{ key: "link:custom", url: "javascript:alert(1)" }] })).toEqual({
      ok: false,
      problem: "badUrl",
      at: 0,
    });
    expect(normalizePlan({ steps: [{ key: "terminal", url: "https://x.y" }] })).toEqual({
      ok: false,
      problem: "urlWhere",
      at: 0,
    });
    const good = normalizePlan({
      steps: [{ key: "link:custom", url: "localhost:3000", label: " Dev " }],
    });
    expect(good.ok && good.plan.steps[0]).toEqual({
      key: "link:custom",
      url: "http://localhost:3000",
      label: "Dev",
    });
  });

  it("the same catalog key twice is once; two terminals with two commands are two", () => {
    const result = normalizePlan({
      steps: [
        { key: "editor:cursor" },
        { key: "editor:cursor" },
        { key: "terminal", command: "pnpm dev" },
        { key: "terminal", command: "pnpm test --watch" },
        { key: "terminal", command: "pnpm dev" },
      ],
    });
    expect(result.ok && result.plan.steps.map((s) => s.command ?? s.key)).toEqual([
      "editor:cursor",
      "pnpm dev",
      "pnpm test --watch",
    ]);
  });

  it("refuses an empty plan, a non-plan and too many steps", () => {
    expect(normalizePlan({ steps: [] })).toEqual({ ok: false, problem: "empty" });
    expect(normalizePlan("editor:cursor")).toEqual({ ok: false, problem: "notAPlan" });
    expect(normalizePlan(null)).toEqual({ ok: false, problem: "notAPlan" });
    const many = Array.from({ length: MAX_STEPS + 1 }, (_, i) => ({ key: `link:account:${i}` }));
    expect(normalizePlan({ steps: many })).toEqual({ ok: false, problem: "tooManySteps" });
  });

  it("what was stored reads back as a plan, and anything else as no plan", () => {
    expect(readPlan({ version: 1, steps: [{ key: "folder" }] })).toEqual({
      version: 1,
      steps: [{ key: "folder" }],
    });
    expect(readPlan({ version: 9, steps: "x" })).toBeNull();
    expect(readPlan(undefined)).toBeNull();
  });
});

describe("the link candidates of a project", () => {
  it("leave out anything the run would refuse, credentials included", () => {
    /*
      A clone made with a token carries it in the remote, and `openLink` refuses credentials: the
      candidate would be a row that can only fail, with the token travelling in the answer. The
      link is offered without the credentials instead of not at all.
     */
    const withToken = linkCandidates({
      links: [],
      distributions: [],
      accounts: [{ label: "Wiki", url: "https://wiki.corp/my page" }],
      gitRemoteUrl: "https://oauth2:SECRET@gitlab.com/g/p.git",
    });
    expect(withToken.map((c) => c.url)).toEqual(["https://gitlab.com/g/p"]);
    expect(JSON.stringify(withToken)).not.toContain("SECRET");
  });

  it("come from four sources, deep links and accounts suggested, the rest offered", () => {
    expect(LINKS.map((c) => [c.key, c.suggested])).toEqual([
      ["link:service:repository", true],
      ["link:service:vercel", false],
      ["link:account:Dev server", true],
      ["link:account:Stripe", true],
      ["link:distribution:npm:npm: shop", false],
    ]);
    // An account without an address is a note, not a link; a distribution without one is a place.
    expect(LINKS.find((c) => c.key === "link:account:Domain")).toBeUndefined();
    expect(LINKS.find((c) => c.key.startsWith("link:distribution:web"))).toBeUndefined();
  });

  it("an https remote no resolver recognized becomes a link; an ssh one does not", () => {
    const gitea = linkCandidates({
      links: [],
      distributions: [],
      accounts: [],
      gitRemoteUrl: "https://git.example.com/ana/shop.git",
    });
    expect(gitea).toHaveLength(1);
    expect(gitea[0]).toMatchObject({
      key: "link:remote",
      name: "git.example.com",
      detail: "ana/shop",
      url: "https://git.example.com/ana/shop",
      suggested: true,
    });
    expect(LINKS.find((c) => c.key === "link:remote"), "the resolver already made GitHub").toBeUndefined();
  });

  it("the same address from two sources is one candidate, the first", () => {
    const twice = linkCandidates({
      links: [
        { serviceId: "repository", service: "GitHub", label: "a/b", url: "https://github.com/a/b", kind: "deep" },
      ],
      distributions: [],
      accounts: [{ label: "Repo", url: "https://GitHub.com/a/b/" }],
    });
    expect(twice.map((c) => c.key)).toEqual(["link:service:repository"]);
  });
});

describe("the suggestion, for a project with no plan", () => {
  it("opens the suggested links, then the terminal, then the editor last so it lands on top", () => {
    expect(suggestPlan(ALL).steps.map((s) => s.key)).toEqual([
      "link:service:repository",
      "link:account:Dev server",
      "link:account:Stripe",
      "terminal",
      "editor:cursor",
    ]);
  });

  it("follows the split button's preference when it is installed here", () => {
    expect(suggestPlan(ALL, "agent:claude-cli").steps.map((s) => s.key)).toContain("agent:claude-cli");
    expect(suggestPlan(ALL, "agent:claude-cli").steps.map((s) => s.key)).not.toContain("editor:cursor");
    // A preference for something not installed falls back to the first editor.
    expect(suggestPlan(ALL, "editor:zed").steps.at(-1)).toEqual({ key: "editor:cursor" });
  });

  it("never suggests a command, a console link or a distribution page", () => {
    const plan = suggestPlan(ALL);
    expect(plan.steps.every((s) => s.command === undefined)).toBe(true);
    expect(plan.steps.map((s) => s.key)).not.toContain("link:service:vercel");
    expect(plan.steps.map((s) => s.key)).not.toContain("link:distribution:npm:npm: shop");
  });

  it("with nothing installed and nothing detected, suggests nothing rather than something invented", () => {
    expect(suggestPlan([]).steps).toEqual([]);
  });
});

describe("a stored plan against what exists today", () => {
  it("reports what is gone with its whole step, and keeps the rest in order", () => {
    const plan = readPlan({
      steps: [{ key: "editor:zed" }, { key: "link:service:repository" }, { key: "terminal", command: "pnpm dev" }],
    })!;
    const { steps, missing } = resolvePlan(plan, ALL);
    expect(missing).toEqual([{ key: "editor:zed" }]);
    expect(steps.map((s) => s.step.key)).toEqual(["link:service:repository", "terminal"]);
    expect(steps[1]!.step.command).toBe("pnpm dev");
  });

  it("a custom link resolves on its own, with its address", () => {
    const plan = readPlan({ steps: [{ key: "link:custom", url: "https://docs.example.com" }] })!;
    const { steps, missing } = resolvePlan(plan, ALL);
    expect(missing).toEqual([]);
    expect(steps[0]).toEqual({ step: { key: "link:custom", url: "https://docs.example.com" } });
  });

  it("describes what would open, with the command next to the terminal", () => {
    const plan = readPlan({
      steps: [
        { key: "link:account:Dev server" },
        { key: "terminal", command: "pnpm dev" },
        { key: "link:custom", label: "Docs", url: "https://docs.example.com" },
        { key: "link:custom", url: "https://notion.so/x" },
        { key: "editor:cursor" },
      ],
    })!;
    expect(describePlan(plan, ALL)).toEqual([
      "Dev server",
      "Terminal · pnpm dev",
      "Docs",
      "notion.so",
      "Cursor",
    ]);
  });

  it("names a step whose candidate is gone, without splitting its key by hand", () => {
    const labels = { terminal: "Terminal", folder: "Folder", "link:remote": "git remote" };
    const name = (step: { key: string; name?: string; label?: string; url?: string }) =>
      stepDisplayName(step, undefined, labels);

    /* The name stored the day it was saved wins: a key cannot name an agent. */
    expect(name({ key: "agent:claude-cli", name: "Claude Code" })).toBe("Claude Code");
    /* And without it, the tables and the key's own shape — a label with a colon inside included. */
    expect(name({ key: "editor:cursor" })).toBe("Cursor");
    expect(name({ key: "desktop:claude-app" })).toBe("Claude");
    expect(name({ key: "link:distribution:npm:npm: shop" })).toBe("npm: shop");
    expect(name({ key: "link:account:Dev server" })).toBe("Dev server");
    expect(name({ key: "link:remote" })).toBe("git remote");
    expect(name({ key: "terminal" })).toBe("Terminal");
    expect(name({ key: "link:custom", url: "https://notion.so/x" })).toBe("notion.so");
    /* The candidate of today always wins over what was written down yesterday. */
    expect(stepDisplayName({ key: "editor:cursor", name: "old" }, TOOLS[0], labels)).toBe("Cursor");
  });

  it("a plan from bare keys admits only what the server offered, once each", () => {
    const plan = planFromKeys(
      ["editor:cursor", "link:custom", "terminal", "editor:cursor", "link:service:nope"],
      ALL,
    );
    expect(plan.steps).toEqual([{ key: "editor:cursor" }, { key: "terminal" }]);
  });
});
