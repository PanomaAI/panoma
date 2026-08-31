import { describe, expect, it } from "vitest";
import {
  CHUNK_CHARS,
  CHUNK_VERDICTS,
  MAX_CHUNKS,
  MAX_STATEMENTS,
  MAX_STATEMENT_CHARS,
  MAX_VERDICTS_PER_RUN,
  buildPrompt,
  estimateRunTokens,
  parseObservations,
  planChunks,
  readLimit,
  type DistillVerdict,
} from "./distill";

/**
 * The prompt and what is accepted from the response, which is where the promise lives.
 *
 * Only the pure is tested and only the pure: neither server, nor database, nor model. The route
 * does nothing more than read verdicts, call `complete`, and save whatever comes out of here —
 * testing it would require a database in front so as not to check anything new —, while the three
 * decisions that can turn this into an expensive horoscope are made in this file: which quotes are
 * sent, how they arrive, and what is accepted back.
 *
 * Of the three, the one with the most tests is the last one, and not without reason. A model
 * answer is text: it comes wrapped in code fences, with a courtesy paragraph in front, cut in half
 * by the output limit, or in the form it seemed fit. None of those four can launch, because
 * launching here is a 502 in the user's face **after** having charged them for the call.
 */

const IDENTITY = "git:2f1c9b0e";

function verdict(extra: Partial<DistillVerdict> = {}): DistillVerdict {
  return {
    id: "a1",
    identity: IDENTITY,
    at: new Date("2026-08-20T23:14:02.511Z"),
    quote: "no, asi no: dejalo como estaba",
    context: "He cambiado el verde del boton por el de la marca.",
    signals: ["rejection", "redo"],
    ...extra,
  };
}

/** Many identical verdicts except in what the test looks at. */
function many(
  count: number,
  extra: (index: number) => Partial<DistillVerdict>,
): DistillVerdict[] {
  return Array.from({ length: count }, (_unused, index) =>
    verdict({ id: `v${index}`, ...extra(index) }),
  );
}

