/**
 * The indicator that something is happening: one point for each step.
 *
 * **Why dots and not a little wheel.** A little wheel is drawn by returning to the beginning of
 * the line with `\r`, and `\r` is exactly what `safe-output.ts` deliberately erases — returning to
 * the beginning of the line is half of “erasing what was there,” and Panoma prints project names
 * and commit messages written by other people. To have a little wheel, an exception would have to
 * be made in that filter, and the exception would have to allow letters (the message that
 * accompanies the little wheel), which would stop filtering exactly what matters. A dot after
 * another does not move anything: it just writes.
 *
 * And by the way, it is a better indicator. A little wheel spins the same with one folder as with
 * seventy-five; a row of dots that grows shows how much is left to do and leaves a trace in the
 * log when someone pastes the output into an incident.
 *
 * **It goes to `stderr` ** because it is information about progress, not the outcome: whoever does
 * `panoma scan --json > fichero` must receive the clean JSON.
 *
 * Outside of a terminal it writes nothing. In a pipe or in a log file, a line of seventy-five dots
 * is garbage.
 */

export type Espera = {
  /** One more step. */
  uno: () => void;
  /** Close the line, if there ever was one. */
  fin: () => void;
};

const NADA: Espera = { uno: () => {}, fin: () => {} };

/**
 * Start counting steps.
 *
 * `cada` allows only one out of every N to be marked, so that a scan of a thousand projects
 * doesn't print a thousand points: with large folders, the line matters more than accuracy.
 */
export function espera(cada = 1): Espera {
  if (!process.stderr.isTTY) return NADA;

  let vistos = 0;
  let escritos = 0;
  return {
    uno: () => {
      vistos += 1;
      if (vistos % cada !== 0) return;
      escritos += 1;
      process.stderr.write("·");
    },
    fin: () => {
      if (escritos > 0) process.stderr.write("\n");
    },
  };
}

/**
 * The same, but marking the passage of time instead of counted steps.
 *
 * For the waits in which there is nothing to tell —the server starting— and the only thing that
 * can be said is 'I'm still here.' It returns the function that stops it.
 */
export function esperaPorTiempo(cada = 400): () => void {
  const marca = espera();
  const reloj = setInterval(() => marca.uno(), cada);
  /* That an indicator is not the reason for the process not finishing. */
  reloj.unref?.();
  return () => {
    clearInterval(reloj);
    marca.fin();
  };
}
