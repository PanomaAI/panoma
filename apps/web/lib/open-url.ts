/**
 * Open an address in the default browser, on the three systems, without a shell.
 *
 * The browser could do this on its own with `window.open`, and for one address it does. For the
 * five that a plan carries it cannot: a popup blocker lets the first one through and eats the rest,
 * and the terminal —`panoma open x --all`— has no browser to ask. So the server opens them, the
 * way it already opens folders: a fixed binary per system, and the address as **one argument**.
 * No `start` on Windows, whose `cmd` reads a `&` inside the address as the end of the command;
 * `rundll32 url.dll,FileProtocolHandler` hands it to the same handler and parses nothing.
 *
 * What is handed over is checked once more here, at the last step, even though every address a
 * plan carries was validated when it was saved or came from the catalog: `open` on macOS also
 * opens files, and a `/etc/hosts` or a `javascript:` reaching it would be exactly the mistake this
 * function exists to make impossible.
 */

export interface UrlOpener {
  command: string;
  args: (url: string) => string[];
}

export function urlOpener(platform: string): UrlOpener | undefined {
  switch (platform) {
    case "darwin":
      return { command: "open", args: (url) => [url] };
    case "win32":
      return { command: "rundll32", args: (url) => ["url.dll,FileProtocolHandler", url] };
    case "linux":
      return { command: "xdg-open", args: (url) => [url] };
    default:
      return undefined;
  }
}

/** The longest address the openers agree to carry; beyond it Windows starts truncating. */
export const MAX_OPENABLE_URL = 2048;

/**
 * Control characters and whitespace: none of them belongs in an address that is one argument.
 * The control range is the point of the expression, hence the rule switched off for this line.
 */
// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u001f\u007f\s]/;

/**
 * The address as it may be opened, or `undefined`.
 *
 * `http` or `https`, no credentials in front of the host, no control characters, within the
 * length. What comes back is the text that was given, not a rewrite: the owner saved one
 * address and this opens that one.
 */
export function openableUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_OPENABLE_URL) return undefined;
  if (!/^https?:\/\//i.test(text)) return undefined;
  if (UNPRINTABLE.test(text)) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!url.hostname || url.username || url.password) return undefined;
  return text;
}
