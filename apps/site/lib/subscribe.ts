import "server-only";
import { createHash } from "node:crypto";

/*
  The registration on the list, on the server side. Here lives what the browser cannot see.
  ── Why is there a route of ours and not a form that points outside ─────────────────
  Because the list is ours. Before, this would send directly to a provider's form: zero code, but
  the provider kept the address. Now the row is written in our own database, with the date and language of
  the consent next to it, and whoever wants to move it tomorrow only has to dump it.
  What this decision costs, said here so that no one is surprised: **saving addresses is not
  having a mailing list**. Sending for real requires templates, one-click unsubscribes signed by
  DKIM, a suppression list, bounces, and domain reputation — and none of that is built. This
  saves; writing is another day and probably another provider on top.
  ── And why doesn't the browser go directly into the database ─────────────────────────
  It is possible: the Supabase public key is designed to travel to the client. But then the
  writing occurs against a domain that is not ours, and that means that **there is nowhere to put
  a brake**: neither limit by IP, nor check the bait, nor normalize anything. With our own route,
  all of that runs before touching the database.
  The key used here is the **secret** one, which bypasses row policies by definition, and that's
  why this file opens with `server-only`: if someone imports it from a client component, the build
  breaks instead of exposing the credential. And that's why its variable does NOT carry the prefix
  `NEXT_PUBLIC_` — that prefix puts the value into the package that the visitor downloads, and
  with this key it would be like giving away the entire database.
 */

/** What the discharge can answer. Same value for 'new' and 'already was,' on purpose. */
export type SubscribeResult = "ok" | "invalid" | "rate_limited" | "unavailable";

/*
  The two variables, truncated when read.
  The cutoff is not paranoia: pasting a key into a provider's panel easily carries a line break or
  a trailing space, and the result is one of the worst possible — a header HTTP with a line break
  inside is not a valid header, so the request doesn’t even go through. The symptom is ‘could not
  write’ with nothing else, which is exactly what was seen in production on 28-Aug-2026 with the
  variables seemingly well set.
 */
function ajuste(nombre: string): string {
  return (process.env[nombre] ?? "").trim();
}

/** If there is somewhere to save. Without the two variables, the card does not show the form. */
export function subscribeReady(): boolean {
  return Boolean(ajuste("SUPABASE_URL") && ajuste("SUPABASE_SECRET_KEY"));
}

/**
 * The footprint of the one who calls, for the hourly brake.
 *
 * Fingerprint and not address: to count requests, it is not necessary to know who they belong to,
 * and a IP is personal data that we have no reason to keep. The salt is what prevents undoing the
 * fingerprint — without it, testing the four billion addresses that exist and comparing them is a
 * matter of minutes.
 *
 * If no salt is configured, one is not made up: `undefined` is returned and the brake remains
 * deactivated. A fixed salt written in the code would be exactly the same as having none, but
 * appearing as if there is one.
 */
export function fingerprint(ip: string | null): string | undefined {
  const salt = ajuste("SUBSCRIBE_SALT");
  if (!salt || !ip) return undefined;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Write the registration by calling the database function.
 *
 * To a function and not to the table: the Panoma schema is not exposed in the API of data —it is a
 * project that hosts another product and its global settings are not touched— and besides, in this
 * way the lock and the write occur within the same transaction, without two requests at the same
 * time being able to slip through the gap.
 */
export async function subscribe(options: {
  email: string;
  locale?: string | undefined;
  ipHash?: string | undefined;
}): Promise<SubscribeResult> {
  const url = ajuste("SUPABASE_URL");
  const key = ajuste("SUPABASE_SECRET_KEY");
  if (!url || !key) {
    console.error("[panoma] faltan SUPABASE_URL o SUPABASE_SECRET_KEY");
    return "unavailable";
  }

  let response: Response;
  try {
    response = await fetch(new URL("/rest/v1/rpc/panoma_subscribe", url), {
      method: "POST",
      /*
        Only `apikey`, and the two absences are deliberate.
        **Without `Authorization`. ** The new keys (`sb_secret_…`) are not JWT, and Supabase’s
        documentation says they should not be sent there. Measured on August 28, 2026, against the
        real project: today the gateway tolerates it —responds identically with and without—
        because it detects the value and replaces it with an internal JWT. But that is
        undocumented behavior, and relying on it is one platform change away from breaking.
        **Without `Prefer: return=minimal`. ** It was set to not bring the body, and the body is
        exactly what is needed: the function returns the verdict as text. Measured, today header
        does not suppress it in a function call — `"ok"` came back with it set — but asking not to
        send the only thing that is going to be read is a trap waiting for the behavior to change,
        and then `invalid` and `rate_limited` would be read as `ok` without anything failing.
       */
      headers: {
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_email: options.email,
        p_locale: options.locale ?? null,
        p_ip_hash: options.ipHash ?? null,
      }),
      /* Short roof: this runs while someone watches a button spinning. */
      signal: AbortSignal.timeout(8000),
    });
  } catch (reason) {
    /*
      It didn't even manage to come out: fallen network, broken roof, or an invalid header because
      the key had a line break (hence the cut above).
     */
    console.error("[panoma] la petición no salió:", reason instanceof Error ? reason.message : reason);
    return "unavailable";
  }

  /*
    And if it came back with a problem, **the code is recorded**, which is the only thing that
    distinguishes the three causes of a failure here. Without this, there was only "could not
    write," which says nothing — and it took a whole round of diagnosis in production.
    401 → the key is not valid for this project (the most common: use one from another project, or
    the publishable one instead of the secret one). 404 → the address or the name of the function.
    The rest → look at the body.
    The body goes to the log but NEVER to the visitor: PostgREST errors contain column and
    constraint names.
   */
  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    console.error(`[panoma] Supabase contestó ${response.status}: ${detalle.slice(0, 200)}`);
    return "unavailable";
  }
  const veredicto = (await response.text()).trim().replace(/^"|"$/g, "");
  if (veredicto === "invalid" || veredicto === "rate_limited") return veredicto;
  return "ok";
}
