/*
  Any phrase converted into a phrase that can be saved.
  Panoma saves what the user wrote: the messages they left in their agents' transcripts, exactly
  as is, because the value of a quote lies in it being their words. The problem is that in those
  same transcripts, the user sometimes pasted a password —the agent needs the credential to fix
  the deployment— and that text, if saved in full, turns the catalog database into yet another
  place that can be leaked.
  Up to this point, there was nothing in the repository that did this. There are two similar
  things and neither is worth it:
  - `secrets.ts` has the correct table, the one with prefixes that only one provider issues, but
  it is entirely on the disk side: the only thing it exports is `findSecrets(root)`, which calls
  `git ls-files`. Its `RULES` and `redact` are private to the module, and that `redact` truncates
  to 160 characters because it builds the cell of a findings table, not a document that will be
  saved and read in full.
  - `redact(text, known)` from `packages/ai/src/safety.ts` does go from chain to chain, but its
  nine forms were tuned against vendor error messages, which are short and carry the key alone.
  When it comes to transcripts, it misses: `sk_live_`, `AKIA…`, the `SG.x.y` from SendGrid, AWS
  secret keys and the body of a PEM (they carry `+` and `/`, which are not in its character
  class), the `usuario:clave@` of a URL connection, and the thirty-two hexadecimals from Twilio.
  ── The order of the table is structural load ─────────────────────────────────────
  Rules in the shape of a provider go **first** and the generic long-string network goes **last**.
  It's not a matter of preference: the generic network replaces any forty-character string with
  the sentinel, so if it ran earlier, the key would disappear — fine — but with it the proof of
  **what** it was, and `labels` would come out saying "unidentified long string." Saying what was
  leaked is half the value: whoever reads "a Stripe key was crossed out" knows exactly what to
  rotate; whoever reads "something long was crossed out" has to go look for the original, which is
  exactly what no longer exists.
  For the same reason, within the structural block, the specific comes before the general:
  `sk-ant-` before `sk-`, and `service_role` before the generic JWT.
  ── False positives are the mode of failure, not the negatives ───────────────────
  This does not run over configuration files: it runs over the user's prose, which is full of long
  words, file paths, git SHAs, checksums, and pieces of base64 from a capture. It is the same
  lesson left by `secrets.ts` written in lines 142-151, where searching for the header of a plain
  PEM gave twenty-one findings on this disk and all twenty-one were code, removing the header to
  keep the base64. An extra strikethrough is not noticeable at the moment and is noticeable a year
  later, when the saved quote says «fix the «hidden credential» on the panel» and there is no
  original anymore.
  So the table below was not refined by imagining: it was passed over 2,137 turns written by the
  user in the transcripts of this record, each one of the things that were crossed out was looked
  at and corrected until it stopped crossing out what it shouldn't. There were twenty-one turns;
  today there are four, and two of those four actually have credentials. The exemptions that came
  out of there — URL, path, name with dots, identifier, checksum — are one by one with their real
  example in the auxiliary functions.
  That is why each rule below has written against which specific false positive it defends. A new
  rule without that line is a rule added blindly, and the place where it is checked that it still
  does not mark them is `quotes.test.ts`, which stores the eight literals.
  And that is why there is **no**, on purpose, a 'key equals value' network (`token=…`,
  `password=…`, `secret: …` ). Regarding Spanish, that crosses out 'password: the usual one' and
  'the design token --color-fondo', which are not credentials; and regarding code, it crosses out
  `apiKey: process.env["OPENAI_API_KEY"]`, which is exactly the opposite of a leak. What is lost
  by not having it—a short credential with no form next to its name—is the only thing that
  `redact(text, known)` of `safety.ts` does know how to hide, because there the exact value is
  known.
 */

/**
 * What is rendered on the site of a secret.
 *
 * It is the same string, character by character, as `REDACTED` in `packages/ai/src/safety.ts`, and
 * it is copied instead of imported because the dependencies go from `ai` to `core` and never the
 * other way around: having the engine load the models package to cover a key would be putting the
 * safety net behind what it protects. If it ever changes, it changes in both places — the user has
 * to see the same word, whatever strikes through it.
 */
