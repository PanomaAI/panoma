/**
 * Whether this machine's Node is new enough for an app, said as a sentence instead of a wall.
 *
 * Two halves, and only the second is authoritative.
 *
 * `nodeFloorFault` is the fast path: the floor an app declares, copied into `official.ts`,
 * checked before npm is spawned at all. It answers instantly and it can be out of date.
 *
 * `engineFault` reads what npm itself said. That is the half that cannot be wrong, and it is
 * needed because a refusal can come from somewhere no declared value here can see: a floor
 * declared by one of the app's own dependencies, or a floor on npm rather than on Node. Both
 * were measured — npm 11.19.0 refuses transitively, and refuses on an npm floor with Node
 * perfectly satisfied — so a `process.version` check alone would let a person hit the wall it
 * exists to prevent.
 *
 * Both halves emit the same codes, so the screen says one thing however the refusal arrived.
 */
import { AppFault, FAULT_PART, type AppFaultCode } from "./faults";
import { NODE_FLOOR } from "./official";

/** `>=22.18` and `v26.7.0` both become [22,18,0]. Only shapes we write or npm prints. */
function triple(value: string): [number, number, number] | undefined {
  const found = /^(?:v|>=|\^|~)?\s*(\d+)\.(\d+)(?:\.(\d+))?/.exec(value.trim());
  if (!found) return undefined;
  return [Number(found[1]), Number(found[2]), Number(found[3] ?? 0)];
}

/** Whether `running` is under `floor`. Unparseable on either side is never "under". */
function under(floor: string, running: string): boolean {
  const want = triple(floor);
  const have = triple(running);
  if (!want || !have) return false;
  return rank(have) < rank(want);
}

/** One comparable number per version. The minor and patch fields npm prints fit far below. */
function rank([major, minor, patch]: [number, number, number]): number {
  return major * 1_000_000 + minor * 1_000 + patch;
}

/**
 * The declared floor, checked against the Node running this catalog.
 *
 * Undefined means «nothing to say»: no floor is declared for that app, or this machine clears
 * it, or one of the two will not parse. Never a refusal on a doubt.
 */
export function nodeFloorFault(id: string, running: string = process.version): AppFault | undefined {
  const needed = NODE_FLOOR[id];
  if (!needed || !under(needed, running)) return undefined;
  return new AppFault("node-too-old", needed + FAULT_PART + running);
}

/**
 * What npm said, when what it said was that it will not run here.
 *
 * Measured against npm 11.19.0: the block is `Required: {json}` then `Actual: {json}`, it is
 * printed before any tarball is fetched — the whole failure was 460 bytes, so it cannot be
 * pushed out of the tail this reads — and it is byte-identical under a Spanish locale, because
 * npm ships no translation machinery at all.
 *
 * Both figures are decoration. A future npm that prints them differently loses the numbers and
 * keeps the sentence, which still names the right problem.
 */
export function engineFault(tail: string): AppFault | undefined {
  if (!/\bEBADENGINE\b/.test(tail)) return undefined;
  const need = engineRecord(/Required:\s*(\{.*?\})/.exec(tail)?.[1]);
  const have = engineRecord(/Actual:\s*(\{.*?\})/.exec(tail)?.[1]);
  for (const name of ["node", "npm"] as const) {
    const floor = need[name];
    const running = have[name];
    if (!floor || !running || !under(floor, running)) continue;
    const code: AppFaultCode = name === "node" ? "node-too-old" : "npm-too-old";
    return new AppFault(code, floor + FAULT_PART + running);
  }
  return new AppFault("engine-unsupported");
}

function engineRecord(source: string | undefined): Record<string, string> {
  if (!source) return {};
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}
