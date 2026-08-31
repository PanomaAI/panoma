import { revalidatePath } from "next/cache";
import { claimTask, completeTask } from "@panoma/db";
import { requireAgent } from "@/lib/agent-auth";

/**
 * Take or close a task.
 *
 * `claim` can legitimately fail: if another agent got ahead, the response says so instead of
 * pretending it went well. That two agents work on the same thing is exactly what a work queue has
 * to prevent.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string; result?: string };

  if (body.action === "claim") {
    const ok = await claimTask(auth.database, id, auth.agent.id);
    revalidatePath("/", "layout");
    return Response.json(
      ok
        ? { claimed: true }
        : { claimed: false, reason: "Another agent claimed it first, or it is no longer open" },
    );
  }

  if (body.action === "complete") {
    const ok = await completeTask(auth.database, id, auth.agent.id, body.result);
    revalidatePath("/", "layout");
    return Response.json(
      ok ? { completed: true } : { completed: false, reason: "The task is assigned to another agent" },
    );
  }

  return Response.json({ error: "action must be 'claim' or 'complete'" }, { status: 400 });
}
