# Committed credentials: why a detector stakes everything on false positives

Panoma looks for keys inside the files git tracks and shows them redacted. This page tells the
decisions that make such a finding believable — what is discarded on purpose, what is confirmed
before raising the alarm, and why the result is stored nowhere — and what falls outside the
scope.

**No test reads this document.** The list of files that `apps/cli/src/commands.test.ts` watches
is written by hand and does not include `docs/secrets.md`. What is watched is the behavior it
describes: `packages/core/src/secrets.test.ts` (six cases, all of them about private keys
living inside another file), `apps/web/lib/secrets-i18n.test.ts` (a new rule without its pair
of keys in the dictionary turns red) and `apps/web/lib/render-without-secrets.test.ts`.

## Who fires it and where it goes

`panoma secrets` sends `POST /api/secrets` and prints whatever comes back. The server does the
work: it walks the catalog's projects one at a time — this is reading disk, and parallelizing
over the same volume speeds up nothing — and calls `findSecrets(root)` on each.

| piece | where | what it does |
| --- | --- | --- |
| `findSecrets(root)` | `packages/core/src/secrets.ts` | the engine: `git ls-files` and the rules in Node |
| `POST /api/secrets` | `apps/web/app/api/secrets/route.ts` | walks the catalog, sorts by severity, **stores nothing** |
| `reportSecrets(api)` | `apps/cli/src/index.ts` | prints the report and returns the exit code |
| `SecretScan` | `apps/web/components/secret-scan.tsx` | the "review the portfolio" button and the table with the excerpt |

The command **exits with 1 when it finds something**, on purpose, so that it can run inside a
hook or in CI; it exits with 0 only if there is not a single finding. The terminal shows
severity, the translated rule and `file:line`; the redacted excerpt is drawn by the web,
which is where there is room to read it.

This route is what motivated the network guard. It was checked from the home wifi:
`POST /api/secrets` answered 55 credentials from 14 projects, with file and line, to whoever
asked. Today it goes through `sameOrigin` and, with the port open, through the key — see
[network-access.md](network-access.md).

## The failure mode is the false positive, not the negative

A detector that shouts "leaked key" at the Google Maps key in a `google-services.json` — which
is public by design, ships inside the APK and is there for anyone to see — achieves two things:
that you stop paying attention to it, and that the day you leak a real one you will not pay
attention to that one either. **Keeping quiet costs a false negative; accusing falsely costs
the product.**

Hence the three decisions that govern the whole module:

1. Every rule is a **prefix that only one provider issues**. No heuristics along the lines of
   "a 32-character string next to the word key": that flags half a lockfile. Today there are
   eleven content rules and four filename rules.
2. There is an **explicit list of what is not a secret**, and when something is discarded the
   report says how much and why (`ignoredPublic` travels in the report).
3. When in doubt, nothing is reported.

The episode that settled the doctrine: searching for a bare PEM header gave twenty-one findings
on this disk, and all twenty-one had the same shape:

```js
.replace('-----BEGIN PRIVATE KEY-----', '')
```

That is, code stripping the header to keep the base64: exactly the opposite of a leaked key.
Today's rule demands that **material follows behind**, which is what tells "there is a key
here" apart from "a key is being talked about here".

## `hasRealKeyMaterial`: what separates a key from an example is the closing line, not the size

A private key header is not enough even with material behind it, because any `README` that
shows how to set the environment variable has it: `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw`
appears at the start of **every** RSA key in PKCS#8 — it is the header of the format, not
secret material. On this disk that was five findings across three documentation files.

The first version discarded them by demanding two hundred characters of base64, on the
reasoning that "a real key runs past a thousand". **That is only true for RSA.** Measured with
`openssl`:

| key | material |
| --- | --- |
| Ed25519 in PKCS#8 | 64 characters |
| EC P-256 in SEC1 | 164 characters |
| EC P-256 in PKCS#8 | 184 characters |

All three slipped under the cut, so a JWT signing key or an App Store Connect `.p8` AuthKey
pasted inside a code file **was not reported**, and the report said the repository was clean.
Named `clave.pem` the filename rule fired anyway, and that hid the hole: it only shows up when
the key lives inside something else.

What really separates a key from an example is the **closing line**: an
`-----END … PRIVATE KEY-----` behind the material. A truncated example ends in an ellipsis and
has none. This is how the check ends up, over the 2,400 characters of context it receives:

```ts
function hasRealKeyMaterial(context: string): boolean {
  const end = context.indexOf("-----END");
  if (end < 0) return countBase64(context) >= 200;
  return countBase64(context.slice(0, end)) >= 48;
}
```