describe("el reparto en tandas", () => {
  it("las citas con señal van delante de las que no la tienen", () => {
    const plan = planChunks([
      verdict({ id: "sin", signals: [], at: new Date("2026-08-21T10:00:00.000Z") }),
      verdict({ id: "con", signals: ["praise"], at: new Date("2020-01-01T10:00:00.000Z") }),
    ]);

    // And that is true even when the one without signal is a year and a half newer: 204 out of
    // 3,442 reactions show signal, so the long tail would fill the entire batch.
    expect(plan[0]?.verdicts.map((one) => one.id)).toEqual(["con", "sin"]);
  });

  it("y entre dos con señal, la reciente", () => {
    const plan = planChunks([
      verdict({ id: "vieja", at: new Date("2025-02-03T10:00:00.000Z") }),
      verdict({ id: "nueva", at: new Date("2026-08-19T10:00:00.000Z") }),
    ]);

    expect(plan[0]?.verdicts.map((one) => one.id)).toEqual(["nueva", "vieja"]);
  });

  it("una tanda no pasa de las citas que caben por cuenta", () => {
    const plan = planChunks(many(CHUNK_VERDICTS + 40, () => ({ quote: "quitalo" })));

    expect(plan).toHaveLength(1);
    expect(plan[0]?.verdicts).toHaveLength(CHUNK_VERDICTS);
  });

  it("ni de las que caben por caracteres, aunque sobre sitio por cuenta", () => {
    // Ten quotes of 2,240 characters —the worst case left by the parser— fit by account and not by
    // weight: sixty of these would be 134,000 characters in a single call.
    const gorda = "x".repeat(2_000);
    const plan = planChunks(
      many(CHUNK_VERDICTS, () => ({ quote: gorda, context: "y".repeat(240) })),
    );

    const chars = (plan[0]?.verdicts ?? []).reduce(
      (total, one) => total + one.quote.length + (one.context?.length ?? 0),
      0,
    );
    expect(plan[0]?.verdicts.length).toBeLessThan(CHUNK_VERDICTS);
    expect(chars).toBeLessThanOrEqual(CHUNK_CHARS);
  });

  it("pero la cita que ella sola se pasa del tope entra igual, o la tanda nace vacía", () => {
    const plan = planChunks([verdict({ quote: "x".repeat(CHUNK_CHARS + 1_000) })]);

    expect(plan).toHaveLength(1);
    expect(plan[0]?.verdicts).toHaveLength(1);
  });

  it("cada proyecto va en su tanda: el gusto no es el mismo en la web que en el CLI", () => {
    const plan = planChunks([
      verdict({ id: "a", identity: "git:aaaa" }),
      verdict({ id: "b", identity: "git:bbbb" }),
    ]);

    expect(plan).toHaveLength(2);
    expect(plan.map((chunk) => chunk.verdicts.length)).toEqual([1, 1]);
  });

  it("y no se planean más tandas de las que hace una ejecución", () => {
    const projects = many(MAX_CHUNKS + 6, (index) => ({ identity: `git:${index}` }));
    const plan = planChunks(projects);

    expect(plan).toHaveLength(MAX_CHUNKS);
  });

  it("manda el proyecto con más citas con señal", () => {
    const plan = planChunks([
      ...many(3, () => ({ identity: "git:mucho" })),
      verdict({ id: "solo", identity: "git:poco", signals: [] }),
    ]);

    expect(plan[0]?.identity).toBe("git:mucho");
  });

  it("el tope de la petición se gasta en orden, recortando por el final", () => {
    const plan = planChunks(
      [
        ...many(3, () => ({ identity: "git:primero" })),
        ...many(3, (index) => ({ id: `s${index}`, identity: "git:segundo", signals: [] })),
      ],
      { limit: 4 },
    );

    // Four quotes: three from the preferred project and one from the next. Sharing them equally
    // would leave out verdicts better than those included.
    expect(plan.map((chunk) => chunk.verdicts.length)).toEqual([3, 1]);
  });

  it("y nunca se pasa del techo de la ejecución, pida quien pida lo que pida", () => {
    const plan = planChunks(
      many(MAX_VERDICTS_PER_RUN * 2, (index) => ({ identity: `git:${index % MAX_CHUNKS}` })),
      { limit: 10_000 },
    );

    const total = plan.reduce((count, chunk) => count + chunk.verdicts.length, 0);
    expect(total).toBe(MAX_VERDICTS_PER_RUN);
  });

  it("el plan no depende del orden en el que lleguen los veredictos", () => {
    const entrada = [
      verdict({ id: "a", identity: "git:uno" }),
      verdict({ id: "b", identity: "git:dos", signals: [] }),
      verdict({ id: "c", identity: "git:uno" }),
    ];
    const derecho = planChunks(entrada);
    const revés = planChunks([...entrada].reverse());

    expect(revés.map((one) => one.identity)).toEqual(derecho.map((one) => one.identity));
  });
});

