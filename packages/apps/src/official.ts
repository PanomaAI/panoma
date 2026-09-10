import { AppFault } from "./faults";
export interface OfficialApp {
  readonly id: string;
  readonly pkg: string;
  readonly protocols: readonly string[];
  /*
    The directory under the home where this app keeps its work, one segment and one per app.
    It used to be the literal `video` for whatever was asked, so a second app would have shared
    the first one's productions and its «delete productions» would have taken them both.
   */
  readonly data: string;
}

export const OFFICIAL = [
  { id: "panoma-video", pkg: "@panoma/video", protocols: ["1"], data: "video" },
] as const satisfies readonly OfficialApp[];

/*
  The Node floor each app declares in its own `engines`, copied here so a refusal is a sentence
  rather than npm's wall of output.

  It is a hint, not the authority. The authority is the app's own package.json, published from
  another repository that no test here can read, so these two can silently disagree — and if
  they do, the cost is only that the slower path speaks: npm still refuses, and `engines.ts`
  turns that refusal into the same sentence. It is also blind on purpose to two walls no
  declared value can see: a floor declared by one of the app's dependencies, and a floor on npm
  rather than on Node.

  It is a separate constant and not a fifth key on the tuple above, because `official.test.ts`
  asserts that key set exactly — an app's identity is what it is and where its work lives, and
  a floor is neither.
 */
export const NODE_FLOOR: Readonly<Record<string, string>> = { "panoma-video": ">=22.18" };

export function officialApp(id: string): OfficialApp {
  const app = OFFICIAL.find((item) => item.id === id);
  if (!app) throw new AppFault("unknown-app");
  return app;
}
