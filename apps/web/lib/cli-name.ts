/**
 * The name of the command the reader actually has, which is not always the same name.
 *
 * `npx panoma up` runs the binary out of the npx cache and links nothing, so whoever arrived that
 * way has no `panoma` on their PATH. Eleven sentences in this application told them to type
 * `panoma enrich`, `panoma md init`, `panoma twin distill`: every one of them ended in «command
 * not found» at the first thing the product asked of them.
 *
 * The cover and the packages page had already been bitten by this and answered by writing `npx
 * panoma` into the page. That is the same mistake pointing the other way — it is a guess, and for
 * everyone who installed the package globally it is the wrong guess: they are shown a command that
 * is not the one they have, in a place whose whole job is to be copied and pasted.
 *
 * Neither side needs to guess. `panoma up` detects that it is running from npx and puts
 * `PANOMA_EPHEMERAL=1` in the environment of the server it launches — see `runningFromNpx()` in
 * `apps/cli/src/server.ts` — so the answer arrives already decided from the process above.
 *
 * **Server side only.** Next replaces `process.env` in the browser bundle with the variables whose
 * name starts with `NEXT_PUBLIC_`, and this one does not, so a client component that called this
 * would silently get the wrong half of the answer. Client components receive the name through
 * `I18nProvider`, by the same road and for the same reason as the language.
 */
export function cliName(): string {
  return isEphemeral() ? "npx panoma" : "panoma";
}

/**
 * Whether this catalog is running from a copy npx will throw away.
 *
 * The account panel already asked this question of the environment directly. It reads the same
 * variable for the same reason, so it asks here instead: two readers of one variable is how the
 * two of them end up disagreeing.
 */
export function isEphemeral(): boolean {
  return process.env["PANOMA_EPHEMERAL"] === "1";
}
