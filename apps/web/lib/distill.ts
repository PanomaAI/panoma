import { estimateTokens, wrapUntrusted } from "@panoma/core";

/*
  From what you said to what is proposed to you: the prompt, and everything that can be tested
  from it.
  There is no server or model here. It lives in `lib/` for the usual reason —the web is tested by
  its assistants, never by running a server, and `lib/verdicts.ts` explained why— and for a second
  reason that carries more weight in this file: **the prompt is the product**. All this module
  does is decide which quotes are sent, how they are presented to the model, and what is accepted
  from what it answers, and none of these three things can be checked by looking at a nice
  response on screen. A prompt that can only be read is a prompt that can only be commented on.
  ── Quotes are the only proof, and it is not enough to just ask for it ────────────────────────
  Each statement must cite at least two verdicts, and that rule is written **twice**: in the
  prompt, so that the model follows it, and in `parseProposals`, for when it does not comply. A
  rule that only exists in the prompt is not a rule, it is a wish: what reaches the user is what
  is saved, not what was requested. So what is saved goes through a filter that checks each
  citation against those actually sent in that batch, and a statement whose citations do not match
  is not proposed. No 'probably referred to'. The entire product relies on there being something
  you wrote behind each sentence, and a sentence with an invented quote breaks that for all the
  others — it is the same economy as the paragraph invented in `describe`.
  ── Short labels, not identifiers ────────────────────────────────────────
  The model is not taught the `id` of the verdict, which is a forty-character sha1, but a batch
  label: `c1`, `c2`, `c3`. Two reasons and both matter. One is the price: sixty full identifiers
  are 2,400 characters of pure noise, about 600 tokens per call that say nothing. The other
  matters more — a sha1 has **form**, and a model that runs out of quote knows how to fabricate
  forty hexadecimal characters that resemble it. `c17` cannot be convincingly forged: it is either
  on the batch list or it is not, and checking it is a query to a map. The back translation to
  `id` is done by this module, which is the one that has the map.
  That exactly covers the gap that is opened by inserting foreign text and tags in the same block:
  a quote that contained a `[c99]` inside would gain nothing, because `c99` is not on the map and
  the statement that cites it fails in the same way as the others.
  ── The text is wrapped, even if it is yours ───────────────────────────────────────
  You wrote the quotes yourself, so the boundary is not 'this was written by someone else.' The
  thing is that this prompt comes out through the same channel as `describe` and `md/review`, and
  with the provider `cli` that channel ends in `claude -p` or `codex exec`: an agent with tools
  and with your disk in front of them. What is sent is arbitrary text taken from a JSONL file, and
  it has been written for a year and a half without thinking that one day a model would read it.
  It is wrapped in `untrusted_data` exactly the same way as someone else's README.
  The `origin` that is used is `journal`, which is the closest of those that `UntrustedOrigin`
  declares today. It doesn’t fit entirely —this is not the log of an agent— but calling it
  `readme` would be lying even more, and adding a new origin is touching the engine from a task
  that is not of the engine. The day `untrusted.ts` has an origin for this, this line changes and
  nothing else changes.
  ── Here nothing is crossed out either ──────────────────────────────────────────────────
  The quote travels to the prompt byte by byte. It has already gone through `redactQuote` in the
  parser, which is the only place where the wording goes **before** the cut, and a second pass
  wouldn't cover anything new: it would only ruin real quotes, which is what header of `quotes.ts`
  with the table fine-tuned over 2,137 real turns counts. The only place it touches the text is
  `wrapUntrusted`, and what it touches is the delimiter and chat template tokens — not the prose.
  The test next to it saves it.
  ── In batches, and by project ──────────────────────────────────────────────────
  On this machine, there are 2,604 saved verdicts, taken from 1.5 GB of Claude Code and 3.63 GB of
  Codex. Sending them all at once is not expensive: it is impossible, and if it ever were
  possible, it would still be a bad idea, because the answer to 'summarize these two thousand
  sentences' is always the same generality. You send a little and carefully chosen: those that
  show a signal first—204 of 3,442 reactions show it, which means the rest is the long tail—and
  among those, the recent ones. And it is grouped by project, because the taste is not the same on
  the web as on the CLI, and mixing them in the same batch produces sentences that work for both,
  which is another way of saying that they work for neither.
 */

/**
 * The subjects that the profile allows, with what needs to be told to the model about each one.
 *
 * The same as `TASTE_TOPICS` in `packages/core/src/taste.ts`, written here as **data** and not
 * imported, because what is needed in this file is the iterable list with its explanation: it is
 * shown to the model within the prompt and its answers are checked against it. A type cannot be
 * written in a prompt. Both versions say the same thing and have to continue saying it; the test
 * next to it keeps it.
 *
 * Before they were surfaces —`general`, `landing`, `app`, `cli`, `docs` —, that is, where you see
 * what you did. The reason for the change to subjects is in `TASTE_TOPICS`; what matters here is
 * that the synthesis runs **by subject**, so this classification is what decides which evidence is
 * looked at together. With surfaces, everything in cover design and everything in app design was
 * synthesized separately, and both halves said the same thing.
 */
