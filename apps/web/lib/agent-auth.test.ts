import { describe, expect, it } from "vitest";
import { isLocalServer } from "./agent-auth";

/**
 * What counts as 'this server is local'.
 *
 * Three doors hang from this function —issuing an agent key, withdrawing it, and connecting an
 * agent by writing its `.mcp.json` —, and until 25-Aug-2026 it did not know `0.0.0.0`. With
 * `panoma up --network`, the server ties itself exactly to that, so all three responded 403 to the
 * owner sitting at their computer, telling them 'only from the local machine.' Withdrawing a
 * key is exactly what is urgent in the only mode where it is urgent.
 *
 * The same arrangement was already in `lib/guard.ts` and in `packages/core/src/access.ts`; it did
 * not reach this file, and there were no tests that noticed it.
 */
const ask = (url: string) => new Request(url, { method: "POST" });

describe("isLocalServer", () => {
  it("reconoce los cuatro nombres con los que este servidor se ata a sí mismo", () => {
    for (const url of [
      "http://localhost:4173/api/agent/keys",
      "http://127.0.0.1:4173/api/agent/keys",
      "http://[::1]:4173/api/agent/keys",
      "http://0.0.0.0:4173/api/agent/keys",
    ]) {
      expect(isLocalServer(ask(url)), `${url} no se reconoció como local`).toBe(true);
    }
  });

  it("no reconoce un despliegue de verdad", () => {
    /*
      The question it answers is 'am I deployed on the internet?', not 'who is calling me?'. The
      latter is handled by `sameOrigin`. The day Panoma is deployed, issuing keys without
      authentication stops being acceptable, and these three doors have to go through the user
      session — which is what this line prepares.
     */
    expect(isLocalServer(ask("https://panoma.ai/api/agent/keys"))).toBe(false);
  });

  /*
    And what this function does NOT answer, written so that no one uses it again as if it did
    answer.
    Here there was one more assertion: that `http://192.168.1.239:4173/...` gave `false`, "that
    is, for the network one." It was false security. Next does not assemble `request.url` with the
    address of the caller but with its own, that of the socket to which it was bound, so that URL
    never occurs in production: with `panoma up --network` **all** requests arrive with `0.0.0.0`
    inside, wherever they come from.
    So under `--network` this function returns `true` to everyone. It is correct for what is being
    asked —the server is still local, not deployed— and completely useless as storage. While it
    was the only one of `/api/agent/keys` and `/api/agent/mcp`, the wifi neighbor with the network
    key issued agent credentials: 200 measured. Whomever calls it decides `localOperatorOnly`,
    which is what those routes carry now.
   */
  it("y NO dice quién llama: bajo --network todo llega como 0.0.0.0", () => {
    expect(isLocalServer(ask("http://0.0.0.0:4173/api/agent/keys"))).toBe(true);
  });
});
