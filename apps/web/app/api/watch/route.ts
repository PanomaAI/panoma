import { ensureWatcher, watchState, watcherEvents } from "@/lib/watch";
import { sameOrigin } from "@/lib/guard";

/**
 * What the watcher is watching and what it has seen pass by.
 *
 * Reading it wakes the watcher if it was asleep: asking "are you watching?" and having the answer be
 * "no" without anyone doing anything about it is precisely the silent failure that this endpoint
 * exists to uncover.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  await ensureWatcher();
  const state = watchState();
  // Those on the disk include what was before the last reboot; those in memory, only this life.
  const events = await watcherEvents(50);

  return Response.json({ ...state, events: events.length > 0 ? events : state.events });
}