export const TOPICS: { name: string; hint: string }[] = [
  { name: "design", hint: "cómo se ve y se siente: composición, color, tipografía, espacio, movimiento" },
  { name: "frontend", hint: "cómo se construye lo que se ve: componentes, estados, estilos, accesibilidad" },
  { name: "backend", hint: "el servidor y sus datos: rutas, consultas, esquema, errores, rendimiento" },
  { name: "cli", hint: "el terminal: comandos, salida, banderas, lo que imprime y lo que calla" },
  { name: "testing", hint: "cómo se comprueba: qué se prueba, cuánto, contra qué, y qué se deja fuera" },
  { name: "copy", hint: "las palabras: mensajes, documentación, nombres, tono, idioma" },
  { name: "workflow", hint: "cómo trabaja con sus agentes: encargos, revisiones, commits, ritmo" },
  { name: "tooling", hint: "las herramientas y la construcción: dependencias, empaquetado, tipos, CI" },
  { name: "data", hint: "los datos y sus números: métricas, migraciones, formatos, privacidad" },
  { name: "other", hint: "el cajón. Solo si de verdad no encaja en ninguna" },
];

/** The names alone, to check what the model answers. */
export const TOPIC_NAMES = TOPICS.map((one) => one.name);

/**
 * What is needed from a verdict to distill it, and nothing more.
 *
 * It is not the `Verdict` of `@panoma/db` although one fits here without an adapter, for the same
 * reason that `ReactionInput` is not the `Reaction` of the engine: this module does not know about
 * the database and it does not have to. `source`, `category`, and `accepted` are not here because
 * they do not change anything of what is decided here.
 */
export interface DistillVerdict {
  id: string;
  /** The stable identity of the project: it is what groups the sessions. */
  identity: string;
  at: Date;
  /** Your words, already drafted in the parser. They travel whole. */
  quote: string;
  /** The last thing they had given you when you said it, or nothing. */
  context: string | null;
  signals: string[];
}

/** A batch: the queries of a project that go in a single call to the model. */
export interface DistillChunk {
  identity: string;
  verdicts: DistillVerdict[];
}

/**
 * How many appointments are there at most in one batch.
 *
 * Sixty sentences are enough for a pattern to repeat and few enough for the response to continue
 * talking about them. Beyond that, the model stops quoting and starts summarizing, which is
 * exactly what this product does not want.
 */
export const CHUNK_VERDICTS = 60;

/**
 * And how many characters, which is the limit that really matters.
 *
 * The parser limits each reaction in `REACTION_CHARS` = 2,000 and each delivery in
 * `DELIVERY_CHARS` = 240, so a quote can weigh 2,240 characters. Sixty of the big ones would be
 * 134,000 characters — about 33,500 tokens — in a single call, and no one decides that: the corpus
 * of the day decides. With this limit, the batch of long quotes takes ten and the batch of normal
 * quotes takes sixty, because the median of the corpus is one line. No quote is cut to fit: what
 * doesn't fit remains for the next batch, and a quote that alone exceeds the limit goes in anyway
 * and goes alone.
 */
export const CHUNK_CHARS = 24_000;

/**
 * How many batches does a distillation make at most.
 *
 * There were four, and the reason died with the tail: 'four projects per pass give a proposal that
 * can be read in one sitting, and whoever wants the eighty should launch it eighty times, which is
 * also what they are allowed to review in between.' There is nothing to review in between anymore.
 * What comes out of here is evidence that nobody looks at, so the number that limited it was that
 * of a person's patience in front of a list, and that person is no longer here.
 *
 * And the price of it being four can be measured: with 2,278 citations in the author's corpus,
 * four projects per pass are 240 citations, that is, ten passes to read it entirely. No one
 * presses a button ten times, so in practice the corpus stayed at 20% — and with 53 observations
 * spread across seven subjects, the synthesis does not synthesize anything: it writes one belief
 * per observation. The measured density was 1.2, which is copying under another name.
 *
 * Eight is what fits in a request without the wait becoming absurd — about four minutes — and
 * whoever wants the entire corpus has `--all`, which chains pastes until there is nothing left to
 * read. The limit remains here and not on the route because it is a property of distillation, not
 * of the request.
 */
export const MAX_CHUNKS = 8;