describe("el prompt", () => {
  const chunk = { identity: IDENTITY, verdicts: [verdict(), verdict({ id: "a2" })] };

  it("la cita llega byte a byte: aquí no se tacha nada", () => {
    /*
      The drafting already occurred in the parser, before the truncation, which is the only
      correct order. A second pass here would not cover anything new and would indeed mess up
      quotes: the `quotes.ts` table was fine-tuned over 2,137 real turns to stop marking paths,
      SHA, and checksums, and this quote includes the first two.
     */
    const quote = "no me gusto el commit 4f2a1b9 de apps/web/lib/i18n.ts, quitalo";
    const built = buildPrompt({ identity: IDENTITY, verdicts: [verdict({ quote })] });

    expect(built.prompt).toContain(quote);
  });

  it("la entrega también, y va delante de la reacción porque ocurrió antes", () => {
    const built = buildPrompt(chunk);
    const entrega = built.prompt.indexOf("He cambiado el verde");
    const reaccion = built.prompt.indexOf("no, asi no");

    expect(entrega).toBeGreaterThan(-1);
    expect(entrega).toBeLessThan(reaccion);
  });

  it("las citas van envueltas como material sin verificar", () => {
    // They are yours, but this prompt can end in `claude -p` with tools and with your drive in
    // front. The same border as README of `describe`.
    const built = buildPrompt(chunk);

    expect(built.prompt).toContain("<untrusted_data");
    expect(built.prompt).toContain("</untrusted_data>");
  });

  it("cada cita lleva una etiqueta corta, y el mapa la devuelve al veredicto", () => {
    const sha = "8f14e45fceea167a5a36dedd4bea2543a1b2c3d4";
    const built = buildPrompt({ identity: IDENTITY, verdicts: [verdict({ id: sha }), verdict({ id: "a2" })] });

    expect(built.prompt).toContain("[c1]");
    expect(built.prompt).toContain("[c2]");
    expect(built.labels.get("c1")?.id).toBe(sha);
    expect(built.labels.get("c2")?.id).toBe("a2");
    // The sha1 of the verdict is not shown to the model: it has form, and a form is imitated. Forty
    // invented hexadecimals look like a quote; `c17` is on the list or it is not.
    expect(built.prompt).not.toContain(sha);
  });

  it("la regla eliminatoria de las dos citas está escrita, no solo comprobada", () => {
    const built = buildPrompt(chunk);

    expect(built.prompt).toContain("eliminatorias");
    expect(built.prompt).toContain("al menos 2 etiquetas");
  });

  it("y la de que una frase que valdría para cualquiera no vale para nadie", () => {
    const built = buildPrompt(chunk);

    expect(built.prompt).toContain("cualquier programador");
  });


  it("las señales van con la cita, y la que no tiene ninguna no arrastra separador", () => {
    const built = buildPrompt({ identity: IDENTITY, verdicts: [verdict(), verdict({ id: "a2", signals: [] })] });

    expect(built.prompt).toContain("rejection, redo");
    expect(built.prompt).toContain("[c2] 2026-08-20\n");
  });
});

describe("la respuesta del modelo, que es texto y puede ser cualquier cosa", () => {
  const chunk = {
    identity: IDENTITY,
    verdicts: [verdict({ id: "uno" }), verdict({ id: "dos" }), verdict({ id: "tres" })],
  };
  const { labels } = buildPrompt(chunk);

  const buena =
    `[{"topic":"design","statement":"Quiere el boton de volver donde estaba",` +
    `"citations":["c1","c2"]}]`;

  /*
    The array retrieval tested only the **first** bracket, and if that piece didn't parse, it
    threw the entire response. The task shows the tags in brackets, so the typical preamble
    includes them: «Based on [c1] and [c2]:» was enough to lose an already paid batch.
   */
  it("un corchete en el preámbulo no se lleva por delante el array", () => {
    const salida = parseObservations(`Basándome en [c1] y [c2]:\n${buena}`, labels);
    expect(salida.observations).toHaveLength(1);
    expect(salida.unreadable).toBe(false);
  });

  it("ni dos corchetes, ni uno con prosa dentro", () => {
    const salida = parseObservations(`Aquí van [1 en total] y [c1]:\n${buena}`, labels);
    expect(salida.observations).toHaveLength(1);
  });

  it("un array pelado se lee", () => {
    const salida = parseObservations(buena, labels);

    expect(salida.unreadable).toBe(false);
    expect(salida.observations).toHaveLength(1);
    expect(salida.observations[0]?.topic).toBe("design");
  });

  it("dentro de una valla de código, también", () => {
    const salida = parseObservations("```json\n" + buena + "\n```", labels);

    expect(salida.observations).toHaveLength(1);
  });

  it("con un párrafo de cortesía delante, también", () => {
    const salida = parseObservations(`Claro, aqui van las afirmaciones:\n\n${buena}`, labels);

    expect(salida.observations).toHaveLength(1);
  });

  it("y con explicación detrás", () => {
    const salida = parseObservations(`${buena}\n\nEspero que te sirva.`, labels);

    expect(salida.observations).toHaveLength(1);
  });

  it("cortada por el tope de salida: cero propuestas, y no lanza", () => {
    const cortada =
      `[{"topic":"design","statement":"Quiere el boton","citations":["c1","c2"]},{"top`;
    const salida = parseObservations(cortada, labels);

    // The first entry is not recovered even if it is complete: the next one is halfway and there is
    // no way to know what it was going to say.
    expect(salida.unreadable).toBe(true);
    expect(salida.observations).toEqual([]);
    expect(salida.dropped).toBe(0);
  });

  it("un objeto en vez de un array: cero propuestas, y no lanza", () => {
    const objeto = `{"topic":"design","statement":"Quiere el boton","citations":["c1","c2"]}`;
    const salida = parseObservations(objeto, labels);

    // It doesn't wrap itself in an array on its own: guessing which of its keys was the list is
    // starting to complete the answer for the model.
    expect(salida.unreadable).toBe(true);
    expect(salida.observations).toEqual([]);
  });

  it("un objeto con la lista dentro tampoco se desenvuelve", () => {
    const envuelto =
      `{"proposals":[{"topic":"design","statement":"Quiere esto","citations":["c1","c2"]}]}`;
    const salida = parseObservations(envuelto, labels);

    expect(salida.unreadable).toBe(true);
    expect(salida.observations).toEqual([]);
  });

  it("texto que no es JSON en absoluto: cero propuestas, y no lanza", () => {
    const salida = parseObservations("No he encontrado ningun patron en estas citas.", labels);

    expect(salida.unreadable).toBe(true);
    expect(salida.observations).toEqual([]);
  });

  it("un array vacío es una respuesta correcta, no una respuesta ilegible", () => {
    const salida = parseObservations("[]", labels);

    expect(salida.unreadable).toBe(false);
    expect(salida.observations).toEqual([]);
    expect(salida.dropped).toBe(0);
  });

  it("una cadena vacía no revienta nada", () => {
    expect(() => parseObservations("", labels)).not.toThrow();
    expect(parseObservations("", labels).unreadable).toBe(true);
  });
});

