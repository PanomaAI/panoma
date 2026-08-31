import { fingerprint, subscribe } from "../../../lib/subscribe";
import { MIN_FILL_MS, TRAP_FIELD } from "../../../landing/follow-rules";

/*
  The only route that writes something in the entire public site.
  The rest of `apps/site` has no API at all: it is the landing and `/docs`, and it appears
  precisely because there is nothing behind it. This exists because the list of notices is ours,
  and for it to be ours a place with permissions is needed to write it — the browser cannot have
  the key to the database.
  What it does, in order, and each step comes before the next for a reason:
  1. **Check the bait and the clock.** The cheap stuff first: ruling out a robot shouldn't cost a
  query to the database.
  2. **Validate and normalize.** What comes from outside is not trusted: the address is trimmed
  and converted to lowercase here, not in the browser, which is where the problem originates.
  3. **Write, with the handbrake per hour within the same transaction.**
  And a rule that governs all answers: **they answer the same for a new address and for one that
  already existed**. Distinguishing them would turn this into a search engine of 'is so-and-so
  registered at Panoma?', which is exactly what a list cannot be.
 */

export const runtime = "nodejs";

/** What you answer to a robot: the same as to a person, in order not to teach it anything. */
const GRACIAS = Response.json({ ok: true }, { status: 202 });

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => null)) as {
    email?: unknown;
    locale?: unknown;
    elapsed?: unknown;
    [key: string]: unknown;
  } | null;
  if (!cuerpo) return Response.json({ error: "invalid" }, { status: 400 });

  /*
    The two traps, tested here and not just in the browser. On the client they are a friendly
    filter; here they are the gate: whoever calls this route with `curl` skips the entire form,
    and these two lines are the only thing waiting for them.
   */
  const cebo = typeof cuerpo[TRAP_FIELD] === "string" ? (cuerpo[TRAP_FIELD] as string) : "";
  const tardanza = typeof cuerpo.elapsed === "number" ? cuerpo.elapsed : 0;
  if (cebo.trim() !== "" || tardanza < MIN_FILL_MS) return GRACIAS;

  const email = typeof cuerpo.email === "string" ? cuerpo.email.trim().toLowerCase() : "";
  if (!email || email.length > 254) return Response.json({ error: "invalid" }, { status: 400 });

  const locale = cuerpo.locale === "es" || cuerpo.locale === "en" ? cuerpo.locale : undefined;

  /*
    The IP is put by the Vercel proxy in `x-forwarded-for`, and from there only **the first one**
    counts: the following ones could have been written by whoever calls. And it is not saved: it
    becomes a fingerprint within `fingerprint`.
   */
  const adelantada = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const resultado = await subscribe({ email, locale, ipHash: fingerprint(adelantada) });

  if (resultado === "rate_limited") {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  if (resultado === "invalid") {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  if (resultado === "unavailable") {
    /*
      Neither the reason nor the database message: Postgres errors contain column and
      constraint names. It is noted in the log and answered briefly.
     */
    console.error("[panoma] el alta no se pudo escribir");
    return Response.json({ error: "unavailable" }, { status: 503 });
  }

  return GRACIAS;
}