/** The real appointment ceiling by execution: the rounds for what fits in each one. */
export const MAX_VERDICTS_PER_RUN = CHUNK_VERDICTS * MAX_CHUNKS;

/**
 * Minimum citations per statement.
 *
 * Two and not one. One quote is not a pattern, it's an anecdote: anyone said anything one night.
 * What this product promises to teach is what you repeat.
 */
export const MIN_CITATIONS = 2;

/** How many statements are accepted from each answer. */
export const MAX_STATEMENTS = 8;

/**
 * What a statement can measure.
 *
 * `TASTE_CAP` is 3,000 characters for the entire profile, so a two-hundred-word sentence leaves
 * room for fifteen. And there is a reason that is not about space: what needs a paragraph to be
 * explained is not a preference, it is an essay, and it cannot be accepted or rejected with a
 * click.
 */
export const MAX_STATEMENT_CHARS = 200;

/**
 * What is allowed to the wrapper before I cut.
 *
 * `wrapUntrusted` cuts by default to 6,000 characters, which is sensible for an external text of
 * unknown size; here the size has already been limited by `planChunks` and this number is only
 * there so that the wrapper does not further limit what the former allowed to pass. If it were
 * cut, the last quote of the block would end halfway with its tag intact: the model would quote it
 * without having read it entirely, and the quote filter would not notice because the tag does
 * resolve it.
 */
const QUOTES_LIMIT = 40_000;


/** A quote with the label with which the model will refer to it. */
export interface LabelledQuote {
  label: string;
  verdict: DistillVerdict;
}

/** What is needed to call the model and to understand what it answers. */
export interface BuiltPrompt {
  chunk: DistillChunk;
  system: string;
  prompt: string;
  /** From label to verdict. It is the map against which the quotes are resolved. */
  labels: Map<string, DistillVerdict>;
}

/**
 * Distribute the verdicts in batches by project, in order of preference.
 *
 * Three decisions, and all three can be discussed by looking at the result:
 *
 * 1. **Within a project, send the signal.** A verdict with a signal is one where `detectSignals`
 * acknowledged a rejection, a compliment, an insistence on consistency. There are 204 out of 3,442
 * on this machine: if they were not first, the batch would fill with a long tail and the model
 * would have to guess which ones matter. Between two with a signal, the recent one, because the
 * taste from a year and a half ago is no longer the same.
 * 2. **The budget is spent in order.** When `limit` cuts, it cuts at the end: what falls off is
 * the least preferred, not a random piece from each project.
 * 3. **The projects compete for the four spots** with the same standard: first the one with the
 * most verdicts with a mark, then the one with the most recent. The final tiebreaker is by
 * identity and with simple comparison — nothing like `localeCompare`, which depends on the
 * machine's ICU — so that two executions of the same catalog plan the same things in the three
 * systems of the CI matrix.
 * 4. **What has already been cited does not come back**, and this is what makes distillation
 * useful more than once. Without it, the three rules above are deterministic in the worst sense:
 * the second pass chooses exactly the same verdicts, the model writes the same sentences, the
 * deterministic identifier makes them clash with the rows that are already there, and nothing is
 * proposed. Measured in the author's catalog: 2,264 stored verdicts, 203 read in the first pass,
 * and a second that announced "203 verdicts"—the same ones—and would not have produced a single
 * new sentence. 91% of the corpus was unreachable.
 *
 * With the filter, rotation between projects happens naturally: when the verdicts with the signal
 * from the project with the most are exhausted, the next one goes up. There is no need for a turn
 * mechanism because the turn **is** having used up the material.
 */
export function planChunks(
  verdicts: DistillVerdict[],
  options: { limit?: number; skip?: ReadonlySet<string> } = {},
): DistillChunk[] {
  const skip = options.skip;
  const byIdentity = new Map<string, DistillVerdict[]>();
  for (const verdict of verdicts) {
    // What has already been mentioned does not return. See point 4 of header of this function.
    if (skip?.has(verdict.id)) continue;
    const group = byIdentity.get(verdict.identity);
    if (group) group.push(verdict);
    else byIdentity.set(verdict.identity, [verdict]);
  }

  const chunks: DistillChunk[] = [];
  for (const [identity, group] of byIdentity) {
    const taken = fill([...group].sort(preferred));
    if (taken.length > 0) chunks.push({ identity, verdicts: taken });
  }

  chunks.sort(
    (a, b) =>
      signalled(b) - signalled(a) ||
      newest(b) - newest(a) ||
      (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0),
  );

  return budget(chunks.slice(0, MAX_CHUNKS), options.limit ?? MAX_VERDICTS_PER_RUN);
}

