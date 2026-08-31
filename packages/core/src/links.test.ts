import { afterEach, describe, expect, it } from "vitest";
import { buildFileIndex } from "./discover";
import { readGitInfo } from "./git";
import { resolveLinks } from "./links";
import { createProject } from "./test-utils/temp-project";

/**
 * `links.ts` is the only engine module that reads files ignored by git —`.env`, `.vercel/` — and
 * it does so on purpose, because that is where the service identifiers are. The header of the
 * module promises that from there only **identifiers** come out, never secret values.
 *
 * That promise was held only by the discipline of the person who wrote each solver. This test
 * turns it into something that breaks by itself.
 *
 * The statement is checked backwards on purpose: instead of listing the twelve resolvers and
 * seeing what each one returns, a distinctive value is planted in each secret variable and
 * everything that comes out is examined. This way, it also covers the resolvers that nobody has
 * written yet, which are exactly the ones that will be written in a hurry.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Values impossible to confuse with anything else if they appear in the output. */
const SECRETS = {
  SUPABASE_SERVICE_ROLE_KEY: "CANARIO-service-role-8f3a",
  STRIPE_SECRET_KEY: "sk_live_CANARIO_stripe_9d21",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----CANARIO-firebase",
  SENTRY_AUTH_TOKEN: "CANARIO-sentry-token-4b7e",
  OPENAI_API_KEY: "sk-CANARIO-openai-1c55",
  GOOGLE_MAPS_API_KEY: "CANARIO-maps-key-77aa",
};

describe("resolveLinks", () => {
  it("no deja ningún valor de secreto en los enlaces", async () => {
    const env = Object.entries(SECRETS)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const { root, cleanup } = createProject(
      {
        // Identifiers that should be exposed, mixed with secrets that shouldn't.
        ".env": `${env}\nNEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co\n`,
        ".firebaserc": JSON.stringify({ projects: { default: "mi-proyecto-firebase" } }),
        "package.json": JSON.stringify({ name: "prueba", version: "1.0.0" }),
        "android/app/src/main/AndroidManifest.xml":
          '<manifest package="com.ejemplo.prueba"></manifest>',
        ".vercel/project.json": JSON.stringify({ projectId: "prj_abc123", orgId: "team_xyz" }),
      },
      { git: true },
    );
    cleanups.push(cleanup);

    const index = await buildFileIndex(root);
    const links = await resolveLinks(root, index, await readGitInfo(root));

    // Everything a link can teach: the URL, the label, the evidence.
    const output = JSON.stringify(links);

    for (const [name, value] of Object.entries(SECRETS)) {
      expect(output, `el valor de ${name} aparece en los enlaces`).not.toContain(value);
      // And without the prefix, in case some resolver trims the value thinking that it is worth
      // that way.
      expect(output, `un trozo del valor de ${name} aparece en los enlaces`).not.toContain(
        value.slice(-12),
      );
    }
  });

  it("sí resuelve los identificadores que están en esos mismos ficheros", async () => {
    // The complement to the previous test: without this, a `resolveLinks` that always returned an
    // empty list would pass the secret check with a good grade.
    const { root, cleanup } = createProject(
      {
        ".firebaserc": JSON.stringify({ projects: { default: "mi-proyecto-firebase" } }),
        "package.json": JSON.stringify({ name: "prueba" }),
      },
      { git: true },
    );
    cleanups.push(cleanup);

    const index = await buildFileIndex(root);
    const links = await resolveLinks(root, index, await readGitInfo(root));

    const firebase = links.find((link) => link.id === "firebase");
    expect(firebase, "no se resolvió el enlace de Firebase").toBeDefined();
    expect(firebase!.url).toContain("mi-proyecto-firebase");
    expect(firebase!.kind).toBe("deep");
  });
});