With the closing line ahead, forty-eight characters are enough (below the shortest key that
exists); without it the old cut stands, because a 4096-bit RSA key does not fit whole into
the context window and there the absence of a closing line proves nothing.

## `PUBLIC_BY_DESIGN`: the list of what does not count

Eleven path patterns. The first three are client configuration that Google and Firebase publish
on purpose — `google-services.json`, `GoogleService-Info.plist`, `firebase_options.dart` —:
they ship inside the APK and the IPA, and their security rests on the console's restrictions,
not on secrecy. Behind them come the environment templates (`.env.example`, `.env.sample`,
`.env.template`), the front-page documentation (`README`, `CONTRIBUTING`, `CHANGELOG`), the
five lockfiles — full of hashes shaped like everything — and other people's dependency folders:
`Pods*`, `node_modules`, `vendor`, `third_party`, `Carthage`.

The last two families came out of looking at this disk. `ios/Pods 2/gRPC-C++/etc/roots.pem` is
gRPC's root certificate bundle — public, shipped in every installation in the world — and it
came up as "critical private key". Whatever is in there you did not write and is not yours to
leak. The asterisk in `Pods*` is not zeal: on this disk there are "Pods 2" folders, which is
what Finder leaves behind when it copies.

What this list discards **is counted** in `ignoredPublic` and shows on screen. A silent discard
would be the same broken promise as the false positive, only in the other direction.

## Four files are the problem for what they are

Besides the content rules there are name rules, which read nothing: `.env` and its variants
(`local`, `production`, `prod`, `development`, `dev`, `staging`), the key files (`.pem`,
`.key`, `.p12`, `.pfx`, `.jks`, `.keystore`), Google service accounts
(`service-account….json`, with the hyphen or without it) and private SSH keys (`id_rsa`,
`id_dsa`, `id_ecdsa`, `id_ed25519`). These findings arrive with `line: 0` — the finding is the
whole file, not a line — and their excerpt is the name itself. Their why is a single one and it
is the one that matters: **deleting it from the tree is not enough, what was committed is still
in the history and the key has to be rotated.**

## Why matching happens in Node and not with `git grep -E`

The first version handed the combined rules to `git grep -E`, which uses POSIX extended regular
expressions: it understands neither `\b` nor `(?:…)`, which are PCRE. Git exited with code 128,
the `catch` read that as "this is not a repository" and the report said `scanned: false` with
zero findings. That is: the detector detected nothing and presented it as if there were nothing
to detect, **which is the worst possible way for a secret detector to fail.**

`git grep -P` would have worked wherever git ships with PCRE compiled in, but that cannot be
taken for granted and the alternative was having two different behaviors depending on the
machine. Today git does exactly one thing — `git ls-files -z`, with a 32 MiB buffer and a 30 s
cap — and the rules live in a single place.

## The OpenAI detector that leaked itself

The OpenAI pattern was `sk-(?:proj-)?[A-Za-z0-9]{32,}`, with no `_` or `-` in the class. On a
real key like `sk-proj-Gn…-6N5cvVf3…` the match **stopped at the first hyphen**, and since
redaction only covers what matched, the interface ended up showing the rest of the key in full.
The detector leaked the very credential it had come to report as leaked.

The fix has two halves and the second is the one that matters. The first is putting `_` and `-`
into the class. The second is to stop assuming that the pattern covers the whole credential:
`redact` makes a **second pass over any long run that is left**.

```ts
return line
  .replace(/[A-Za-z0-9+/=_-]{28,}/g, (token) => `${token.slice(0, 8)}${"·".repeat(8)}`)
  .trim()
  .slice(0, 160);
```

A rule that assumes nothing about the patterns costs one line and never fails again for the
same reason. Of the actual value it shows a prefix — ten characters, or a third if the secret
is shorter — and eight middle dots: with that you find it in the file and you know which
provider it belongs to, which is everything you need in order to go and revoke it.

## The other two redactors, and why the generic net goes last

`secrets.ts` warns a person about what git already tracks. The other two black out text that is
about to be stored or to travel, and the split is explicit:

| function | file | what it covers |
| --- | --- | --- |
| `redact` (private) | `packages/core/src/secrets.ts` | the excerpt in a report cell, cut to 160 |
| `redactSecrets` | `packages/core/src/redact.ts` | what an agent is about to save into memory |
| `redactQuote` | `packages/core/src/quotes.ts` | your words before they enter the catalog as a quote |