const REDACTED = "«credencial oculta»";

export interface QuoteRedaction {
  /** The text with the credentials covered. The rest, byte by byte, as it was. */
  text: string;
  /** If something got covered. It's useful to not look at the text again that didn't need to be touched. */
  redacted: boolean;
  /**
   * Which rules were broken, listed and without repeating: 'OpenAI key', 'GitHub token'.
   *
   * It is what allows you to notify **what** was leaked without saving the value. Without this,
   * the only way to know what needs to be rotated would be to look at the original, which is
   * precisely what this module exists to not retain.
   */
  labels: string[];
}

interface QuoteRule {
  id: string;
  /** What the user will see in `labels`. In Spanish and without the value, obviously. */
  label: string;
  /** Always global: a transcription can bring the same key pasted three times. */
  pattern: RegExp;
  /**
   * What is written in the match site. By default, the entire sentinel.
   *
   * Returning `undefined` means 'this was not a credential': the text stays as it was and the
   * label is not marked. There live the confirmations that the form alone cannot give — the size
   * of a PEM material, or if a long run is a SHA.
   */
  mask?: (
    match: string,
    groups: (string | undefined)[],
    offset: number,
    whole: string,
  ) => string | undefined;
}

/**
 * Cross out the last group and leave the previous ones.
 *
 * For the rules that recognize the credential **by the name it carries next to it**
 * (`aws_secret_access_key = …`). That name is not secret and it is the best clue that is going to
 * to have someone read the quote afterward, so it remains.
 */
function maskLastGroup(_match: string, groups: (string | undefined)[]): string {
  return `${groups.slice(0, -1).join("")}${REDACTED}`;
}

/**
 * How much base64 do you have to look behind header to believe that there is a key there.
 *
 * The cutoff was two hundred, copied from `secrets.ts`, where the written reasoning was that "a
 * real key exceeds a thousand base64 characters." **That is only true for RSA.** Measured with
 * `openssl`: an Ed25519 in PKCS#8 is 64 characters of material; a P-256 EC, 164 in SEC1 and 184 in
 * PKCS#8. All three were below the cutoff, so the rule returned `undefined`, the PEM was saved
 * entirely, and `redacted` came out `false`, which is the worst way to fail because nobody
 * notices. An AuthKey `.p8` from App Store Connect and a JWT signing key are exactly that shape.
 *
 * What separates a key from a documentation example is not the size, it's the **ending**:
 * `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw` —the header of the format, the one that appears in all
 * the README that show how to set the environment variable— comes loose and without `-----END`.
 * With the ending behind it, forty-eight are enough, below the shortest that exists; without it
 * the old cut remains. It's the same decision, and the same measurement, as `hasRealKeyMaterial`
 * in `secrets.ts`.
 */
const MIN_KEY_MATERIAL_CLOSED = 48;
const MIN_KEY_MATERIAL_OPEN = 200;

function keyMaterial(text: string): number {
  return text.match(/[A-Za-z0-9+/=]/g)?.length ?? 0;
}

/**
 * How far `enclosingToken` and `nameAround` look on each side of the match.
 *
 * Without a roof, both sweep up to the next space and on top of that cut the chain, and the
 * generic net produces a match every forty characters: on a line without spaces—a `data:` URI
 * stuck together, a JSON minified—that is O(n) per match and O(n²) in total. Measured on this
 * laptop before bounding: 32 KB took 0.23 s; 64 KB, 0.90 s; 128 KB, 3.7 s; 256 KB, 14.5 s; 512 KB,
 * 58 s. Four times for each duplication. For comparison, the 3,497 turns the user wrote in the 82
 * transcripts on this disc are crossed out in 263 ms: a single glued line cost two hundred times
 * the corpus. And it is not a laboratory case, because `history/claude-code.ts` supports lines of
 * 512 KB.
 * (`MAX_LINE_CHARS`) and trim to 2,000 characters **after** calling here.
 *
 * One thousand twenty-four, and the number is not appealing either. Cropping the window can only
 * make it get **more** crossed out—you lose sight of the `://` or the bar that they exempted—which
 * is the kind of failure that this file passed an entire measurement avoiding. With the window at
 * 512, a real link already broke: a Microsoft `safelinks` of six hundred characters puts so much
 * `%7C` between the scheme and the `&sdata=` at the end that the scheme was left out and the link
 * came back crossed out. At 1,024 it survives, the longest run without spaces of the 3,497 turns
 * of this disk (483 characters) still fits entirely, and the 512 KB attached go down from 58 s to
 * 0.36 s.
 */