/** What fits in a batch: by account and by characters, whichever runs out first. */
function fill(sorted: DistillVerdict[]): DistillVerdict[] {
  const taken: DistillVerdict[] = [];
  let chars = 0;

  for (const verdict of sorted) {
    if (taken.length >= CHUNK_VERDICTS) break;
    const weight = verdict.quote.length + (verdict.context?.length ?? 0);
    /*
      `break` and not `continue`: the list already comes in order of preference, so skipping a
      long appointment to fit two short ones behind it is putting two worse verdicts ahead of a
      better one. And the first one always goes in, even if on its own it exceeds the limit,
      because an empty batch is never fixed — that verdict does not shrink.
     */
    if (taken.length > 0 && chars + weight > CHUNK_CHARS) break;
    taken.push(verdict);
    chars += weight;
  }

  return taken;
}

/** Cut the plan to the appointment budget, spending it in the already decided order. */
function budget(chunks: DistillChunk[], limit: number): DistillChunk[] {
  let left = Math.min(limit, MAX_VERDICTS_PER_RUN);
  const kept: DistillChunk[] = [];

  for (const chunk of chunks) {
    if (left <= 0) break;
    const verdicts = chunk.verdicts.slice(0, left);
    left -= verdicts.length;
    kept.push({ identity: chunk.identity, verdicts });
  }

  return kept;
}

