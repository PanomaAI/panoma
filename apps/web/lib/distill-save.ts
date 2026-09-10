import {
  inTransaction,
  markVerdictsDistilled,
  queueWrite,
  saveObservations,
  type Database,
  type NewObservation,
} from "@panoma/db";

/**
 * Commit one understood model response before starting another paid call.
 *
 * Evidence and its progress marker belong to one transaction: marking first can consume quotes
 * forever when saving fails; saving at the end of a multi-call run loses completed batches when
 * the process stops. An understood empty response still advances, without inventing evidence.
 */
export function saveDistillationBatch(
  database: Database,
  verdictIds: string[],
  observations: NewObservation[],
): Promise<number> {
  return queueWrite(() => inTransaction(database, async (tx) => {
    const saved = await saveObservations(tx, observations);
    await markVerdictsDistilled(tx, verdictIds);
    return saved;
  }));
}