const SCAN_WINDOW = 1_024;

/**
 * What cuts the piece that looks around a coincidence.
 *
 * The blank space is not enough. In minified content —a JSON of one line, a `.env` stuck with `;`,
 * the response of a API— the piece between spaces is the entire line, so a `https://` in any field
 * exempted **all** matches in the line: `{"token":"Xk92…"}` was crossed out and
 * `{"token":"Xk92…","docs":"https://x.dev"}` was not, with the same token and no other difference
 * than a field next to it.
 *
 * The ones below are the characters with which **another format wraps** the URL: the quotes of
 * JSON, the backticks of Markdown, the semicolon of `.env`, the angles of an autolink, the braces
 * of the object. Cutting by them limits the `://` to the real URL and leaves out what was only
 * next to it. The comma and the semicolon do fit inside a URL —RFC 3986 allows them in the path—,
 * but nothing is lost there: a path has slashes, and the slash exempts it anyway by `nameAround`.
 */
const TOKEN_BREAK = /[\s"'`,;<>{}]/;

/**
 * The piece in which a coincidence falls: the entire URL, with its scheme.
 *
 * The generic network needs to see the neighborhood and not just the match, because what
 * distinguishes a token from a stretch of route is beyond the forty characters. The neighborhood
 * ends where it can no longer be a URL or where the window ends.
 */
function enclosingToken(text: string, offset: number, length: number): string {
  const floor = Math.max(0, offset - SCAN_WINDOW);
  const ceiling = Math.min(text.length, offset + length + SCAN_WINDOW);
  let start = offset;
  while (start > floor && !TOKEN_BREAK.test(text[start - 1]!)) start--;
  let end = offset + length;
  while (end < ceiling && !TOKEN_BREAK.test(text[end]!)) end++;
  return text.slice(start, end);
}

/** Characters that can be part of a name or a path. The others cut it. */
const NAME_CHARS = /[A-Za-z0-9_.\-/\\+%~]/;

/**
 * The name attached to the match, without the punctuation that surrounds it.
 *
 * It stops at quotation marks, grave accents, colons, and parentheses, and that is why it does not
 * keep `android:name="` nor the grave accents from Markdown. That difference is what makes ``
 * `20260803000000_create_vision_usage.sql` `` be recognized as a file name and not just as any
 * long string.
 *
 * It also stops at `SCAN_WINDOW`, and for the cost reason that is measured there: the class above
 * swallows `+`, `/`, and `%`, that is, the entire Base64 alphabet, so over a `data:` URI glued,
 * this function alone swept the entire line for each of the matches that the generic network
 * produced.
 */
function nameAround(text: string, offset: number, length: number): string {
  const floor = Math.max(0, offset - SCAN_WINDOW);
  const ceiling = Math.min(text.length, offset + length + SCAN_WINDOW);
  let start = offset;
  while (start > floor && NAME_CHARS.test(text[start - 1]!)) start--;
  let end = offset + length;
  while (end < ceiling && NAME_CHARS.test(text[end]!)) end++;
  return text.slice(start, end);
}

/**
 * Checksum, not credential.
 *
 * Only the three lengths that exist —SHA-1, SHA-256, SHA-512— and only hexadecimal. A git SHA is
 * the most common thing in a programming transcript ("the bug entered in 3f2a1b9c…"), and crossing
 * it out leaves the sentence without the only thing that made it useful. The opposite almost never
 * happens: to end up here, a credential would have to be exactly 40, 64, or 128 characters long
 * and not contain a single letter from g to z.
 */
function isDigest(token: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128})$/i.test(token);
}

