import { describe, expect, it } from "vitest";
import { plainInteger, withProjectRemainder } from "./share-card";

describe("las cifras de una panorámica compartida", () => {
  it("no cambian de separador según el idioma del navegador", () => {
    expect(plainInteger(1_234_567)).toBe("1234567");
  });

  it("reserva la última casilla para el número exacto de proyectos omitidos", () => {
    const projects = Array.from({ length: 8 }, (_, index) => `project-${index + 1}`);
    const visible = withProjectRemainder(projects, 32, (omitted) => `+${omitted} más`);

    expect(visible).toHaveLength(8);
    expect(visible.slice(0, 7)).toEqual(projects.slice(0, 7));
    expect(visible.at(-1)).toBe("+25 más");
  });

  it("no agrega un resumen cuando caben todos los proyectos", () => {
    const projects = ["uno", "dos", "tres"];

    expect(withProjectRemainder(projects, 3, (omitted) => `+${omitted} más`)).toEqual(projects);
  });

  it("cuenta también los proyectos que no pudieron cargar un icono", () => {
    const loaded = ["uno", "dos", "tres", "cuatro"];

    expect(withProjectRemainder(loaded, 8, (omitted) => `+${omitted} más`)).toEqual([
      ...loaded,
      "+4 más",
    ]);
  });
});