describe("las citas son la única prueba", () => {
  const chunk = {
    identity: IDENTITY,
    verdicts: [verdict({ id: "uno" }), verdict({ id: "dos" }), verdict({ id: "tres" })],
  };
  const { labels } = buildPrompt(chunk);

  it("una afirmación que cita una etiqueta que nunca se mandó se cae entera", () => {
    const salida = parseObservations(
      `[{"topic":"design","statement":"Quiere esto","citations":["c9","c10"]}]`,
      labels,
    );

    expect(salida.observations).toEqual([]);
    expect(salida.dropped).toBe(1);
    expect(salida.unreadable).toBe(false);
  });

  it("y la que solo resuelve una de las dos, también: una cita es una anécdota", () => {
    const salida = parseObservations(
      `[{"topic":"design","statement":"Quiere esto","citations":["c1","c99"]}]`,
      labels,
    );

    expect(salida.observations).toEqual([]);
    expect(salida.dropped).toBe(1);
  });

  it("la misma cita dos veces cuenta una vez", () => {
    const salida = parseObservations(
      `[{"topic":"design","statement":"Quiere esto","citations":["c1","c1"]}]`,
      labels,
    );

    expect(salida.observations).toEqual([]);
  });

  it("las citas vuelven como id de veredicto, que es lo que se puede guardar", () => {
    const salida = parseObservations(
      `[{"topic":"design","statement":"Quiere esto","citations":["c1","c3"]}]`,
      labels,
    );

    expect(salida.observations[0]?.citations).toEqual(["uno", "tres"]);
  });

  it("se admiten los corchetes y las mayúsculas que escriben algunos modelos", () => {
    const salida = parseObservations(
      `[{"topic":"design","statement":"Quiere esto","citations":["[C1]","[c2]"]}]`,
      labels,
    );

    expect(salida.observations[0]?.citations).toEqual(["uno", "dos"]);
  });

  it("y las dos metidas en la misma cadena", () => {
    const salida = parseObservations(
      `[{"topic":"design","statement":"Quiere esto","citations":["c1, c2"]}]`,
      labels,
    );

    expect(salida.observations[0]?.citations).toEqual(["uno", "dos"]);
  });

  /*
    A rare subject **does not** discard the observation, unlike before with the sections. The
    difference is what is lost: there the section was part of the statement and a bad one would
    later slip through on the screen; here, discarding it would throw away the entire observation
    with its citations, and a lost observation is evidence that does not return. It falls into the
    drawer, where it can be seen and repositioned with a pass of the indexer.
   */
  it("una materia ilegible no tira la observación: cae en el cajón", () => {
    const salida = parseObservations(
      `[{"topic":"lo que sea con espacios","statement":"Quiere esto","citations":["c1","c2"]}]`,
      labels,
    );

    expect(salida.observations[0]?.topic).toBe("other");
    expect(salida.dropped).toBe(0);
  });

  it("una frase más larga de lo que cabe en el perfil se cae", () => {
    const larga = "a".repeat(MAX_STATEMENT_CHARS + 1);
    const salida = parseObservations(
      `[{"topic":"design","statement":"${larga}","citations":["c1","c2"]}]`,
      labels,
    );

    expect(salida.observations).toEqual([]);
    expect(salida.dropped).toBe(1);
  });

  it("una frase con saltos de línea se colapsa: el perfil es un fichero de líneas", () => {
    const salida = parseObservations(
      `[{"topic":"design","statement":"Quiere\\nesto\\n  y lo otro","citations":["c1","c2"]}]`,
      labels,
    );

    expect(salida.observations[0]?.statement).toBe("Quiere esto y lo otro");
  });

  it("las que pasan del tope de afirmaciones se cuentan como descartadas", () => {
    const una = (index: number) =>
      `{"topic":"design","statement":"Quiere la cosa numero ${index}","citations":["c1","c2"]}`;
    const muchas = Array.from({ length: MAX_STATEMENTS + 3 }, (_unused, i) => una(i)).join(",");
    const salida = parseObservations(`[${muchas}]`, labels);

    expect(salida.observations).toHaveLength(MAX_STATEMENTS);
    expect(salida.dropped).toBe(3);
  });

  it("una entrada rota no se lleva por delante a las que sí valen", () => {
    const salida = parseObservations(
      `[{"topic":"cli","statement":"","citations":["c1","c2"]},` +
        `{"topic":"cli","statement":"Quiere las cifras juntas","citations":["c1","c2"]}]`,
      labels,
    );

    expect(salida.observations).toHaveLength(1);
    expect(salida.dropped).toBe(1);
  });
});

