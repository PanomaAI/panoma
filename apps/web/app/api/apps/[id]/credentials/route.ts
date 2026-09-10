import { sameOrigin, localOperatorOnly } from "@/lib/guard";
import { appRequestBody, localAppsOnly } from "@/lib/apps-http";
import {
  AppCredentialError, appCredentialStatus, deleteAppCredential, saveAppCredential,
} from "@/lib/app-provider-credentials";

type Context = { params: Promise<{ id: string }> };
const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

function failed(error: unknown): Response {
  const code = error instanceof AppCredentialError ? error.code : "credential-request-failed";
  const status = code === "unknown-app" ? 404 : code.startsWith("invalid-") ? 400
    : code === "credential-config-unreadable" ? 409 : 500;
  return Response.json({ error: code }, { status, headers: PRIVATE_HEADERS });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try { return await appRequestBody(request); }
  catch { throw new AppCredentialError("invalid-credential-body"); }
}

/** Credential inventory is operator-only too; no raw config enters app details or an RSC render. */
export async function GET(request: Request, context: Context) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request) ?? localAppsOnly();
  if (blocked) return blocked;
  try {
    return Response.json(await appCredentialStatus((await context.params).id), { headers: PRIVATE_HEADERS });
  } catch (error) { return failed(error); }
}

/** Saving authorizes storage only. Voice still needs the existing confirmed settings change. */
export async function POST(request: Request, context: Context) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request) ?? localAppsOnly();
  if (blocked) return blocked;
  try {
    return Response.json(await saveAppCredential((await context.params).id, await body(request)), { headers: PRIVATE_HEADERS });
  } catch (error) { return failed(error); }
}

/** Forgetting removes only this provider's saved key, without changing app or model settings. */
export async function DELETE(request: Request, context: Context) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request) ?? localAppsOnly();
  if (blocked) return blocked;
  try {
    return Response.json(await deleteAppCredential((await context.params).id, await body(request)), { headers: PRIVATE_HEADERS });
  } catch (error) { return failed(error); }
}
