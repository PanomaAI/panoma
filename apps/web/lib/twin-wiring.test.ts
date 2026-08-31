import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Twin wiring, checked.
 *
 * The failure that has repeated in all increments of this organ is not in the code: something is
 * built, tested, and **doesn't connect to anything**. The distiller that only existed in the
 * terminal. The `published_as` that was written, read, and crashed in the mapping. The critic who
 * drafted the order and could not deliver it. All three passed their tests, because a test of a
 * function doesn't know if anyone calls it.
 *
 * So here the other thing is tested: that each organ has someone to fire it, that `docs/twin.md`
 * counts it, and —half of which really alerts— that **what that file declares without wiring
 * remains unwired**. That last one is what catches silence in the right direction: the day someone
 * hooks the mechanical critic to the watcher, this fails and asks them to write it.
 *
 * It is the same lesson of `guard.test.ts` applied to something else: a doctrine that exists only
 * in a commentary is applied when someone remembers.
 */

const ROOT = new URL("../../../", import.meta.url);
const DOC = "docs/twin.md";

function read(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

/**
 * A Twin organ, with what is needed so that it doesn't hang loose.
 *
 * `wiredIn` are the files that **have** to call it. It is not the list of all those who can: it is
 * the list of those who, if they stop doing it, leave the organ without firing, which is the
 * failure that this pursues.
 */
interface Organ {
  /** What is it called in `docs/twin.md`. A literal search is wanted, so renaming forces touching both. */
  title: string;
  /** The call that does the job. */
  symbol: string;
  wiredIn: string[];
}

const ORGANS: Organ[] = [
  {
    title: "Inventory",
    symbol: "inventoryHistory",
    wiredIn: ["apps/web/app/api/twin/sources/route.ts", "apps/web/app/api/twin/mine/route.ts"],
  },
  {
    title: "Consent",
    symbol: "setConsent",
    wiredIn: ["apps/web/app/api/twin/sources/route.ts"],
  },
  {
    title: "Mining",
    symbol: "mineHistory",
    wiredIn: ["apps/web/app/api/twin/mine/route.ts"],
  },
  {
    title: "Distilling",
    symbol: "buildPrompt",
    wiredIn: ["apps/web/app/api/twin/distill/route.ts"],
  },
  {
    /* Chained by the synthesize button: if the route stops calling it, no one distributes. */
    title: "Sorting by topic",
    symbol: "buildClassifyPrompt",
    wiredIn: ["apps/web/app/api/twin/classify/route.ts"],
  },
  {
    title: "Synthesis",
    symbol: "planChanges",
    wiredIn: ["apps/web/app/api/twin/synthesize/route.ts"],
  },
  {
    /*
      The last rung of the pyramid: the portrait going down to the `.md` of each project. Its two
      shots are the gesture (`panoma md init/sync`) and the watcher in each commit.
     */
    title: "Handout to agents",
    symbol: "tasteDigest",
    wiredIn: ["apps/web/lib/md-sync.ts", "apps/cli/src/md-command.ts"],
  },
  {
    title: "Publishing",
    symbol: "publishable",
    wiredIn: ["apps/web/app/api/twin/taste/route.ts"],
  },
  {
    title: "Mechanical critic",
    symbol: "reviewIfStale",
    // The watcher is its automatic shot —the signal, and the straggler `backfillReviews` that
    // covers what has never been checked—; the other is `panoma review` at the terminal.
    wiredIn: ["apps/web/lib/watch.ts"],
  },
  {
    title: "Critic with eyes",
    symbol: "runLook",
    // The two that spend: the one that a person asks for and the one that triggers a file upon
    // appearing.
    wiredIn: ["apps/web/app/api/twin/look/route.ts", "apps/web/lib/auto-look.ts"],
  },
  {
    title: "The assignment",
    symbol: "briefFromFinding",
    wiredIn: ["apps/web/app/api/twin/assign/route.ts"],
  },
  {
    title: "The grade",
    symbol: "tasteScore",
    wiredIn: ["apps/web/app/(app)/twin/page.tsx"],
  },
  {
    /* The other half: of what the critic pointed out, how much ended up commissioned. Two surfaces. */
    title: "The grade of the assignments",
    symbol: "briefScore",
    wiredIn: ["apps/web/app/(app)/twin/page.tsx", "apps/web/app/api/twin/score/route.ts"],
  },
  {
    /*
      The mechanical critic was already calculating the footprint to compare the project with
      itself; storing it costs no more than a file and it is what makes aggregation possible.
     */
    title: "The visual fingerprint",
    symbol: "saveDesignFingerprint",
    wiredIn: ["apps/web/lib/review-run.ts"],
  },
  {
    /* And what reads it: the portrait that does not carry a single word, on its two surfaces. */
    title: "The visual portrait",
    symbol: "portfolioDesign",
    wiredIn: [
      "apps/web/app/(app)/twin/page.tsx",
      "apps/web/app/api/twin/design/route.ts",
    ],
  },
  {
    /*
      What your agents read when entering **this** project, seen from their file. It arrived in an
      increment from the other chair and neither the map nor this list knew it: a new organ wired
      in silence is exactly what this file exists to prevent. The symbol is the component and the
      file is the card, because the risk is the assembly: `tasteForProject` has its own tests and
      they are useless if no one renders it.
     */
    title: "The portrait on the project page",
    symbol: "ProjectTaste",
    wiredIn: ["apps/web/app/(app)/p/[slug]/page.tsx"],
  },
  {
    /*
      The other half of the decision. The state existed in the scheme from the first day and
      nobody wrote it down, so 'I looked at it and it's no good' and 'I haven't looked at it'
      looked the same.
     */
    title: "The discard",
    symbol: "discardTask",
    wiredIn: [
      "apps/web/app/api/twin/assign/route.ts",
      "apps/web/app/api/twin/critique/route.ts",
      /*
        And the third: removing an assignment from the queue is the same operation —saving the
        'no' without deleting the row— and it came later. If someone removes that branch, the
        token ends up with an irreversible action again.
       */
      "apps/web/app/api/assignments/route.ts",
    ],
  },
  {
    /*
      The missing row: until its increase, sending an order left no trace other than a file that
      gets overwritten. It is recorded after `spawn`, so the shot lives in the path and not in the
      component.
     */
    title: "The launch",
    symbol: "recordLaunch",
    wiredIn: ["apps/web/app/api/assignments/launch/route.ts"],
  },
  {
    /*
      The one with the eyes took care of them one by one from their increase, and the mechanic
      went whole in a single task. This is the other granularity, with its content key behind it.
     */
    title: "The assignment from a mechanical finding",
    symbol: "briefFromCritique",
    wiredIn: ["apps/web/app/api/twin/critique/route.ts"],
  },
  {
    /*
      The only tail that remains: the synthesis can join several signed into one, and that is what
      is being asked. Its entire path is traveled in `merge.test.ts`, which is what was missing.
     */
    title: "The merge",
    symbol: "resolveProposal",
    wiredIn: ["apps/web/app/api/twin/taste/route.ts"],
  },
  {
    /*
      The only number that measures outward: how many projects the portrait reaches. Without it, a
      catalog where no one reads it gets a good grade in everything else.
     */
    title: "The reach",
    symbol: "tasteReach",
    wiredIn: [
      "apps/web/app/(app)/twin/page.tsx",
      "apps/web/app/api/twin/score/route.ts",
    ],
  },
  {
    /* What the critics did alone, told wherever you look at what happened without you. */
    title: "The heads-up",
    symbol: "critic",
    wiredIn: ["apps/web/components/today.tsx", "apps/cli/src/today.ts"],
  },
];

describe("cada órgano de Twin tiene quien lo dispare", () => {
  it("y el disparo está en el fichero que dice la tabla", () => {
    for (const organ of ORGANS) {
      for (const file of organ.wiredIn) {
        expect(read(file), `${file} ya no llama a ${organ.symbol}: ${organ.title} se quedó sin disparo`)
          .toContain(organ.symbol);
      }
    }
  });

  it("y sale en el mapa, con su nombre", () => {
    const doc = read(DOC);
    for (const organ of ORGANS) {
      expect(doc, `${DOC} no menciona «${organ.title}»`).toContain(organ.title);
    }
  });
});

/**
 * What the map declares without wiring.
 *
 * Each entry is a promise that is being **denied**: 'this exists and no one calls it from the
 * web.' The day it is wired, this test fails — and that is the idea. What is lost if no one
 * updates it is not the wiring, which will work the same: it is the map, which is the only thing
 * that says how far this is finished.
 */
const UNWIRED: { title: string; symbol: string; absentFrom: string[] }[] = [
  {
    /*
      The gesture of signing lives in beliefs, not in verdicts: marking 2,660 sentences one by one
      would be the O(corpus) tail that the product abandoned. The writer who existed without a
      door was removed in the second audit; if it returns, it must return with its gate and its
      row on the map.
     */
    title: "`verdicts.accepted` has no write door",
    symbol: "setVerdictAccepted",
    absentFrom: ["packages/db/src/queries.ts", "packages/db/src/index.ts"],
  },
];

describe("lo que el mapa dice que falta, sigue faltando", () => {
  it("nadie ha cableado en silencio lo que está escrito como pendiente", () => {
    for (const pending of UNWIRED) {
      for (const file of pending.absentFrom) {
        expect(
          read(file),
          `${file} ya usa ${pending.symbol}: eso ya no es un pendiente, quítalo de ${DOC}`,
        ).not.toContain(pending.symbol);
      }
    }
  });

  it("y cada pendiente está escrito en el mapa", () => {
    const doc = read(DOC);
    for (const pending of UNWIRED) {
      expect(doc, `${DOC} no explica el pendiente «${pending.title}»`).toContain(pending.title);
    }
  });
});