describe("el coste, enseñado antes de gastarlo", () => {
  const chunk = { identity: IDENTITY, verdicts: [verdict(), verdict({ id: "a2" })] };

  it("se cuentan el prompt y el sistema, que también viaja", () => {
    const built = buildPrompt(chunk);
    const esperado =
      Math.ceil(built.system.length / 4) + Math.ceil(built.prompt.length / 4);

    expect(estimateRunTokens([built])).toBe(esperado);
  });

  it("cuatro caracteres por token, la misma cuenta que el motor hace de un AGENTS.md", () => {
    const built = buildPrompt(chunk);
    const chars = built.system.length + built.prompt.length;
    const tokens = estimateRunTokens([built]);

    expect(tokens).toBeGreaterThan(chars / 4 - 2);
    expect(tokens).toBeLessThan(chars / 4 + 2);
  });

  it("dos tandas cuestan más que una: el simulacro pesa el plan entero", () => {
    const built = buildPrompt(chunk);

    expect(estimateRunTokens([built, built])).toBeGreaterThan(estimateRunTokens([built]));
    expect(estimateRunTokens([])).toBe(0);
  });
});

describe("el tope que pide quien llama", () => {
  it("sin tope no hay tope: lo acotan las constantes de la destilación", () => {
    expect(readLimit(undefined, MAX_VERDICTS_PER_RUN)).toEqual({ kind: "unset" });
    expect(readLimit(null, MAX_VERDICTS_PER_RUN)).toEqual({ kind: "unset" });
  });

  it("un entero dentro del techo se acepta", () => {
    expect(readLimit(50, MAX_VERDICTS_PER_RUN)).toEqual({ kind: "limit", limit: 50 });
  });

  it("y la cadena que lo escribe, porque este cuerpo se teclea con curl", () => {
    expect(readLimit("50", MAX_VERDICTS_PER_RUN)).toEqual({ kind: "limit", limit: 50 });
  });

  it("lo que no es un número se rechaza con su valor delante, no se ignora", () => {
    expect(readLimit("cincuenta", 240)).toEqual({ kind: "bad", value: "cincuenta" });
  });

  it("ni el cero, ni los negativos, ni los decimales", () => {
    expect(readLimit(0, 240).kind).toBe("bad");
    expect(readLimit(-3, 240).kind).toBe("bad");
    expect(readLimit(2.5, 240).kind).toBe("bad");
  });

  it("pedir más de lo que cabe es una expectativa que se corrige antes de gastar", () => {
    expect(readLimit(MAX_VERDICTS_PER_RUN + 1, MAX_VERDICTS_PER_RUN).kind).toBe("bad");
  });
});