/**
 * An identifier written by a person, not something that came from a generator.
 *
 * It comes from the same measurement: what remained crossed out in excess were
 * `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` between grave accents, the Xcode compiler flags
 * (`-fmodules-validate-once-per-build-session`, `-Wnon-modular-include-in-framework-module` ), and
 * a line of seventy-nine dashes that separated two blocks of a record.
 *
 * What distinguishes them is not the length, it's the **form of the words**: a separator is
 * needed, and each piece between separators must be a whole word — in a single case — or an
 * integer. A credential is not split into words: it is base62 and mixes letters and digits within
 * the same piece. That is what excludes the Firebase
 * `app-1-203976783733-ios-aa6b779f851d6ff5e2053c` from the exemption, which is still flagged even
 * though it is public by design — the same asymmetry, and for the same reason, as with the `AIza`
 * key mentioned above: in a citation, there is no file to go check.
 *
 * The separator is mandatory on purpose: without it, forty consecutive capital letters —which is
 * what a provider that we do not know how to read returns— would be treated as a word.
 */
function looksLikeIdentifier(token: string): boolean {
  if (!/[_-]/.test(token)) return false;
  return token
    .split(/[_-]+/)
    .every(
      (word) => /^[A-Z]?[a-z]*$/.test(word) || /^[A-Z]+$/.test(word) || /^[0-9]+$/.test(word),
    );
}

/**
 * A place or a name, not a secret.
 *
 * The three exemptions came from measuring, not from imagining: this function was applied over
 * 2,137 shifts written by the user in the transcripts of this record, and each one was examined
 * individually to see what the generic network crossed out. The three are what was wrong:
 *
 * 1. **Inside a URL.** The identifier of a support article, the `_gl=1*164u6de*…` of Google
 * Analytics, and the `%7C…%7C` of a link rewritten by Microsoft are very long strings and are not
 * anyone's credentials. An entire URL is a site. What can go inside a URL —a token with its name
 * in front, `?access_token=…` — is crossed out by the structural rule `url-query`, which does not
 * look at the context. "Inside" is inside URL and not inside the line: the piece is cut by
 * `TOKEN_BREAK`, because when only the blank space cut it, in a minified JSON the piece was the
 * entire line and the `https://` of a field exempted the token of the neighboring field.
 * 2. **Within a route.** `apps/web/.next/static/chunks/app_landing_…_00ab11cd.js`,
 * `node_modules/.vite/deps`, `Library/Developer/Xcode/DerivedData`: it is the material from which
 * these conversations are made.
 * 3. **A name with dots.** `20260803000000_create_vision_usage.sql` in backticks,
 * `android.window.PROPERTY_COMPAT_ALLOW_…`, and the `…-abc123.apps.googleusercontent.com` of a
 * Google client, which is also public by design. All three are over forty characters long and none
 * is a secret.
 *
 * Known and assumed limit: an opaque credential inserted into a URL—a magical login link—survives
 * if it doesn't have a name in front or a known provider form. That gap is preferred over
 * returning appointments with broken links, which was what happened in four of the twenty-one
 * measured cases.
 */
function looksLikeLocation(text: string, offset: number, length: number): boolean {
  if (enclosingToken(text, offset, length).includes("://")) return true;
  const name = nameAround(text, offset, length);
  if (/[/\\]/.test(name)) return true;
  return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(name);
}

/**
 * The type that goes inside a PEM delimiter, the opening and the closing one.
 *
 * `(?: BLOCK)?` is not decoration: the OpenPGP armor (RFC 4880 §6.2) is
 * `-----BEGIN PGP PRIVATE KEY BLOCK-----`, with `BLOCK` between `KEY` and the dashes, so the
 * alternative `PGP ` without it was dead code: it could never match. An armed block pasted into a
 * transcript came out with five of its six base64 lines intact, half-crossed out by the generic
 * network and with the wrong label («long unidentified string» instead of «private key»).
 */
const PEM_KIND = "(?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?";

/**
 * The table. The structural ones first, the generic network at the end: see the header.
 */
