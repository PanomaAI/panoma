import { describe, expect, it } from "vitest";
import { formatBytes } from "./format-bytes";

/**
 * The four steps, and especially the one at the top.
 *
 * The copy that lived in `unused-assets.tsx` didn't have a gigabyte step: in front of two
 * gigabytes it replied "2048.0 MB." Nothing failed, there was no error anywhere, and the figure
 * was correct — simply unreadable. It is the exact fault that this file exists to catch.
 */
describe("los bytes en la unidad en la que se leen", () => {
  it("por debajo del kilo se dicen en bytes, sin adornos", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("los kilos van redondos: un decimal ahí no dice nada", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(1024 ** 2 - 1)).toBe("1024 KB");
  });

  it("los megas llevan decimal, que es lo que distingue 4,2 de 4,9", () => {
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(4.2 * 1024 ** 2)).toBe("4.2 MB");
    expect(formatBytes(4.9 * 1024 ** 2)).toBe("4.9 MB");
  });

  it("y a partir del giga se dicen gigas: es el escalón que faltaba", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
    // What the copy answered without this step: '2048.0 MB'.
    expect(formatBytes(2 * 1024 ** 3)).not.toContain("MB");
    expect(formatBytes(1573 * 1024 ** 2)).toBe("1.5 GB");
  });

  it("cada escalón empieza donde acaba el anterior, sin hueco", () => {
    expect(formatBytes(1024 - 1)).toContain("B");
    expect(formatBytes(1024)).toContain("KB");
    expect(formatBytes(1024 ** 2 - 1)).toContain("KB");
    expect(formatBytes(1024 ** 2)).toContain("MB");
    expect(formatBytes(1024 ** 3 - 1)).toContain("MB");
    expect(formatBytes(1024 ** 3)).toContain("GB");
  });
});
