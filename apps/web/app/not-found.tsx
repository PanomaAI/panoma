import { getLocale } from "@/lib/i18n";
import { NotFoundView } from "./not-found-view";

/*
  The 404 of the `notFound()` — those that are born within a route that does exist: a project file
  with a slug that is not there, a deleted execution.
  Live up here and not inside `(app)` because from here it covers both groups, and `<html>` is set
  by the root layout of the group from which it was called. That's why this file does not include
  an envelope and `global-not-found.tsx` does: they are two different entries to the same body.
  An address that does not match ANY route does not pass through here: it is not born in any
  group, so it does not have a root layout that wraps it. That one is handled by
  `global-not-found.tsx`.
 */
export default async function NotFound() {
  const locale = await getLocale();

  return <NotFoundView es={locale === "es"} />;
}