const RULES: QuoteRule[] = [
  {
    id: "private-key",
    label: "clave privada",
    /*
      The header **and material behind it**, just like in `secrets.ts` and for the same finding:
      `.replace('-----BEGIN PRIVATE KEY-----', '')` is code removing the header to keep the
      base64, that is, the opposite of a leak, and on this disk, those were twenty-one false
      positives. The body is crossed out and the two delimiter lines are left, which are not
      secret and are the ones that indicate what was there.
      The closure is in the pattern and is optional on purpose: when it is there, the material
      threshold drops to forty-eight and the short keys come in —see `keyMaterial` —; and when it
      is not there, the one who decides is still the old threshold, which is what leaves out
      README with the loose header.
     */
    pattern: new RegExp(
      `(-----BEGIN ${PEM_KIND}-----)([\\s"'\\\\A-Za-z0-9+/=]{16,})` +
        `(-----END ${PEM_KIND}-----)?`,
      "g",
    ),
    mask: (_match, groups) => {
      const header = groups[0] ?? "";
      const material = groups[1] ?? "";
      const footer = groups[2] ?? "";
      const floor = footer ? MIN_KEY_MATERIAL_CLOSED : MIN_KEY_MATERIAL_OPEN;
      if (keyMaterial(material) < floor) return undefined;
      const lead = /^\s*/.exec(material)?.[0] ?? "";
      const tail = /\s*$/.exec(material)?.[0] ?? "";
      return `${header}${lead}${REDACTED}${tail}${footer}`;
    },
  },
  {
    id: "stripe",
    label: "clave de Stripe",
    // `pk_live_` is intentionally left out: the publishable key from Stripe travels in the store's
    // JavaScript, anyone with the inspector open can see it, and crossing it out would be exactly
    // the warning that teaches not to heed warnings.
    pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  },
  {
    id: "aws-access-key-id",
    label: "clave de acceso de AWS",
    // Sixteen uppercase letters and digits behind `AKIA`. Nothing in prose has that form: to
    // collide you would have to write a twenty-character word in uppercase letters in a row.
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "aws-secret",
    label: "clave secreta de AWS",
    /*
      This **requires the name next to it** and is the most important decision in the table. The
      AWS secret key is forty base64 characters with no prefix, which is also the form of a SHA-1,
      from any piece of a pasted capture and from half of a `integrity:` of a lockfile. Searching
      for it by form alone would guarantee a false positive. With the name in front, there is no
      possible ambiguity.
     */
    pattern:
      /(aws[_-]?secret[_-]?access[_-]?key|secretAccessKey)(["'\s]*[:=]["'\s]*)([A-Za-z0-9+/]{40})(?![A-Za-z0-9+/])/gi,
    mask: maskLastGroup,
  },
  {
    id: "github",
    label: "token de GitHub",
    // Thirty-six characters after the prefix. `ghp_` and company do not appear in Spanish or in
    // identifiers; the risk here is the opposite, falling short.
    pattern: /\b(?:gh[opsur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g,
  },
  {
    id: "google",
    label: "clave de API de Google",
    /*
      Thirty-five exact characters behind `AIza`, which is the actual length. Unlike `secrets.ts`,
      here **the one from** `google-services.json` is **not** forgiven even if it is public by
      design: in a quote there is no file to look at to know if it was from Maps or from the
      server, and covering a key that was already public costs three words of a sentence. The
      asymmetry is deliberate.
     */
    pattern: /\bAIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
  },
  {
    id: "slack",
    label: "token de Slack",
    // The dash behind `xox?` is what makes it secure: no word carries it.
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: "sendgrid",
    label: "clave de SendGrid",
    // Three parts separated by periods, the last two long. `SG.` on its own appears in prose
    // (Singapore, 'SG.' abbreviated); two stretches of sixteen characters, no.
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  },
  {
    id: "groq",
    label: "clave de Groq",
    pattern: /\bgsk_[A-Za-z0-9]{20,}/g,
  },
  {
    id: "xai",
    label: "clave de xAI",
    // Twenty and not eight as in `safety.ts`: `xai-` is a plausible prefix for the name of a branch
    // or a package, and there eight characters are reached unintentionally.
    pattern: /\bxai-[A-Za-z0-9-]{20,}/g,
  },
  {
    id: "anthropic",
    label: "clave de Anthropic",
    // Before OpenAI's: `sk-ant-…` also fits in `sk-…`, and if the generic one won, the label would
    // say the wrong provider, which is worse than saying nothing.
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "openai",
    label: "clave de OpenAI",
    /*
      Two defenses against the same false positive, which is real and frequent: `sk-` is a prefix
      of classes CSS (`sk-fading-circle-dot`, from the load skeleton libraries) and of language
      tags (`sk-SK`, Slovak). The first is the twenty-character threshold —`safety.ts` uses eight,
      which works there because the text is a provider error message and not here—. The second is
      the confirmation below: an OpenAI key is random base62 and necessarily includes uppercase
      letters and digits; a kebab-case identifier contains neither of the two.
      The `_` and `-` within the class come from the scar of `secrets.ts`: without them the match
      is cut at the first dash of `sk-proj-Gn…-6N5cvVf3…` and the rest of the key remains on the
      screen as if it were context.
     */
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    mask: (match) => (/[A-Z0-9]/.test(match.slice(3)) ? REDACTED : undefined),
  },
  {
    id: "supabase-service-role",
    label: "clave service_role de Supabase",
    /*
      Before the generic JWT, and just because of the label: the one for `service_role` bypasses
      all row-level security policies, so whoever reads the notice has to read that and not 'a
      JWT'. Without `\b` in front on purpose, because the real name is `SUPABASE_SERVICE_ROLE_KEY`
      and there is no word boundary before `SERVICE`.
     */
    pattern: /(service[_-]?role[a-z0-9_-]*)(["'\s]*[:=]["'\s]*)(eyJ[A-Za-z0-9_.-]{40,})/gi,
    mask: maskLastGroup,
  },
  {
    id: "jwt",
    label: "token JWT",
    /*
      `eyJ` is `{"` in base64, that is, the header of any JWT. The three parts are what separate
      it from a word that starts with 'eyJ', which does not exist. The false positive that it does
      accept: the example token from jwt.io pasted to explain the format, which is marked even
      though it is worthless. It is a less readable sentence in exchange for not having to
      distinguish an expired token from a live one, something that cannot be done from here.
     */
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  },
  {
    id: "twilio-pair",
    label: "token de Twilio",
    /*
      The Twilio token is thirty-two hexadecimals: exactly the shape of a MD5, a `etag`, a build
      identifier, and the short hash of half the world. Looking for it just by its shape would be
      declaring war on prose, so it is required that it comes accompanied: either by the account
      SID (`AC` and thirty-two others), or —rule below— by the name. The assumed consequence is
      that a standalone Twilio token, without anything next to it, survives: it measures
      thirty-two and the generic network starts at forty. That gap is preferred over marking each
      checksum of every conversation.
     */
    pattern: /\b(AC[0-9a-f]{32})([\s"':,=]+)([0-9a-f]{32})\b/gi,
    mask: maskLastGroup,
  },
  {
    id: "twilio-keyed",
    label: "token de Twilio",
    // The other half: `TWILIO_AUTH_TOKEN=…`. The provider name is what gives certainty;
    // `auth_token` by itself is not accepted because half of API in the world has it.
    pattern: /(twilio[a-z0-9_-]*)(["'\s]*[:=]["'\s]*)([0-9a-f]{32})(?![0-9a-f])/gi,
    mask: maskLastGroup,
  },
  {
    id: "url-userinfo",
    label: "credenciales dentro de una URL",
    /*
      `postgres://usuario:clave@host` and `https://usuario:clave@registro`. The entire pair is
      crossed out and not just the password: the user of a URL connection is usually an email and
      an email is not something this should store either. The scheme and the host remain, which is
      what is needed to understand the sentence.
      The two false positives that must be avoided are in the character class:
      `http://localhost:3000/@vite/client` (the at symbol comes after a slash, and the slash is
      not allowed inside the password) and `https://cdn.example/npm/@scope`
      (there are no colons before the at symbol). The `git@github.com:org/repo` of a remote SSH
      It also doesn't enter, because `://` is required.
      The user can be empty —`{0,64}` and not `{1,64}` — because `redis://:clave@host` is the
      canonical form of a URL for a Redis connection and a common one in RabbitMQ: with the
      minimum set to one there was no match and the password was stored entirely, without `labels`
      saying anything. The three false positives above remain excluded with the minimum at zero,
      checked one by one: what excludes them is the forbidden slash within the two classes, not
      the length of the user.
     */
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]{0,64}:[^\s/@]{1,256}@/gi,
    mask: (_match, groups) => `${groups[0] ?? ""}${REDACTED}@`,
  },
  {
    id: "url-query",
    label: "credencial en una URL",
    /*
      A token within a URL, recognized **by the name of the parameter**. This rule is what
      compensates for `looksLikeLocation` allowing the rest of URL to pass: without it, a
      `?access_token=…` would be saved in full. With it, the readable link is saved and without
      the credential, which is what is wanted of the two things.
      Two defenses against the false positive. The name has to be attached to `?` or `&`, so
      `&sdata=` from Microsoft links and `&csrf_token=` are not included. And the value has to
      contain a capital letter or a digit, because `?key=documentacion-de-referencia` —a manually
      written anchor in a Markdown link— does not have either, and there is no reason to break
      anyone’s link because of that.
     */
    pattern:
      /([?&](?:access_token|refresh_token|id_token|token|api[_-]?key|apikey|key|secret|signature|password|passwd|pwd|auth|code)=)([A-Za-z0-9._~+%/-]{16,})/gi,
    mask: (_match, groups) =>
      /[A-Z0-9]/.test(groups[1] ?? "") ? `${groups[0] ?? ""}${REDACTED}` : undefined,
  },
  {
    id: "bearer",
    label: "token en una cabecera Bearer",
    /*
      It covers the range of twenty to forty characters, where neither the form of a provider nor
      the generic network reaches. The false positive that requires confirmation is literal and
      from this corpus: "send the Bearer authorization header" —"authorization" is thirteen
      characters long and with a low threshold the word would be crossed out—. A token carries
      digits; an English word does not.
     */
    pattern: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{20,})/gi,
    mask: (_match, groups) =>
      /[0-9]/.test(groups[1] ?? "") ? `${groups[0] ?? ""}${REDACTED}` : undefined,
  },
  {
    id: "generic",
    label: "cadena larga sin identificar",
    /*
      The final network: any string of forty characters that make up a credential. Forty because
      below that identifiers and model names start to fall, and because the longest word in
      Spanish does not reach twenty-five; forty characters in a row without a space are neither a
      word nor code that anyone writes by hand.
      The exemptions —checksum, URL, path, name with dots, and identifier— are reasoned above, in
      `isDigest`, `looksLikeLocation`, and `looksLikeIdentifier`, and all came from looking at
      what I crossed out as extra. They are what make it possible to go over an entire programming
      conversation without leaving it unreadable: out of 2,137 turns written by the user on this
      disk, with the exemptions four are touched —and two of the four had a real credential—;
      without them, twenty-one.
     */
    pattern: /[A-Za-z0-9_-]{40,}/g,
    mask: (match, _groups, offset, whole) => {
      if (isDigest(match)) return undefined;
      if (looksLikeIdentifier(match)) return undefined;
      if (looksLikeLocation(whole, offset, match.length)) return undefined;
      return REDACTED;
    },
  },
];

/**
 * Leave the text in a state to be saved, and say what there was.
 *
 * It never throws and never trims: what goes in comes out, with the credentials replaced by the
 * sentinel and everything else byte for byte the same. Saving a half-struck-through text would be
 * worse than not saving it, so if a new rule wavers, the answer is to cross it out and say it in
 * `labels`.
 */
export function redactQuote(text: string): QuoteRedaction {
  const labels = new Set<string>();
  let output = text;

  for (const rule of RULES) {
    output = output.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      // `replace` passes (match, …groups, position, full text).
      const offset = rest[rest.length - 2] as number;
      const whole = rest[rest.length - 1] as string;
      const groups = rest.slice(0, -2) as (string | undefined)[];
      const masked = rule.mask ? rule.mask(match, groups, offset, whole) : REDACTED;
      if (masked === undefined) return match;
      labels.add(rule.label);
      return masked;
    });
  }

  return {
    text: output,
    redacted: labels.size > 0,
    labels: [...labels].sort((a, b) => a.localeCompare(b, "es")),
  };
}
