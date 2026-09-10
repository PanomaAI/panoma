import { expect, it } from "vitest";
import { engineFault, nodeFloorFault } from "./engines";
import { NODE_FLOOR, OFFICIAL } from "./official";

/*
  Captured from npm 11.19.0 on 10-Sep-2026, verbatim, by installing a package declaring
  `{"node":">=99.0.0"}` with the same flags `manager.ts` passes. Pasted rather than described,
  because the two regexes below are the only thing standing between this text and a person.

  Three properties were measured at the same time and the design leans on all three: the whole
  refusal is 460 bytes, so it can never be pushed out of the 64 KB tail `process.ts` keeps; it
  is printed before any tarball is fetched; and it is byte-identical under a Spanish locale,
  because npm ships no translation machinery at all.
 */
const NODE_TAIL = `npm error code EBADENGINE
npm error engine Unsupported engine
npm error engine Not compatible with your version of node/npm: engine-victim@1.0.0
npm error notsup Not compatible with your version of node/npm: engine-victim@1.0.0
npm error notsup Required: {"node":">=99.0.0"}
npm error notsup Actual:   {"node":"v26.7.0","npm":"11.19.0"}
npm error A complete log of this run can be found in: /Users/x/.npm/_logs/2026-09-10T18_34_53_585Z-debug-0.log`;

/* The wall a `process.version` check structurally cannot see: the floor is on npm, not on Node. */
const NPM_TAIL = NODE_TAIL
  .replace('Required: {"node":">=99.0.0"}', 'Required: {"node":">=22.18","npm":">=99.0.0"}');

it("says which engine is too old, and what this machine has", () => {
  const node = engineFault(NODE_TAIL);
  expect(node?.code).toBe("node-too-old");
  expect(node?.detail).toBe(">=99.0.0 | v26.7.0");

  const npm = engineFault(NPM_TAIL);
  expect(npm?.code).toBe("npm-too-old");
  expect(npm?.detail).toBe(">=99.0.0 | 11.19.0");
});

/*
  npm's output format is a version of npm, not a contract. When the figures will not parse the
  sentence still has to name the right problem, so both numbers are decoration and the fallback
  names neither engine rather than leaving a gap where one should be.
 */
it("keeps the sentence when the figures stop parsing", () => {
  expect(engineFault(NODE_TAIL.replace("Required:", "Requiere:"))?.code).toBe("engine-unsupported");
  expect(engineFault(NODE_TAIL.replace('{"node":">=99.0.0"}', "something else"))?.code).toBe("engine-unsupported");
  // A refusal that is satisfied on both engines is still a refusal, and still not ours to explain.
  expect(engineFault(NODE_TAIL.replace(">=99.0.0", ">=20.0.0"))?.code).toBe("engine-unsupported");
});

it("says nothing about an ordinary failure", () => {
  expect(engineFault("npm error code E404\nnpm error 404 Not Found")).toBeUndefined();
  expect(engineFault("")).toBeUndefined();
});

it("refuses under the declared floor and stays quiet above it", () => {
  expect(nodeFloorFault("panoma-video", "v22.17.9")?.code).toBe("node-too-old");
  expect(nodeFloorFault("panoma-video", "v22.17.9")?.detail).toBe(">=22.18 | v22.17.9");
  expect(nodeFloorFault("panoma-video", "v22.18.0")).toBeUndefined();
  expect(nodeFloorFault("panoma-video", "v23.0.0")).toBeUndefined();
  expect(nodeFloorFault("panoma-video", "v26.7.0")).toBeUndefined();
  // No floor declared, and a version neither side can read: never a refusal on a doubt.
  expect(nodeFloorFault("not-an-app", "v1.0.0")).toBeUndefined();
  expect(nodeFloorFault("panoma-video", "nonsense")).toBeUndefined();
});

/*
  The floor is copied from a package.json published out of another repository, so nothing here
  can notice the two disagreeing. What this can notice is a floor for an app that does not
  exist, or one written in a shape the reader cannot parse — which would make it silently inert.
 */
it("declares a floor only for an app that exists, in a shape it can read", () => {
  for (const [id, floor] of Object.entries(NODE_FLOOR)) {
    expect(OFFICIAL.some((app) => app.id === id), `${id} is not an official app`).toBe(true);
    expect(floor).toMatch(/^>=\d+\.\d+(\.\d+)?$/);
    expect(nodeFloorFault(id, "v0.0.1")?.code).toBe("node-too-old");
  }
});
