/**
 * Understand what someone writes in the 'link' field of an account.
 *
 * It lives here, and not inside the component, for two reasons. The first is that it can be
 * tested. The second is that **it used to live in two places**: the same regular expression copied
 * in the editor and in `POST /api/accounts`, with the guarantee that one day one of the two would
 * change and the other would not.
 *
 * What it fixes, specifically: `localhost:3000` and `192.168.1.5:8080` didn’t pass that filter —
 * it required a dot and then the end of the string, and a `:puerto` is neither of those — so they
 * were **silently discarded**: the row was saved without complaint and the field appeared empty
 * when returning. For a section whose promise is “write it once and Panoma remembers it,” losing
 * what was written without saying anything is the opposite of the deal. And of all the addresses
 * in the world, that of the project’s own development server is precisely the one that gets
 * entered here the most.
 *
 * Now there are three responses instead of two, and that is the fundamental difference: there is
 * not a single way to 'no link.' There is the empty field, which is normal and not mentioned, and
 * there is the text that could not be understood, which **is** mentioned and preserved.
 *
 * The only thing that is not negotiable is that `http` or `https` comes out. A `javascript:`
 * stored here would be a link with permission to bite, and this list is rendered as links.
 */

export type AccountUrl =
  /** The field is empty. It's normal: there is nothing to say. */
  | { kind: "empty" }
  /** Understood. `url` already has a schema and that is what is saved. */
  | { kind: "url"; url: string }
  /** It could not be understood. `text` is what was written, intact, in order to be able to return it. */
  | { kind: "unusable"; text: string };

const HTTP = /^https?:\/\//i;

/** Any scheme: `mailto:`, `ftp:`, `javascript:`. None are ours. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `localhost:3000` seems to bring a schema and it doesn't: after the colon there is a port.
 * Distinguishing it is the whole fix, so it is checked explicitly instead of relying on the order
 * of the conditions to turn out right.
 */
const HOST_PORT = /^[^\s/?#@:]+:\d{1,5}([/?#]|$)/;

/**
 * Addresses that almost never speak `https`: one's machine and the one next to it.
 *
 * It matters to get it right. Saving `https://localhost:3000` is as useless as saving nothing —
 * the link doesn't open — and anyone pointing to the development server of their own project
 * expects it to open. Whoever really has TLS locally writes the scheme and it is respected.
 */
function isLocal(hostname: string): boolean {
  const name = hostname.toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name === "[::1]" || name === "0.0.0.0") return true;
  // Local network names: those of Bonjour/mDNS and those that are not a domain (`mi-nas`).
  if (name.endsWith(".local") || !name.includes(".")) return true;
  if (/^127\./.test(name)) return true;
  // The three private ranges of RFC 1918, which is where the router and the NAS live.
  if (/^10\./.test(name) || /^192\.168\./.test(name)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(name);
}

/**
 * What is written in the link field.
 *
 * Accepts the address with schema (`https://…`), the bare domain (`vercel.com/x`) and
 * `host:puerto` (`localhost:3000`, `192.168.1.5:8080` ). Everything else returns as `unusable`
 * **with its text**, so that whoever calls can notify instead of discarding it.
 */
export function normalizeAccountUrl(value: string | null | undefined): AccountUrl {
  const text = value?.trim();
  if (!text) return { kind: "empty" };

  if (HTTP.test(text)) return verify(text, text);

  /*
    Bring a diagram and it is not `http(s)` nor a disguised `host:puerto`: out. This is where
    `javascript:` and `data:` stay, and also `mailto:`, which belongs to the field next door and
    it is convenient that I mention it instead of swallowing it.
   */
  if (SCHEME.test(text) && !HOST_PORT.test(text)) return { kind: "unusable", text };

  const authority = text.split(/[/?#]/, 1)[0] ?? "";
  const hostname = authority.replace(/:\d+$/, "");

  /*
    A bare name —`vercel`— is a tag placed in the wrong field, not an address: without a dot and
    without a port there is nothing to call. One asks for one of the two things only when the
    scheme has to be guessed; whoever writes `http://vercel` knows what they are doing and is not
    to be argued with.
   */
  if (
    authority === hostname &&
    !hostname.includes(".") &&
    !hostname.startsWith("[")
  ) {
    return { kind: "unusable", text };
  }

  return verify(`${isLocal(hostname) ? "http" : "https"}://${text}`, text);
}

/**
 * The final word is held by the browser parser, not a regular expression.
 *
 * `candidate` is returned —the text as it is, with the schema in front if it was missing— and not
 * `url.href`: `new URL` is used here to check, not to rewrite what someone noted. Over-normalizing
 * means that the user saves one thing and reads another.
 */
function verify(candidate: string, text: string): AccountUrl {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { kind: "unusable", text };
  }
  if (!url.hostname) return { kind: "unusable", text };
  /*
    `usuario@sitio.com` in this field is almost always an email placed where it shouldn't be, and
    notifying sends the person to the email field. Along the way, it leaves out the way links are
    used that appear to go to one site and go to another.
   */
  if (url.username || url.password) return { kind: "unusable", text };
  return { kind: "url", url: candidate };
}
