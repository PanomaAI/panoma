/**
 * Writes one command string to a clipboard. The docs page calls this with
 * `navigator.clipboard`; tests call it with a writer they can inspect.
 *
 * The string that goes in is the string that is written. The button must not
 * prepend `$`, strip flags, or wrap the line.
 */
export async function copyCommand(
  command: string,
  clipboard: { writeText: (value: string) => Promise<void> | void },
): Promise<void> {
  await clipboard.writeText(command);
}
