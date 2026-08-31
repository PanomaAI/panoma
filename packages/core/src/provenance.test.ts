import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readProvenance } from "./provenance";
import type { FileIndex } from "./types";

/**
 * Who the LICENSE says the project belongs to — and when it doesn't say anyone.
 *
 * The issue recorded in this file was seen in Panoma itself: its record said 'it started from
 * someone else's work,' with 'the license is from Free Software Foundation, Inc.' as evidence, on
 * a repository started from scratch. And from there everything else came: it was counted as a
 * fork, appeared in the filter 'it's not mine,' and the evidence concluded with 'the git history
 * starts with you, so it was reset when copying it.'
 *
 * The cause was a single line: the text of the AGPL —and that of the GPL, and that of the LGPL—
 * carries its own copyright notice on the fourth line, and it was the first one the reader
 * encountered. That is, **anyone who chose a license from the GNU family** was marked as having
 * started from the work of the Free Software Foundation.
 *
 * It is tested against real files and with the texts exactly as they distribute them, because the
 * error was not in the regular expression: it was in believing the first line that said
 * 'copyright'.
 */

let root: string;

/** The index that `readProvenance` needs: it is enough for it to know what files there are. */
function index(files: string[]): FileIndex {
  return { root, fileSet: new Set(files), files: files.map((path) => ({ path })) } as unknown as FileIndex;
}

const AGPL = `                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

  Preamble
  …

    Copyright (C) <year>  <name of author>
`;

const MIT = `MIT License

Copyright (c) 2026 Jesus Castillo <jesus@example.com>

Permission is hereby granted, free of charge, to any person obtaining a copy…
`;

const APACHE = `                                 Apache License
                           Version 2.0, January 2004

   APPENDIX: How to apply the Apache License to your work.

      Copyright [yyyy] [name of copyright owner]
`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "panoma-procedencia-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("el titular que declara un LICENSE", () => {
  it("no es la Free Software Foundation por elegir la AGPL", async () => {
    await writeFile(join(root, "LICENSE"), AGPL, "utf8");

    const provenance = await readProvenance(index(["LICENSE"]), undefined);

    expect(
      provenance.licenseHolder,
      "el aviso de la cuarta línea es de la licencia, no del proyecto",
    ).toBeUndefined();
  });

  it("ni el hueco del apéndice de la Apache", async () => {
    await writeFile(join(root, "LICENSE"), APACHE, "utf8");

    expect((await readProvenance(index(["LICENSE"]), undefined)).licenseHolder).toBeUndefined();
  });

  it("y sí es quien firma una MIT, sin su correo pegado detrás", async () => {
    await writeFile(join(root, "LICENSE"), MIT, "utf8");

    expect((await readProvenance(index(["LICENSE"]), undefined)).licenseHolder).toBe("Jesus Castillo");
  });

  it("gana el titular de verdad aunque el texto de la licencia venga detrás", async () => {
    await writeFile(join(root, "LICENSE"), `Copyright (c) 2026 Ana Ruiz\n\n${AGPL}`, "utf8");

    expect(
      (await readProvenance(index(["LICENSE"]), undefined)).licenseHolder,
      "el suyo va primero y el de la licencia se salta",
    ).toBe("Ana Ruiz");
  });

  it("y «all rights reserved» no es el nombre de nadie", async () => {
    await writeFile(
      join(root, "LICENSE"),
      "Copyright (c) 2026 Estudio Nube. All rights reserved.\n",
      "utf8",
    );

    expect((await readProvenance(index(["LICENSE"]), undefined)).licenseHolder).toBe("Estudio Nube");
  });
});
