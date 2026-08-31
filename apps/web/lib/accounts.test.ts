import { describe, expect, it } from "vitest";
import { rowsToEdit, type AccountEntry } from "./accounts";

/**
 * Opening the account editor must leave where to write.
 *
 * The bug was seen using the app, in a project with nothing assigned: pressing 'assign the first'
 * opened a form without fields—only 'add another,' 'save,' and 'cancel'—so that button didn't do
 * what its name says. Between the column card, the view button, and 'add another,' it took three
 * clicks to type the first letter.
 *
 * Both halves of the rule are defended because they break on opposite sides: removing the blank
 * row returns the form empty, and adding it always places a filler row on top of the list of
 * whoever already had things noted.
 */

describe("con qué filas se abre el editor de cuentas", () => {
  it("con una en blanco cuando no hay nada apuntado, que es lo que el botón promete", () => {
    expect(rowsToEdit([])).toEqual([{ label: "" }]);
  });

  it("y con las que ya están, sin colar ninguna de relleno", () => {
    const apuntado: AccountEntry[] = [
      { label: "Vercel", email: "yo@ejemplo.com" },
      { label: "Dominio", url: "https://ejemplo.com" },
    ];

    expect(rowsToEdit(apuntado)).toEqual(apuntado);
  });

  it("intactas: editar una lista no es volver a escribirla", () => {
    const apuntado: AccountEntry[] = [{ label: "Stripe", note: "el de pruebas" }];

    expect(rowsToEdit(apuntado)[0], "la misma fila, no una copia a medias").toBe(apuntado[0]);
  });
});