`redactSecrets` is eleven shapes and one visible mark, `[secret-redacted]`: erasing without
saying so is lying. It exists because a token an agent pasted into the log ("failed with
`sk-…`") traveled intact into the archive, from there into the distiller, could end up in a
note and be served for months.

`redactQuote` is the hard case, because it runs over prose — full of paths, git SHAs, checksums
and chunks of base64 pasted out of a screenshot — and not over configuration files. Its twenty
rules were tuned by running them over 2,137 turns written by the user in this disk's
transcripts: it used to touch twenty-one turns, today it touches four, and two of those four
carry a real credential.

**The order of the twenty rules in `redactQuote` is load-bearing.** The provider-shaped ones go
first and the generic net — any run of forty characters of the kind credentials are made of —
goes last. This is not a matter of taste: the generic net replaces the run with the sentinel,
so if it ran earlier the key would disappear — good — but with it the evidence of **what** it
was, and `labels` would come out saying "unidentified long string". Saying what leaked is half
the value: whoever reads "a Stripe key was redacted" knows exactly what to rotate; whoever
reads "something long was redacted" has to go and find the original, which is precisely what no
longer exists. For the same reason, inside the structural block the specific goes before the
general: `sk-ant-` before `sk-`, and `service_role` before the generic JWT.

And that is why there is, on purpose, **no** "keyword equals value" net (`token=…`,
`password=…`). Over Spanish it blacks out "password: the usual one"; over code it blacks
out `apiKey: process.env["OPENAI_API_KEY"]`, which is the opposite of a leak.

## The result is not stored, and that is the decision

`POST /api/secrets` **is the only thing panoma computes and does not persist.** There is no
table, no cache and no file: it is computed, shown and forgotten. The reason is one line long —
storing the exact location of someone's leaked keys creates a second place they can leak from —
and it has consequences you feel while using it: there is no history, you cannot compare
against last week, and every report costs reading the files again. It is paid knowingly.

The same rule, one floor down, is pinned by `apps/web/lib/render-without-secrets.test.ts`: no
page may read secrets while it renders. In development mode Next puts whatever a server
component reads inside the RSC payload that travels to the browser — measured in this very
application: `/ai` passed only the masked keys to the client and even so the whole `ai.json`
showed up inside `self.__next_f` —, and `panoma up` starts `next dev`, so the mode that leaks
is exactly the one everybody uses. **The leak is not in what you paint, it is in what you
read.**

## What it does not find / Known limits

- **It does not look at the history.** What is read is the current content of what git tracks
  today. A key that was committed and later deleted from the tree is still alive in the old
  blobs, and this module does not go there yet. That is why no text in the engine says
  "history": promising the full history without walking it would be the same silent failure
  this detector exists to prevent. The header of `apps/web/app/api/secrets/route.ts` does say
  it, and that sentence is one too many.
- **It does not look at what git ignores.** A key in an ignored `.env` is on your disk, not in
  your history: a different risk, a much smaller one, and mixing them would make the list
  unmanageable in exactly the projects that are most careful.
- **A folder without git is not scanned.** It returns `scanned: false` and is counted in
  `skipped`.
- **Only text extensions are read**, and by inclusion: whatever is not on the list — binaries,
  images, video — is not opened. Reading a 40 MB `.psd` to look for `sk_live_` in it finds
  nothing and costs the same as reading a hundred code files.
- **Nothing above 2 MiB**, and no line longer than 2,000 characters: that is minified and there
  is nothing to read there.
- **One finding per line and per whole-file rule.** The line rules stop at the first match, so
  two different keys on the same line come out only once; the whole-file ones look for a single
  match. The report says there is a problem there, not how many.
- **Public by design is a knowing blind spot.** A real key pasted inside a `README.md` or a
  lockfile is counted in `ignoredPublic` and not reported. That is the price of having no false
  positives in the places where the shape of a key shows up as part of the job.
- **The provider palette is short and closed.** Eleven content shapes. A provider that is not
  there is not detected, and adding one without its pair of keys in the dictionary turns
  `apps/web/lib/secrets-i18n.test.ts` red on purpose: the engine and the screen are joined only
  by the `ruleId`, and without that test the web would show `core`'s Spanish inside an English
  card.
- **There is no entropy heuristic**, not here and not in the redactors. A short secret with no
  known shape gets away. That is the cheap failure; a log riddled with false positives — until
  somebody turns the whole redaction off — is the expensive one.
- **It revokes nothing.** Finding it is the easy half: the report ends by reminding you that
  the key has to be rotated before touching the repository, and a person does that.
