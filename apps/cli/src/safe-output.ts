/**
 * Filter the output of the CLI so that nothing read from the disk can be sent to your terminal.
 *
 * A terminal does not print bytes: it interprets them. `\x1b[2K` clears the line, `\r` goes back
 * to the beginning, `\x1b[1A` moves up one. Panoma prints project names, package names, paths, and
 * commit subjects that **come from files written by someone else**, and all of that went to the
 * terminal as is. Verified: a `package.json` whose `name` carries those sequences deletes the
 * lines that Panoma has just written and puts others in their place. In a report whose value is to
 * say 'eight Stripe keys in production,' letting the analyzed material rewrite the verdict
 * invalidates it entirely.
 *
 * **It filters at the output and not at every place where a message is composed.** There are about
 * forty calls to `write` and it is enough to forget one; the dozens of reviews that other agents
 * dedicated to narrowing HTTP responses, one by one, are proof of where relying on discipline
 * leads. Here the filter is a point through which everything passes.
 *
 * The rule is what makes this not break anything: **it lets the color through and nothing else.**
 * `\x1b[…m` (SGR) is the only thing that Panoma uses —picocolors does nothing else— so keeping it
 * keeps the output identical, and any other sequence can be removed without loss because Panoma
 * never emits it. What comes from a file, therefore, can be made green, but not delete a line.
 */

/*
  `\x1b[` + parameters + final letter. It is kept only if that letter is `m`. It also covers the
  OSC sequences (`\x1b]…`), which on various terminals are used to change the window title or open
  a link.
 */
const CSI = /\x1b\[[0-9;:?]*([a-zA-Z])/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const OTHER_ESCAPES = /\x1b[^[\]]/g;
/*
  C0 and C1 minus tab and line break. `\r` enters the list: return to the beginning of the line is
  half of "erase what was there".
  **`\x1b` (0x1b) is deliberately left out**, even if it falls within the range C0. If it were
  included, this pass would strip the ESC from the color sequences that the previous pass just
  decided to keep, and the `[32m` would end up written as text in the middle of the sentence.
  That’s exactly what happened in the first version. The ESCs that are not part of a color are
  removed by `LOOSE_ESCAPES` afterwards.
 */
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g;
/** An ESC that does not open a color sequence: unnecessary. */
const LOOSE_ESCAPES = /\x1b(?!\[[0-9;:?]*m)/g;

export function sanitizeOutput(text: string): string {
  return text
    .replace(OSC, "")
    .replace(CSI, (sequence, final: string) => (final === "m" ? sequence : ""))
    .replace(OTHER_ESCAPES, "")
    .replace(CONTROL_CHARS, "")
    .replace(LOOSE_ESCAPES, "");
}

/**
 * Install the filter on stdout and stderr.
 *
 * It is called once, at startup. It returns a function to remove it, which is only used by tests:
 * in the real process there is no reason to stop filtering.
 */
export function installSafeOutput(): () => void {
  const streams = [process.stdout, process.stderr] as const;
  // The reference is kept as is, **without `bind` **: a `bind` returns a new function, so removing
  // the filter would leave a copy instead of the original, and two cycles of putting on and taking
  // off would end up stacking wrappers. The test that compares identities caught it.
  const originales = streams.map((stream) => stream.write);

  streams.forEach((stream, index) => {
    const original = originales[index]!;
    stream.write = (function (this: unknown, chunk: unknown, ...rest: unknown[]) {
      // A buffer can split a multibyte character in half between two writes. Since here only ASCII
      // control bytes are removed, decoding and re-encoding would risk that for nothing: buffers
      // are passed through as is.
      const call = original as (this: unknown, ...args: unknown[]) => boolean;
      if (typeof chunk !== "string") return call.call(stream, chunk, ...rest);
      return call.call(stream, sanitizeOutput(chunk), ...rest);
    }) as typeof stream.write;
  });

  return () => {
    streams.forEach((stream, index) => {
      stream.write = originales[index]! as typeof stream.write;
    });
  };
}
