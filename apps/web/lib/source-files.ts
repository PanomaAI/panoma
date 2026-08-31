import { readdirSync } from "node:fs";

/**
 * The code files of a directory, going into its subdirectories.
 *
 * It exists because of a failure that doesn't fail. Four contract tests on this website run
 * through `components/` with a plain `readdirSync` and check something about each file: that none
 * assume the interface is in Spanish, that no one speaks again through the events channel, that
 * the red error is rendered with the primitive. They all also have a floor
 * —`expect(ficheros.length).toBeGreaterThan(20)`— so that an empty sweep is noticeable.
 *
 * The ground does not protect from what it seems. The day someone groups five components in
 * `components/twin/`, the flat sweep stops seeing them, there are still more than twenty loose,
 * and the four tests pass in green while monitoring a smaller set. A guardian who stops looking is
 * indistinguishable from one who approves: there is no error, no warning, and what is no longer
 * checked is only discovered when it breaks.
 *
 * Truly going through it costs four lines and removes the entire problem.
 */
export function sourceFiles(
  dir: URL,
  /** Con punto: `[".tsx"]`, `[".ts", ".tsx"]`. */
  extensions: string[],
): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entrada.name.startsWith(".") || entrada.name === "node_modules") continue;
    if (entrada.isDirectory()) {
      /* The final bar matters: without it `new URL` eats the last segment. */
      salida.push(
        ...sourceFiles(new URL(`${entrada.name}/`, dir), extensions).map(
          (hijo) => `${entrada.name}/${hijo}`,
        ),
      );
      continue;
    }
    if (extensions.some((ext) => entrada.name.endsWith(ext))) salida.push(entrada.name);
  }
  return salida;
}
