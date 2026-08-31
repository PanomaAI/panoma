import { say } from "./messages";
/**
 * The command-line arguments: what Panoma recognizes and what it does with what it does not.
 *
 * In a separate file so that it can be checked. `index.ts` ends with `main().then(…)`, so
 * importing it from a test would execute the entire CLI — and a parser without tests is exactly
 * where the bugs sneak in that are not seen, because they don't fail: they do something else.
 */

export interface Flags {
  json: boolean;
  verbose: boolean;
  duplicates: boolean;
  save: boolean;
  force: boolean;
  security: boolean;
  api: string;
  git: boolean;
  depth: number;
  out?: string;
  path: string;
  isolation?: string;
  /** `panoma ai use <proveedor> --model <modelo>`. */
  model?: string;
  /** `panoma ai ask <pregunta> --provider <proveedor>`. */
  provider?: string;
  /** With `twin mine`: how many reactions are collected and shown. */
  limit?: number;
  /** With `twin mine`: only the sessions whose directory starts with this path. */
  project?: string;
  /**
   * With `twin mine`: a single story instead of all the allowed ones.
   *
   * Here it arrives unchecked. The valid identifier is decided by the inventory, which lives in
   * `@panoma/core` and is lazily loaded inside the command; validating it from this file would
   * require dragging the engine to the startup of any `panoma open`. The one who validates it is
   * `twin-command.ts`, which can also suggest the ones that do exist.
   */
  source?: string;
  /**
   * With `twin distill`: stick to the budget and not spend it.
   *
   * It is not the flag that starts the trial, but the one that leaves it in trial: the trial is
   * done **always** —the command first asks how much it would cost and prints it— and this is what
   * prevents moving forward. Any other way would leave the path of spending money a keystroke away
   * from not spending it, with nothing in between to show the figure.
   */
  dryRun: boolean;
  /** `panoma twin distill --all`: chain passes until reading the entire history. */
  all: boolean;
  /** With `open`: open the folder in the explorer instead of in the editor. */
  folder: boolean;
  /** With `open`: open a terminal already located in the project. */
  terminal: boolean;
  /** With `agent-key` and `hooks`: write the configuration instead of printing it. */
  install: boolean;
  /** With `hooks`: undo what `--install` installed. */
  remove: boolean;
  /** With `up`: leave it on so that it starts when logging in. */
  atBoot: boolean;
  /**
   * With `up`: also listen on the local network, requesting credential.
   *
   * The two things go together and cannot be separated: opening the port without a password is
   * exactly what left the catalog visible on the wifi, so this flag does both or does none.
   */
  network: boolean;
  /** With `up --network`: generate a new key and invalidate the previous one. */
  rotateKey: boolean;
  /** Arguments that are neither flags nor flag values. */
  positionals: string[];
}

/**
 * Everything the parser recognizes. It is useful for validation and for suggesting in case of an
 * error.
 */
export const KNOWN_FLAGS = [
  "--json",
  "--verbose",
  "-v",
  "--duplicates",
  "-d",
  "--save",
  "--force",
  "--security",
  "--api",
  "--no-git",
  "--depth",
  "--out",
  "--isolation",
  "--folder",
  "--terminal",
  "--install",
  "--remove",
  "--on-boot",
  "--network",
  "--rotate-key",
  "--model",
  "--provider",
  "--limit",
  "--all",
  "--project",
  "--source",
  "--dry-run",
  "--help",
  "-h",
  "--version",
  "-V",
];

/**
 * Interprets the arguments and rejects what it does not understand.
 *
 * Silently ignoring an unknown flag seems nice and is the opposite: `panoma run x y --securiy` was
 * not a broken command, it was *another command* —uploading the latest published version instead
 * of the one that fixes the vulnerability—successfully executed and with a green summary. The user
 * is left with the impression of having patched something. A mistyped flag should trigger an
 * error, not a different and believable result.
 */
