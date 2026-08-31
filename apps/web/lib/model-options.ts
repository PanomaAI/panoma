/**
 * What does the model dropdown teach, and why doesn't it filter by what is already written.
 *
 * The model field always comes pre-filled with the model that is being used. With a `<datalist>`
 * that was the end of the matter: the browser filters the suggestions against the text in the box,
 * so with `gpt-5.6-terra` inside the only suggestion that survives the filter is that same one —
 * the one that is already there. Clicking the field opened an empty menu or a single-line menu
 * that repeated what was seen. The other three models could not be viewed without first clearing
 * the box, and nothing on the screen indicated that it had to be cleared.
 *
 * Hence the `null`. The list has two ways of opening and they do not mean the same thing:
 *
 * - **With the button** (`typed === null`): 'show me what’s there.' You can see all of them, no
 * matter what the box contains. This is the one that was broken.
 * - **Writing** (`typed === "gpt-5"`): «limits». There, filtering is indeed what is requested.
 *
 * It lives in its own file, and not inside the component, because the tests on this website do not
 * transform `.tsx` —it is on purpose— and this rule is precisely the one that breaks without being
 * noticed: the “obvious” filter is always to filter by the field value, and that is the mistake.
 */

export function modelOptions(all: string[], typed: string | null): string[] {
  if (typed === null) return all;
  const needle = typed.trim().toLowerCase();
  if (!needle) return all;
  return all.filter((model) => model.toLowerCase().includes(needle));
}

/**
 * Move the highlight with the arrows, going around both ends.
 *
 * `-1` is 'none highlighted', which is how the list opens: the first down arrow goes to the first
 * item and the first up arrow, to the last. Without wrapping around, whoever reaches the end with
 * the keyboard gets stuck there without understanding why.
 */
export function moveHighlight(current: number, step: number, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return step > 0 ? 0 : length - 1;
  return (current + step + length) % length;
}