/**
 * What has already been read does not return, which is the only thing that makes distilling serve
 * more than once.
 *
 * Without this filter, the distribution rules are deterministic in the worst sense: the second
 * pass chooses exactly the same verdicts, the model writes the same sentences, the deterministic
 * identifier makes them clash with the rows already decided, and nothing is proposed. Measured in
 * the author's catalog: 2,264 verdicts stored, 203 read in the first pass, and a second that
 * announced '203 verdicts' — the same ones.
 */
describe("destilar avanza sobre el corpus", () => {
  it("lo ya leído no se vuelve a mandar", () => {
    const todos = many(6, (index) => ({ quote: `frase ${index}` }));
    const leidos = new Set(["v0", "v1", "v2"]);

    const plan = planChunks(todos, { skip: leidos });
    const mandados = plan.flatMap((chunk) => chunk.verdicts.map((one) => one.id));

    expect(mandados).toEqual(["v3", "v4", "v5"]);
  });

  /*
    The regression that matters: two consecutive runs cannot choose the same thing. You plan, mark
    what came out, and plan again — which is exactly what the route does.
   */
  it("dos pasadas seguidas no comparten ni una cita", () => {
    const todos = many(CHUNK_VERDICTS + 20, (index) => ({ quote: `frase ${index}` }));

    const primera = planChunks(todos).flatMap((chunk) => chunk.verdicts.map((one) => one.id));
    const segunda = planChunks(todos, { skip: new Set(primera) }).flatMap((chunk) =>
      chunk.verdicts.map((one) => one.id),
    );

    expect(primera.length).toBeGreaterThan(0);
    expect(segunda.length).toBeGreaterThan(0);
    expect(segunda.filter((id) => primera.includes(id))).toEqual([]);
  });

  /*
    When the project with the most signal is exhausted, the next one goes up. A turn mechanism is
    not necessary: the turn is having used up the material.
   */
  it("al agotarse un proyecto sube el siguiente", () => {
    const grande = many(3, (index) => ({ id: `g${index}`, identity: "git:grande" }));
    const pequeno = many(1, () => ({ id: "p0", identity: "git:pequeno", signals: [] }));

    const primera = planChunks([...grande, ...pequeno]);
    expect(primera[0]!.identity).toBe("git:grande");

    const segunda = planChunks([...grande, ...pequeno], {
      skip: new Set(["g0", "g1", "g2"]),
    });
    expect(segunda.map((chunk) => chunk.identity)).toEqual(["git:pequeno"]);
  });

  it("con todo leído no queda ninguna tanda que mandar", () => {
    const todos = many(4, (index) => ({ quote: `frase ${index}` }));
    const plan = planChunks(todos, { skip: new Set(todos.map((one) => one.id)) });
    expect(plan).toEqual([]);
  });

  it("sin el filtro nada cambia: es un añadido, no un cambio de reparto", () => {
    const todos = many(10, (index) => ({ quote: `frase ${index}` }));
    expect(planChunks(todos, { skip: new Set() })).toEqual(planChunks(todos));
  });
});

/**
 * The rule that prevents the portrait from being filled with functionalities.
 *
 * It is the only one of the three eliminations whose non-compliance causes **harm** and not noise.
 * The other two produce a line that says nothing; this one produces a line that says something
 * false to all agents of all projects, because the portrait is not filtered by project:
 * `tasteDigest` puts the entire accepted content into each `AGENTS.md`. The phrase that revealed
 * it is real —"you want the application to function like an audio tray to listen to posts while
 * you work"—: truth about the product where it was said, and an absurd instruction for the person
 * next to it, who keeps the history of a car.
 *
 * A test on a prompt cannot verify that the model complies. What it does verify is that the rule
 * is still in place: the first version of this distiller did not have it, and without it the
 * dominant material of the corpus is requests for functionality, because that is what an agent is
 * told all day.
 */