/*
  Here the language is detected instead of being received.
  `parseArgs`, `mcpEntry`, and `panomaCommand` are utilities that are called from many places and
  sometimes before the command exists; threading the language into them would require passing it
  through half a dozen signatures that do not use it for anything else. `detectLang()` is a pure
  environment function and is executed only once in a process, so asking it here gives exactly the
  same answer as receiving it from above.
 */

export function parseArgs(argv: string[]): Flags | "help" | "version" | { error: string } {
  /*
    Without arguments, it is no longer help.
    `panoma` by itself was the only command that answered a question that no one asks twice —"what
    can this do?"— and therefore the daily entry was taken up by the welcome sign. Now it returns
    some flags with zero positions, and it is `index.ts` that decides what that is: the daily
    report. The help is still where everyone looks for it, in `--help`, and that is why that case
    is indeed resolved here and beats anything else.
   */
  if (argv.includes("--help") || argv.includes("-h")) return "help";

  /*
    And the other universal question, the first one that is typed after installing any CLI. `-v`
    lowercase is already `--verbose`, so the short one is `-V`, as in npm. It is solved here and
    not in a command because it does not depend on anything: neither the database, nor the server,
    not even the language — a number is read the same in all.
   */
  if (argv.includes("--version") || argv.includes("-V")) return "version";

  const flags: Flags = {
    json: false,
    verbose: false,
    duplicates: false,
    save: false,
    force: false,
    security: false,
    api: process.env["PANOMA_API"] ?? "http://localhost:4173",
    git: true,
    depth: 3,
    path: ".",
    folder: false,
    terminal: false,
    install: false,
    remove: false,
    atBoot: false,
    network: false,
    rotateKey: false,
    dryRun: false,
    all: false,
    positionals: [],
  };
  const positionals = flags.positionals;
  const unknown: string[] = [];
  const missingValue: string[] = [];

  /*
    `--api=http://…` and `--api http://…` are the same thing for anyone who has used a terminal.
    Before, only the second form was valid, and the first fell into the bag of the unknown — which
    until now was the bag of what is silently ignored.
   */
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const equals = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const arg = equals > 0 ? raw.slice(0, equals) : raw;
    const inline = equals > 0 ? raw.slice(equals + 1) : undefined;

    // A flag with a value takes it from `=` or from the next argument, and in that case it consumes
    // it: if not, the value falls into the positionals and ends up interpreted as something else.
    // `--isolation container` came to be used as a version number.
    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      // A `--out --json` does not mean 'write to a file called --json'.
      if (next === undefined || next.startsWith("-")) {
        missingValue.push(arg);
        return undefined;
      }
      i++;
      return next;
    };

    if (arg === "--json") flags.json = true;
    else if (arg === "--verbose" || arg === "-v") flags.verbose = true;
    else if (arg === "--duplicates" || arg === "-d") flags.duplicates = true;
    else if (arg === "--save") flags.save = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--security") flags.security = true;
    else if (arg === "--no-git") flags.git = false;
    else if (arg === "--folder") flags.folder = true;
    else if (arg === "--terminal") flags.terminal = true;
    else if (arg === "--install") flags.install = true;
    else if (arg === "--remove") flags.remove = true;
    else if (arg === "--on-boot") flags.atBoot = true;
    else if (arg === "--network") flags.network = true;
    else if (arg === "--rotate-key") flags.rotateKey = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--all") flags.all = true;
    else if (arg === "--api") flags.api = takeValue() ?? flags.api;
    else if (arg === "--depth") flags.depth = Number.parseInt(takeValue() ?? "3", 10) || 3;
    else if (arg === "--out") flags.out = takeValue();
    else if (arg === "--isolation") flags.isolation = takeValue();
    /*
      The two from `panoma ai`, which were implemented in their command and were unreachable.
      `ai-command.ts` read them from `argv` on its own, but this parser runs first and any flag
      not here dies with 'Unknown option.' So choosing a model from CLI was impossible—and since
      changing the provider deletes the saved model, the only way to set it was broken. That the
      target command understood them was useless: it never got to see them.
     */
    else if (arg === "--model") flags.model = takeValue();
    else if (arg === "--provider") flags.provider = takeValue();
    /*
      The three from `panoma twin mine`. `--limit` is parsed as `--depth`, but without a default
      number behind it: here there is none that is valid, and the missing one is checked below.
      `--source` goes through `takeValue` like the others, so `--source=codex` and
      `--source codex` are the same order — and above all, this way the identifier does not fall
      into the positional ones, where `twin mine codex` would have been read as a weird
      subcommand.
     */
    else if (arg === "--limit") flags.limit = Number.parseInt(takeValue() ?? "", 10);
    else if (arg === "--project") flags.project = takeValue();
    else if (arg === "--source") flags.source = takeValue();
    else if (arg.startsWith("-")) unknown.push(arg);
    else positionals.push(arg);
  }

  if (missingValue.length > 0) {
    return {
      error: missingValue.map((flag) => say("error.needsValue", { flag })).join("\n"),
    };
  }
  if (unknown.length > 0) {
    return {
      error: unknown
        .map((flag) => {
          const guess = nearestFlag(flag);
          return `${say("error.unknownFlag", { flag })}${guess ? `  ${say("error.didYouMean", { guess })}` : ""}`;
        })
        .join("\n"),
    };
  }

  /*
    An unrecognized value cannot pass either. A miswritten isolation level did not reach anywhere
    where it could be checked: `resolveExecutor` ends in `return` of `hardened` for anything other
    than `local` or `container`. Requesting `--isolation containr` caused execution with less
    isolation than requested, and the report said 'clean environment, disposable HOME' as if it
    were what you had chosen.
   */
  const LEVELS = ["local", "hardened", "container"];
  if (flags.isolation !== undefined && !LEVELS.includes(flags.isolation)) {
    return {
      error:
        `${say("error.unknownIsolation", { value: flags.isolation })}\n` +
        say("error.isolationLevels", { list: LEVELS.join(" · ") }),
    };
  }

  /*
    And a `--limit dos` neither. A number that doesn’t make sense would remain as `undefined`, and
    `undefined` to `twin mine` doesn’t mean 'a few': it means **all**. So writing the limit
    incorrectly would produce exactly the opposite of what was requested, undermining the whole
    story and displaying it on screen, with the same look of having obeyed that `--securiy` had.
    `--depth` can fall to its default value because theirs is documented; here there is none
    defensible.
   */
  if (flags.limit !== undefined && !(Number.isInteger(flags.limit) && flags.limit > 0)) {
    return { error: say("error.badLimit") };
  }

  /*
    Two flags that contradict each other are the same trap as a poorly written flag: you have to
    choose one for it, and whichever one you choose will do the opposite of what the other half of
    the command asked. Here there is no defensible choice, so one asks.
   */
  if (flags.folder && flags.terminal) {
    return { error: say("error.folderAndTerminal") };
  }
  if (flags.install && flags.remove) {
    return { error: say("error.installAndRemove") };
  }

  // positionals[0] is the command ("scan"); the rest is the path.
  flags.path = positionals[1] ?? ".";
  return flags;
}

/**
 * The most similar known flag, if there is any close enough.
 *
 * Edit distance with a threshold of two: `--securiy` → `--security` is a useful hit, `--zzz` →
 * `--json` would be noise that makes one doubt whether the error is real.
 */
function nearestFlag(flag: string): string | undefined {
  let best: { flag: string; distance: number } | undefined;
  for (const candidate of KNOWN_FLAGS) {
    const distance = editDistance(flag, candidate);
    if (distance <= 2 && (!best || distance < best.distance)) best = { flag: candidate, distance };
  }
  return best?.flag;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}
