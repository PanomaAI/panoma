import { revalidatePath } from "next/cache";
import { refreshCatalog } from "@panoma/enrich";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";

/**
 * It brings the latest versions and vulnerabilities for the entire catalog.
 *
 * It lives here, next to the database, for the same reason as ingestion: the web server is the
 * only process that can write. The CLI only triggers the operation.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const force = new URL(request.url).searchParams.get("force") === "true";
  const { db: database } = await db();

  const result = await refreshCatalog(database, { force });
  revalidatePath("/", "layout");

  return Response.json(result);
}

// Checking hundreds of packages against seven records does not fit within the default time of a
// serverless function.
export const maxDuration = 300;