describe("una funcionalidad no es un gusto", () => {
  const chunk = { identity: IDENTITY, verdicts: [verdict(), verdict({ id: "a2" })] };
  const built = buildPrompt(chunk);

  /*
    The language is dictated by the quotes and not by the person asking. It is the arrangement of
    §2s lowered by one level, and here it hurts more: observation is the material from which
    everything else comes. A sweep done without the header of language left 260 observations in
    English on a corpus written in Spanish, and the entire portrait came out in a language that
    the person had not used even once.
   */
  it("no fija ningún idioma: lo mandan las citas", () => {
    expect(built.prompt).toContain("el mismo idioma en el que está escrita la cita");
    expect(built.prompt).toContain("No traduzcas");
    /*
      “in English” does appear, and it is not the language of the sentence: it is the form that
      the name of a coined subject must have, which is an identifier and ends as a header in the
      file. What cannot appear is a command about the language of what is written.
     */
    expect(built.prompt).not.toContain("Escribe las observaciones en");
    expect(built.prompt).not.toContain("en castellano");
    expect(built.system).not.toContain("castellano");
    expect(built.system).not.toContain("inglés");
  });

  it("la regla va antes de la materia, donde se lee al escribir la frase", () => {
    const regla = built.prompt.indexOf("Una funcionalidad no es un gusto");
    const materia = built.prompt.indexOf("cada observación dice DE QUÉ VA");
    expect(regla).toBeGreaterThan(-1);
    expect(regla).toBeLessThan(materia);
  });

  /*
    And it says why, not just what. A model that is forbidden something without reason skirts it;
    with the consequence in front —‘go down to the instructions file of EVERYONE’— it has the
    means to decide the cases that the rule does not enumerate.
   */
  /*
    Without this half, the rule discards good material: almost all of the quotes in this corpus
    are requests for functionality, and many carry a taste within.
   */
  it("deja sacar el gusto que lleve dentro una petición de funcionalidad", () => {
    expect(built.prompt).toContain("sí puedes sacar el gusto que lleve dentro");
  });
});

/**
 * The matter, which is what replaces scope as the third response of the model.
 *
 * This determines whether synthesis can run by topic, which in turn determines whether the
 * portrait is not a generality: with the whole design together in front, the model has to say what
 * this person **wants from the design**, and that is where the repetition is seen. With the open
 * vocabulary, what needs to be tested is where the boundary is between coining and dirtying.
 */
describe("la materia de cada observación", () => {
  const labels = new Map([
    ["c1", verdict({ id: "v1" })],
    ["c2", verdict({ id: "v2" })],
  ]);

  function leer(topic: unknown) {
    const answer = JSON.stringify([{ topic, statement: "Una frase.", citations: ["c1", "c2"] }]);
    return parseObservations(answer, labels).observations[0];
  }

  it("una de las sembradas pasa, y no se cuenta como acuñada", () => {
    expect(leer("backend")).toEqual({
      topic: "backend",
      statement: "Una frase.",
      citations: ["v1", "v2"],
      minted: false,
    });
  });

  it("da igual cómo la escriba: mayúsculas y punto final no son otra materia", () => {
    expect(leer("Backend.")?.topic).toBe("backend");
  });

  /*
    Minting has to be possible — nobody knows today what materials a person we don't know has in
    front of them — and it has to cost something, or the model invents one by observation. What
    costs is the form: the same that `topicOf` requires in the engine, because this ends up being
    a header of `TASTE.md` and a material that the file cannot read would be lost on the first
    round trip.
   */
  it("una materia acuñada pasa, marcada como tal", () => {
    const salida = leer("accessibility");
    expect(salida?.topic).toBe("accessibility");
    expect(salida?.minted, "que la acuñó se cuenta, para que acuñar se vea").toBe(true);
  });

  it("lo que no tiene forma de materia cae en el cajón y no se cuenta como acuñada", () => {
    for (const raro of ["Notas de la App Store (2026)", "", 42, null, "12factor"]) {
      const salida = leer(raro);
      expect(salida?.topic, String(raro)).toBe("other");
      expect(salida?.minted, String(raro)).toBe(false);
    }
  });

  /*
    In the drawer and not outside: discarding it would throw away an entire observation with its
    citations.
   */
  it("una materia ilegible no tira la observación", () => {
    expect(leer(undefined)?.statement).toBe("Una frase.");
  });
});