/** With a signal in front, and among equals the recent one. The `id` only breaks the tie. */
function preferred(a: DistillVerdict, b: DistillVerdict): number {
  const signal = Number(b.signals.length > 0) - Number(a.signals.length > 0);
  if (signal !== 0) return signal;
  const when = b.at.getTime() - a.at.getTime();
  if (when !== 0) return when;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function signalled(chunk: DistillChunk): number {
  return chunk.verdicts.filter((verdict) => verdict.signals.length > 0).length;
}

function newest(chunk: DistillChunk): number {
  return chunk.verdicts.reduce((top, verdict) => Math.max(top, verdict.at.getTime()), 0);
}

/** The labels of a batch: `c1`, `c2`, … in the order in which they will be read. */
export function labelChunk(chunk: DistillChunk): LabelledQuote[] {
  return chunk.verdicts.map((verdict, index) => ({ label: `c${index + 1}`, verdict }));
}

/**
 * The prompt of a batch.
 *
 * What is asked of the model fits in one sentence —'say what is repeated in these sentences'— and
 * what makes it useful are the prohibitions. They are written in the order in which they are
 * broken:
 *
 * - **Without two quotations there is no sentence.** It is the first thing because it is what
 * separates this from a horoscope, and it is checked again when parsing.
 * - **A statement that would be true for any programmer is true for no one.** "Prefers clean code"
 * is true of everyone, and therefore it says nothing. If, when reading it, this person cannot be
 * distinguished from the person next to them, it is unnecessary.
 * - **A feature is not a preference**, and it is the rule whose violation does harm instead of
 * noise. The others produce a line that says nothing; this one produces a line that says something
 * false to all agents of all projects, because the portrait is not filtered by project:
 * `tasteDigest` puts the entire accepted content into each `AGENTS.md`. The phrase that uncovered
 * it is real and was caught by the owner reading the review screen: «you want the application to
 * work like an audio tray to listen to posts while you work» —truth about the product where it was
 * said, and an absurd instruction for the adjacent application, which keeps a car's history—. The
 * test that is asked of the model is transferability: if the sentence stops making sense in
 * another one of its projects, it is not a taste. The corpus is full of requests for functionality
 * because that is what is said to an agent all day, so without this rule it is the dominant
 * material.
 * - **Preferences, not best practices.** 'Wants X,' not 'X is recommended.' The latter is a style
 * guide, and style guides already exist.
 * - **Their spelling is not their taste.** The corpus is written quickly and without accents —«no
 * me gusto», «quitalo», «asi»—: it is how they write at eleven at night, not a preference about
 * anything. Without this rule, half of the statements in the first test described how they ask
 * for things rather than what they ask for.
 *
 * The language of the statements is that of the viewer, not of the corpus: the quotes are keyboard
 * Spanish and the resulting sentence is read in the interface, which is in two languages. The
 * prompt itself remains in Spanish, like that of `describe` and `md/review` — it is the voice of
 * the house, not a surface.
 */
export function buildPrompt(chunk: DistillChunk): BuiltPrompt {
  const labelled = labelChunk(chunk);
  const labels = new Map(labelled.map(({ label, verdict }) => [label, verdict]));

  const quotes = wrapUntrusted(labelled.map(entryLines).join("\n\n"), {
    origin: "journal",
    limit: QUOTES_LIMIT,
  });

  const prompt = [
    "Abajo van citas literales de una persona reaccionando a lo que sus agentes de",
    "programación le entregaron, todas del mismo proyecto. Van numeradas —[c1], [c2],",
    "…— y cada una trae su fecha, las señales que detectó el motor y, cuando la había,",
    "la entrega que la provocó.",
    "",
    `Saca de dos a ${MAX_STATEMENTS} observaciones sobre cómo le gusta a ESTA persona que`,
    "quede su trabajo, escritas HABLÁNDOLE A ELLA: «quieres X», «no soportas Y».",
    "",
    "Reglas. Las dos primeras son eliminatorias:",
    `- Cada observación cita al menos ${MIN_CITATIONS} etiquetas de las de arriba, con su`,
    "  nombre exacto. Lo que no puedas sostener con dos citas no lo escribas: aquí sobra",
    "  una observación de menos y no sobra ninguna de más.",
    "- Una observación que sería verdad de cualquier programador no vale para nada.",
    "  «Prefiere el código limpio» no dice nada de nadie. Si al leerla no se distingue a",
    "  esta persona de la de al lado, tírala.",
    "- Una funcionalidad no es un gusto. «Quieres que la aplicación funcione como una",
    "  bandeja de audio para escuchar publicaciones mientras trabajas» describe qué hace ESE",
    "  producto, no cómo le gusta a esta persona que quede su trabajo. De una petición de",
    "  funcionalidad sí puedes sacar el gusto que lleve dentro —«que se vea limpio», «que no",
    "  cargue la pantalla»—; la funcionalidad en sí, no.",
    "- Habla de sus preferencias, no de buenas prácticas: «quieres X», nunca «conviene X».",
    "- Segunda persona siempre. Nada de «él», «ella» ni «esta persona» dentro de la",
    "  observación: quien va a leer esto es ella misma, en su propio retrato, y además no",
    "  sabes quién es. En tercera persona el modelo acaba eligiendo un género por su",
    "  cuenta, y en la misma tanda salieron «He wants» y «She wants» de la misma persona.",
    "- El material está escrito deprisa y sin acentos («no me gusto», «quitalo», «asi»).",
    "  Eso es cómo escribe, no lo que prefiere: ninguna observación sobre su ortografía ni",
    "  sobre su forma de pedir las cosas.",
    `- Una sola frase por observación, de ${MAX_STATEMENT_CHARS} caracteres como mucho.`,
    /*
      The language is dictated by the quotes and not by the person asking. It is the §2s
      arrangement lowered a floor: there a merge came out in English because the button was
      pressed from a browser in English and replaced two phrases in Spanish. Here it is worse,
      because the observation is the material from which everything else comes: a sweep done
      without the header of language left 260 observations in English over a corpus written in
      Spanish, and the entire portrait came out in a language that the person had not used even
      once.
     */
    "- Escribe cada observación en el mismo idioma en el que está escrita la cita que la",
    "  sostiene. No traduzcas: esas palabras las escribió ella.",
    "- No repitas la cita dentro de la observación; para eso van las citas aparte.",
    /*
      And not the labels within the sentence, which is a measured failure: the model wrote «You
      want enforced backend truth: o2,o5,o6,o7» and that string ended up in the portrait. It is
      requested here and cleaned below, like everything this file asks of a model.
     */
    "- No pongas las etiquetas dentro de la frase. Van solo en \"citations\".",
    "",
    /*
      Repeating oneself here is no longer a problem. Before, every sentence was a proposal that
      someone had to approve, so two ways of saying the same thing were two clicks of work, and
      the assignment carried the entire portrait inside so that the model wouldn't write them. Now
      this is evidence: that a belief appears five times in five batches is **exactly what the
      trust floor measures**. Putting them together is synthesis work, which sees them all at
      once; asking for it here, with sixty quotes from a single project in front of you, was
      asking it to deduce a portrait by looking through a crack.
     */
    "Repetir una idea que ya salió en otra tanda no es un problema: esto es material, no",
    "un resumen. Lo que se repite es justo lo que después se va a poder afirmar.",
    "",
    "Y cada observación dice DE QUÉ VA, con una sola de estas materias:",
    ...TOPICS.map((one) => `- ${one.name}: ${one.hint}.`),
    "",
    /*
      The vocabulary is deliberately open, and coining has to cost something or the model invents
      a substance by observation. The form —lowercase, one word, in English— is required by
      `topicOf` in the engine, so asking for it here is for the filter below to have something to
      accept instead of sending everything to the drawer.
     */
    "Si de verdad no encaja en ninguna, puedes escribir una materia nueva: una sola palabra",
    "en minúsculas y en inglés. Hazlo solo cuando la observación quede claramente peor en",
    "«other»; una materia nueva por observación no es una clasificación.",
    "",
    "Contesta con un array JSON y nada más: sin vallas de código, sin explicación delante",
    "ni detrás.",
    `[{"topic":"design","statement":"…","citations":["c3","c17"]}]`,
    "",
    "Si el material no da para ninguna observación, contesta []. Es una respuesta correcta",
    "y es mejor que una frase que no puedas sostener.",
    "",
    quotes,
  ].join("\n");

  return { chunk, system: SYSTEM, prompt, labels };
}

const SYSTEM = [
  "Eres un lector de las palabras de una sola persona. No eres un consultor de diseño ni un",
  "manual de estilo: tu único material son frases que esa persona escribió a sus agentes de",
  "programación mientras trabajaba, y tu único trabajo es decir qué se repite en ellas. Llano,",
  "concreto y sin adornos, y en el idioma en el que ella escribe.",
].join(" ");

/**
 * Remove from the end of a sentence the tags that the model has left hanging.
 *
 * Measured: with the entire corpus in front, one response brought
 * `You want enforced backend truth: o2,o5,o6,o7,o10,o11`, and that string ended up written in the
 * portrait. The tags travel in their own key and that is where they are read; within the sentence
 * they are noise that no agent can interpret and that the person cannot correct without erasing
 * the entire belief.
 *
 * Conservative on purpose, because this touches text that later is taught as yours. Only trim when
 * the tail is **unequivocally** a list of tags: either they are two or more, or it comes after a
 * colon, a dash, or a parenthesis. A lone `c3` at the end of a sentence really stays, which is the
 * good side to fail on — there is an extra noise and not half a sentence missing.
 */
export function stripLabels(statement: string, prefix: string): string {
  const label = `[${prefix}]\\d+`;
  // The separator supports a comma, semicolon, or simply a space: the model writes all three forms.
  // Anchored at the end, so a tag in the middle of a sentence does not trigger it.
  const cola = new RegExp(
    `(?:\\s*[:—–(-]\\s*)?\\(?\\b${label}\\b(?:[\\s,;]+(?:y|and)?[\\s]*\\b${label}\\b)*\\)?\\s*\\.?\\s*$`,
    "i",
  );
  const match = cola.exec(statement);
  if (match === null) return statement;

  const quitado = match[0];
  const etiquetas = quitado.match(new RegExp(`\\b${label}\\b`, "gi")) ?? [];
  const claro = etiquetas.length > 1 || /^[\s]*[:—–(-]/.test(quitado);
  if (!claro) return statement;

  const resto = statement.slice(0, match.index).trim().replace(/[:,;—–-]+$/, "").trim();
  // A sentence that was **just** tags is not fixed by trimming it: it stays as it was and falls
  // through the length filter or the quote filter, which is where it is decided to discard it.
  return resto === "" ? statement : resto;
}

/**
 * A quote just as the model sees it.
 *
 * From the date, only the day goes. The time tells nothing to anyone who does not already know the
 * answer, and it is twenty characters per appointment — twelve hundred per batch. The entire
 * instant continues to travel to the appointment that is kept, which is where it will indeed be
 * looked at.
 *
 * The delivery comes before the reaction because it happened earlier: reading them in reverse
 * forces you to jump back to understand what the 'no, not like that' was referring to.
 */
function entryLines({ label, verdict }: LabelledQuote): string {
  const signals = verdict.signals.length > 0 ? ` · ${verdict.signals.join(", ")}` : "";
  const head = `[${label}] ${verdict.at.toISOString().slice(0, 10)}${signals}`;
  const context = verdict.context ? `\n  le habían entregado: ${verdict.context}` : "";
  return `${head}${context}\n  dijo: ${verdict.quote}`;
}

/**
 * What it would cost to send this plan, in tokens and before sending it.
 *
 * It is measured on the prompts already built, not on a formula that approximates them: the
 * simulation assembles exactly what the execution would assemble and weighs it. A number that does
 * not describe what will actually be sent is useless for deciding whether to send it.
 *
 * `estimateTokens` is the one for the engine —`agentsmd.ts`, four characters per token, with the
 * line endings normalized so that Windows does not count differently— and it is an estimate, not a
 * measurement: no real tokenizer divides by four. It is useful for the order of magnitude, which
 * is the real question (“is this a thousand tokens or a hundred thousand?”).
 *
 * And it has no price. In this repository there isn't a single rate table, and putting one here
 * would be inventing a figure that ages every time a provider changes theirs, on the only screen
 * where the user is deciding whether to spend. A stale price is worse than no price: they can
 * multiply the tokens by the rate they are paying today.
 *
 * Count what comes in and not what goes out, because what goes out cannot be estimated — only
 * bounded, and it is bounded on the route with `maxTokens`.
 */
export function estimateRunTokens(prompts: BuiltPrompt[]): number {
  return prompts.reduce(
    (total, built) => total + estimateTokens(built.system) + estimateTokens(built.prompt),
    0,
  );
}

/**
 * An observation read from the response, with its citations already resolved to `id` of verdict.
 *
 * It no longer includes scope or substitutions, and the two absences are the increment. The scope
 * is decided by the synthesis by looking at how many projects the evidence comes from, which is a
 * fact and not an opinion; substituting was the way to prevent the portrait from growing with the
 * corpus, and now the synthesis does that by construction — there is nothing to substitute because
 * nothing has been published yet.
 */
export interface Observation {
  /** The matter. One of `TOPIC_NAMES`, or one coined by the model. */
  topic: string;
  statement: string;
  citations: string[];
  /** If the subject is not in the sown vocabulary: it was coined in this answer. */
  minted: boolean;
}

export interface ParseOutcome {
  observations: Observation[];
  /**
   * Entries in the form of observations that did not pass the filter. They are counted, they are
   * not saved.
   */
  dropped: number;
  /**
   * The answer was not an array of observations. There are no discards to count because there was
   * nothing to discard, which is different from 'everything it said was wrong'.
   */
  unreadable: boolean;
}

/**
 * Read the model's response. It never throws.
 *
 * `complete()` returns text, so the structure is a convention the model follows almost every
 * time. Almost. Four failure modes show up in any product that does this, and all four are handled
 * here: a response wrapped in a `json` code fence, a courtesy paragraph before the array, a
 * response cut off by the output limit, and a lone object where an array was requested.
 *
 * All four have the same outcome: zero observations and `unreadable`. **None throws.** Throwing
 * here would put a 502 in the user's face because the model added one extra comma, after the call
 * had already been charged.
 *
 * There is no salvage path. A truncated response is discarded in full even if its first three
 * entries are complete, because the fourth is unfinished and there is no way to know whether the
 * sentence we would save is the one the model intended to write. A lone object is not wrapped in
 * an array either: guessing which key was meant to be the list would be completing the response
 * on the model's behalf, which is exactly what this product does not do.
 */
export function parseObservations(
  text: string,
  labels: ReadonlyMap<string, DistillVerdict>,
): ParseOutcome {
  const parsed = readArray(text);
  if (parsed === undefined) return { observations: [], dropped: 0, unreadable: true };

  /*
    An array whose content does not have a single entry in the form of an observation is not a
    response with discards: it is something else that was also an array — the quotes of a loose
    object, a list of loose phrases. Counting it as ten discards would say that the model wrote
    ten things and none were good, which is not what happened.
   */
  if (parsed.length > 0 && !parsed.some(isRecord)) {
    return { observations: [], dropped: 0, unreadable: true };
  }

  const observations: Observation[] = [];
  let dropped = 0;

  for (const item of parsed) {
    const observation = asObservation(item, labels);
    if (observation === undefined) {
      dropped += 1;
      continue;
    }
    if (observations.length >= MAX_STATEMENTS) {
      dropped += 1;
      continue;
    }
    observations.push(observation);
  }

  return { observations, dropped, unreadable: false };
}

/**
 * The array JSON that is inside the response, or nothing.
 *
 * Two attempts, in this order. First the entire text, now without fences: this is the normal case
 * and it is also what distinguishes a loose object from an array, because it parses and you can
 * see that it is not what was requested. And only if that fails, the first `[` is searched for and
 * brackets are counted until the one that closes it, respecting strings and their escapes —
 * without that, a `]` inside a quote would close the array prematurely. If it never closes, the
 * response was cut off and there is no array to return.
 */
function readArray(text: string): unknown[] | undefined {
  const clean = stripFences(text).trim();

  try {
    const whole: unknown = JSON.parse(clean);
    return Array.isArray(whole) ? whole : undefined;
  } catch {
    // The model said something before the array, or after. It is searched by hand.
  }

  /*
    And **all** the brackets are searched for, not just the first one.
    The first `[` was tested, and if the piece up to its closure did not parse, "unreadable" was
    returned with the good array intact two lines below. The task shows the tags in brackets, so
    the typical preamble carries them: "Based on [c3] and [c7]:" already triggers the entire
    response. Any prose bracket works the same — "Here are [8 in total]:".
   */
  for (let start = clean.indexOf("["); start !== -1; start = clean.indexOf("[", start + 1)) {
    const found = arrayAt(clean, start);
    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * The array that starts at `start`, if it exists and if it parses.
 *
 * Advance counting brackets until the one that closes it, respecting strings and their escapes:
 * without that, a `]` inside a quote would close the array prematurely. If it never closes, the
 * response came cut off and there is nothing to return.
 */
function arrayAt(clean: string, start: number): unknown[] | undefined {
  let depth = 0;
  let inString = false;
  for (let i = start; i < clean.length; i += 1) {
    const char = clean[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          const found: unknown = JSON.parse(clean.slice(start, i + 1));
          return Array.isArray(found) ? found : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

function stripFences(text: string): string {
  const fence = /```(?:[a-zA-Z]+)?\n([\s\S]*?)```/.exec(text);
  return fence?.[1] ?? text;
}

/**
 * A proposal understood, or nothing.
 *
 * The citation filter is the one that matters and works like this: from each element of the
 * citation array, all the tags in the form `cN` are extracted —there are models that write `"c3"`,
 * others `"[c3]"`, and others put two in the same string— and each one is resolved against the
 * ones that were actually sent. Those that do not resolve disappear silently; what is checked is
 * what remains. If fewer than `MIN_CITATIONS` distinct ones remain, the entire statement falls: it
 * is not saved halfway or saved without citations.
 *
 * The sentence collapses into one line, and that does not contradict the part about not touching
 * the text. What is not touched are the quotes, which are yours. This was written by a model and
 * ends up in a file of lines —`renderTaste`—, where a line break within the sentence would split
 * it into two and the second half would be read as something else.
 */
function asObservation(
  item: unknown,
  labels: ReadonlyMap<string, DistillVerdict>,
): Observation | undefined {
  if (!isRecord(item)) return undefined;

  const dicho = text(item["statement"])?.replace(/\s+/g, " ").trim();
  const statement = dicho === undefined ? undefined : stripLabels(dicho, "c");
  if (!statement || statement.length > MAX_STATEMENT_CHARS) return undefined;

  const topic = topicOf(item["topic"]);

  const cited = item["citations"];
  if (!Array.isArray(cited)) return undefined;

  const citations = new Set<string>();
  for (const one of cited) {
    if (typeof one !== "string") continue;
    // With word boundaries: without them, a `c17` inside something else —the end of a sha1, for
    // example— would resolve against a tag that the model did not quote.
    for (const match of one.toLowerCase().matchAll(/\bc\d+\b/g)) {
      const verdict = labels.get(match[0]);
      if (verdict) citations.add(verdict.id);
    }
  }
  if (citations.size < MIN_CITATIONS) return undefined;

  return { ...topic, statement, citations: [...citations] };
}

/**
 * The subject that the model mentioned, or the drawer.
 *
 * This is where open vocabulary is paid for, and it is paid with a form check instead of with a
 * whitelist. A whitelist would send any subject that the model coined to `other`, meaning that the
 * permission to coin would be a lie; without any check, `## Notas de la App Store (2026)` would be
 * a subject and the portrait would end up with thirty one-line sections.
 *
 * The form is the same as required by `topicOf` in the engine —a short lowercase word— because
 * whatever is written here ends up being a header of `TASTE.md`, and a subject that the file
 * cannot read would be lost in the first round trip.
 *
 * `minted` comes out here and not from comparing later: whoever reads the answer is the only one
 * who knows if the name was on the list that was shown to the model.
 */
function topicOf(value: unknown): { topic: string; minted: boolean } {
  const named = text(value)?.trim().toLowerCase().replace(/[.:]+$/, "") ?? "";
  if (TOPIC_NAMES.includes(named)) return { topic: named, minted: false };
  if (/^[a-z][a-z0-9-]{0,23}$/.test(named)) return { topic: named, minted: true };
  return { topic: "other", minted: false };
}

/** What has been understood about the limit requested by the caller. */
export type LimitRead =
  | { kind: "unset" }
  | { kind: "limit"; limit: number }
  | { kind: "bad"; value: string };

/**
 * The limit of a request, or the reason for rejecting it.
 *
 * Three answers and not two, for the same reason as `readBatch`: a limit that is not understood
 * must be able to be explained to the one who wrote it, with its value in front, and "the limit is
 * missing" and "the limit is 'fifty'" ask for different things.
 *
 * The string `"50"` is accepted in addition to the number, because this form is handwritten by the
 * person testing with `curl` and JSON, it does not forgive that quote. What is not accepted is
 * `"cincuenta"`, nor zero, nor a decimal, nor exceeding the ceiling: asking for more than what
 * fits is an expectation that must be corrected before spending, not silently afterwards.
 *
 * It lives in this file because it is part of the parts that are tested, and it is also used by
 * the GET of verdicts: a badly read limit is the same failure in both paths and there is no two
 * ways to read it.
 */
export function readLimit(value: unknown, cap: number): LimitRead {
  if (value === undefined || value === null || value === "") return { kind: "unset" };

  const limit = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > cap) {
    return { kind: "bad", value: typeof value === "string" ? value : String(value) };
  }

  return { kind: "limit", limit };
}

/** A string with something inside, or nothing. The empty one counts as absent, as in `verdicts.ts`. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
