import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppCredentialError } from "@/lib/app-provider-credentials";

const mocks = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/app-provider-credentials", async original => ({
  ...await original<typeof import("@/lib/app-provider-credentials")>(),
  appCredentialStatus: mocks.status, saveAppCredential: mocks.save, deleteAppCredential: mocks.remove,
}));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { GET, POST, DELETE } = await import("./route");
const context = { params: Promise.resolve({ id: "panoma-video" }) };
const empty = { provider: "elevenlabs", configured: false, source: null };
const saved = { provider: "elevenlabs", configured: true, source: "file" };
const secret = "test-key-never-returned";

function request(method: string, value?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:4173/api/apps/panoma-video/credentials", {
    method, headers: { "Content-Type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: typeof value === "string" ? value : JSON.stringify(value ?? {}) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PANOMA_OPERATOR_KEY", "");
  mocks.status.mockResolvedValue(empty); mocks.save.mockResolvedValue(saved); mocks.remove.mockResolvedValue(empty);
});
afterEach(() => vi.unstubAllEnvs());

describe("the private Apps credential route", () => {
  it("returns only credential presence with no-store and saves or removes without a provider call", async () => {
    const responses = [
      await GET(request("GET"), context),
      await POST(request("POST", { provider: "elevenlabs", key: secret }), context),
      await DELETE(request("DELETE", { provider: "elevenlabs" }), context),
    ];
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(await responses[0]!.json()).toEqual(empty);
    expect(await responses[1]!.json()).toEqual(saved);
    expect(await responses[2]!.json()).toEqual(empty);
    expect(mocks.save).toHaveBeenCalledWith("panoma-video", { provider: "elevenlabs", key: secret });
    expect(mocks.remove).toHaveBeenCalledWith("panoma-video", { provider: "elevenlabs" });
  });

  for (const [method, handler] of [["GET", GET], ["POST", POST], ["DELETE", DELETE]] as const) {
    it(`${method} refuses foreign tabs, missing operator credentials and remote catalogs before reading input or config`, async () => {
      const cases = ["foreign", "operator", "remote"] as const;
      for (const reason of cases) {
        vi.stubEnv("PANOMA_OPERATOR_KEY", reason === "operator" ? "required-operator-key" : "");
        vi.stubEnv("DATABASE_URL", reason === "remote" ? "postgres://remote.example/catalog" : "");
        const incoming = request(method, { provider: "elevenlabs", key: secret },
          reason === "foreign" ? { Origin: "https://foreign.example", "Sec-Fetch-Site": "cross-site" } : {});
        const readBody = incoming.body ? vi.spyOn(incoming.body, "getReader") : undefined;
        expect((await handler(incoming, context)).status).toBe(403);
        expect(readBody?.mock.calls.length ?? 0).toBe(0);
        expect(mocks.status).not.toHaveBeenCalled();
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.remove).not.toHaveBeenCalled();
      }
    });
  }

  it("rejects malformed or oversized bodies without including their contents", async () => {
    for (const value of [`{"key":"${secret}"`, JSON.stringify({ provider: "elevenlabs", key: "k".repeat(70_000) }), "[]"]) {
      const response = await POST(request("POST", value), context);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid-credential-body" });
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("never sends underlying errors or a configuration's contents to the browser", async () => {
    mocks.save.mockRejectedValue(new Error(`Cannot save ${secret}`));
    const failure = await POST(request("POST", { provider: "elevenlabs", key: secret }), context);
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: "credential-request-failed" });
    mocks.status.mockRejectedValue(new AppCredentialError("credential-config-unreadable"));
    const broken = await GET(request("GET"), context);
    expect(broken.status).toBe(409);
    expect(await broken.json()).toEqual({ error: "credential-config-unreadable" });
  });
});
