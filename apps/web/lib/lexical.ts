/*
  Lexical matching, and why it is the only ranking this house runs on its own.

  Three readers rank text by the words it shares with a question: the Lab picks the beliefs for
  a rehearsal, the Lab picks the episodes that count as evidence, and since 6-Sep-2026 the agent
  briefing picks the sleeping notes and owner decisions whose words overlap a task. All three
  used to share `terms()` by copy, which is how the stop-word list would have drifted the first
  time somebody fixed it in one place.

  The ranking is deterministic and free on purpose: no model, no embeddings, nothing that gives
  two different answers to the same question. What it returns is an *overlap of words*, and every
  consumer says so to whoever reads the result — a shared word is a reason to read a rule, never
  proof that it applies. The model, or the person, still decides.
 */

/**
 * Words too common to tell one text from another, in the two languages the notes are written in.
 * Kept small: a stop list that grows with every false match ends up eating the vocabulary.
 */
export const STOP_WORDS = new Set((
  "a an and are as at be by can do does for from how i in is it its of on or our should that the " +
  "their this to use we what when which with would you your al como con cual cuando de del debe " +
  "deberia el en es esta este esto hacer la las lo los me mi o para por que se si sin su sus un " +
  "una usar y yo prefer prefers prefiere"
).split(" "));

/**
 * The words of a text: diacritics folded, lowercased, single letters and stop words dropped,
 * numbers kept. A port number or a version is often the most telling word in a task.
 */
export function terms(text: string): Set<string> {
  return new Set(
    text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)) ?? [],
  );
}

/** How many of the documents contain each term. The denominator of every weight. */
export function documentFrequency(documents: Iterable<Set<string>>): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of document) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  return frequency;
}

/**
 * What one shared word is worth: a word every candidate carries is worth little more than one,
 * a word only one candidate carries is worth the most. The same formula the Lab has used for
 * beliefs since it existed, so the two readers agree on what "rare" means.
 */
export function termWeight(candidates: number, frequency: number): number {
  return 1 + Math.log(1 + candidates / frequency);
}

export interface LexicalMatch {
  /** The sum of the weights of the shared words. Zero when nothing is shared. */
  score: number;
  /** The shared words, rarest first, so the first one is the best reason to read the document. */
  matched: string[];
}

/**
 * Score one document against a query. `frequency` and `candidates` describe the pool the document
 * was drawn from, which is what makes a weight comparable between two documents of that pool.
 */
export function lexicalMatch(
  query: Set<string>,
  document: Set<string>,
  frequency: Map<string, number>,
  candidates: number,
): LexicalMatch {
  const shared: { term: string; weight: number }[] = [];
  for (const term of query) {
    if (!document.has(term)) continue;
    shared.push({ term, weight: termWeight(candidates, frequency.get(term) ?? 1) });
  }
  // Alphabetical ties: two calls with the same words must name them in the same order.
  shared.sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
  return {
    score: shared.reduce((sum, one) => sum + one.weight, 0),
    matched: shared.map((one) => one.term),
  };
}
