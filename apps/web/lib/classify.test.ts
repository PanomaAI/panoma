import { describe, expect, it } from "vitest";
import { CLASSIFY_BATCH, buildClassifyPrompt, parseTopics, planBatches } from "./classify";
import { TOPIC_NAMES } from "./distill";

/**
 * The allocation by subjects, which is the step on which it depends for synthesizing to be of any
 * use.
 *
 * The synthesis runs by topic: all design-related things together, in order to be able to say what
 * this person asks of design. Without this distribution, a `other` subject with six hundred
 * sentences inside returns the generality from which all increase flees.
 *
 * What is tested here is above all the silent failure: a label that does not resolve cannot move a
 * row that the model did not see, and a matter that is not understood **cannot** mark the row as
 * seen — because it would mark it forever with what there was, which is `other`, and that row
 * would never come through here again.
 */

const FRASES = [
  { id: "t1", statement: "Quieres la portada con aire." },
  { id: "t2", statement: "No dejas pasar un `any`." },
  { id: "t3", statement: "Quieres que el comando conteste en una línea." },
];

const built = buildClassifyPrompt(FRASES);

function respuesta(entries: unknown[]): string {
  return JSON.stringify(entries);
}

describe("el encargo del reparto", () => {
  it("enseña cada frase con su etiqueta", () => {
    expect(built.prompt).toContain("[s1] Quieres la portada con aire.");
    expect(built.labels.get("s1")).toBe("t1");
  });

  it("enseña las materias con lo que significa cada una", () => {
    for (const name of TOPIC_NAMES) {
      expect(built.prompt, name).toContain(`- ${name}:`);
    }
  });

  it("va entre delimitadores, aunque las frases las escribiera un modelo de la casa", () => {
    expect(built.prompt).toContain("<untrusted_data");
  });

  /*
    No quotes, no context, no submissions: just the sentence. That's what makes this the cheapest
    call from Twin and allows it to run alone before synthesizing.
   */
  it("no manda nada más que la frase", () => {
    expect(built.prompt).not.toContain("dijo:");
    expect(built.prompt).not.toContain("le habían entregado");
  });

  it("le dice que el cajón no es el desempate", () => {
    expect(built.prompt).toContain("`other` solo cuando de verdad no encaje");
  });

  it("y que puede acuñar una, con la forma acotada", () => {
    expect(built.prompt).toContain("una materia que no esté en la lista");
    expect(built.prompt).toContain("en minúsculas");
  });

  /*
    The paper says what it **does not** do, and that is not decoration. What goes in here are
    sentences about a person written by another model: without the explicit prohibition, a model
    given a list of sentences and a short question tends to improve them along the way.
   */
  it("el papel prohíbe reescribir lo que se le da a clasificar", () => {
    expect(built.system).toContain("no las reescribes");
  });
});

describe("las tandas", () => {
  it("se reparten del tamaño que cabe en una llamada", () => {
    const muchas = Array.from({ length: CLASSIFY_BATCH * 2 + 5 }, (_unused, i) => ({
      id: `x${i}`,
      statement: `Una cosa numero ${i}.`,
    }));
    const batches = planBatches(muchas);
    expect(batches[0]).toHaveLength(CLASSIFY_BATCH);
    expect(batches.at(-1)).toHaveLength(5);
  });

  it("en el orden en que llegan: clasificar una frase no depende de las de al lado", () => {
    expect(planBatches(FRASES, 2)[0]?.map((one) => one.id)).toEqual(["t1", "t2"]);
  });

  it("una lista vacía no da ninguna tanda", () => {
    expect(planBatches([])).toEqual([]);
  });
});

describe("qué reparto pasa el filtro", () => {
  it("una materia sembrada se aplica y no cuenta como acuñada", () => {
    const salida = parseTopics(respuesta([{ item: "s2", topic: "testing" }]), built.labels);
    expect(salida.assigned).toEqual([{ id: "t2", topic: "testing", minted: false }]);
  });

  it("una acuñada pasa marcada, para que acuñar se vea", () => {
    const salida = parseTopics(respuesta([{ item: "s1", topic: "accessibility" }]), built.labels);
    expect(salida.assigned[0]).toEqual({ id: "t1", topic: "accessibility", minted: true });
  });

  it("da igual cómo la escriba: mayúsculas y punto final no son otra materia", () => {
    expect(parseTopics(respuesta([{ item: "s1", topic: "Design." }]), built.labels).assigned[0]?.topic).toBe(
      "design",
    );
  });

  it("una etiqueta entre corchetes se entiende igual", () => {
    expect(parseTopics(respuesta([{ item: "[s3]", topic: "cli" }]), built.labels).assigned[0]?.id).toBe(
      "t3",
    );
  });

  /* `s99` invented cannot move a row that the model did not see. */
  it("una etiqueta que no se mandó no mueve nada", () => {
    const salida = parseTopics(respuesta([{ item: "s99", topic: "design" }]), built.labels);
    expect(salida.assigned).toHaveLength(0);
    expect(salida.dropped).toBe(1);
  });

  /* Two subjects for the same sentence are not two classifications: it is contradicting oneself. */
  it("una frase repetida solo cuenta la primera vez", () => {
    const salida = parseTopics(
      respuesta([
        { item: "s1", topic: "design" },
        { item: "s1", topic: "backend" },
      ]),
      built.labels,
    );
    expect(salida.assigned).toEqual([{ id: "t1", topic: "design", minted: false }]);
    expect(salida.dropped).toBe(1);
  });

  /*
    And here the illegible is indeed discarded, unlike in distillation. The difference is what is
    lost: there, discarding would throw away an entire observation with its citations; here, the
    row remains unclassified and goes through the classifier again next time. Sending it to
    `other` would mark it as looked at when what actually happened is that the response was not
    understood.
   */
  it("una materia que no se entiende deja la fila sin tocar, no en el cajón", () => {
    for (const raro of ["Notas de la App Store (2026)", "", 42, null]) {
      const salida = parseTopics(respuesta([{ item: "s1", topic: raro }]), built.labels);
      expect(salida.assigned, String(raro)).toHaveLength(0);
      expect(salida.dropped, String(raro)).toBe(1);
    }
  });

  it("una entrada rota no se lleva por delante a las que sí valen", () => {
    const salida = parseTopics(
      respuesta([{ item: "s99", topic: "design" }, { item: "s2", topic: "backend" }]),
      built.labels,
    );
    expect(salida.assigned).toHaveLength(1);
    expect(salida.dropped).toBe(1);
  });

  it("sin nada que repartir, cero no es un fallo", () => {
    const salida = parseTopics("[]", built.labels);
    expect(salida.assigned).toHaveLength(0);
    expect(salida.unreadable).toBe(false);
  });

  it("una respuesta que no es un array se dice ilegible", () => {
    for (const raro of ["no puedo ayudarte con eso", "", '{"items":[]}']) {
      expect(parseTopics(raro, built.labels).unreadable, raro).toBe(true);
    }
  });

  it("no lanza nunca, diga lo que diga el modelo", () => {
    for (const raro of ["", "[", '[{"item":', "null", "[1,2,3]"]) {
      expect(() => parseTopics(raro, built.labels), raro).not.toThrow();
    }
  });

  it("una valla de código no esconde la respuesta", () => {
    const salida = parseTopics(
      "```json\n" + respuesta([{ item: "s1", topic: "design" }]) + "\n```",
      built.labels,
    );
    expect(salida.assigned).toHaveLength(1);
  });
});
