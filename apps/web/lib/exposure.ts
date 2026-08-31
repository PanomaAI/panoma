/**
 * Is this server listening outside of this machine?
 *
 * The caller is not trusted for the answer —it writes the `Host` header itself, and that
 * was exactly the door that had to be closed— but to **our own configuration**, which the one who
 * calls does not control.
 *
 * There are two paths that open the port and both must be recognized:
 *
 * 1. `panoma up --network`, which creates the access key and passes it through the environment.
 * That `PANOMA_ACCESS_KEY` exists means that someone requested to open it.
 * 2. By hand, with `PANOMA_HOST=0.0.0.0 pnpm dev`, which is what `docs/environment.md` documents
 * and what `apps/web/package.json` passes to `-H` in `dev` and in `start`. Here there may be no
 * key, and that is the dangerous case: without a key the entry door would be staring at the
 * `Host`, so a falsified `Host: localhost` would return the entire catalog. Measured on
 * 25-Aug-2026: `200` and `{"projects":[…]}`.
 *
 * `HOSTNAME` is not seen even if the packaged startup uses it, and that is on purpose: on Linux
 * and inside a container, that variable usually carries the machine's name, which doesn't indicate
 * anything about which interface anyone connected to. Taking it as a signal would give false
 * positives that would close the catalog to its owner. That path is covered by route 1, because
 * whoever starts that way is `panoma up` and with `--network` they always provide the key.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** `0.0.0.0` DOES NOT count as a house here: tying to the wildcard is just opening the port. */
export function isWideBind(bind: string): boolean {
  const name = bind.trim().replace(/:\d+$/, "").toLowerCase();
  if (!name) return false;
  return name === "0.0.0.0" || name === "::" || name === "[::]" || !LOOPBACK.has(name);
}

export function portIsOpen(): boolean {
  if ((process.env["PANOMA_ACCESS_KEY"] ?? "").trim()) return true;
  return isWideBind(process.env["PANOMA_HOST"] ?? "");
}
