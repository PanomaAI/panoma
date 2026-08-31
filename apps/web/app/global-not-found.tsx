import { getLocale } from "@/lib/i18n";
import { NotFoundView } from "./not-found-view";

/*
  The 404 for addresses that don't match any route, and it comes with its own `<html>`.
  The only root layout lives inside the `(app)` group, so on layer zero there is none, and the
  `/_not-found` path that Next generates for not found is left without an overlay. There were two
  layouts while public site was hanging from here; now that there is one changes nothing, because
  what leaves that path orphaned is having the layout inside a group, not how many there are.
  Before, that was covered by the `<html>` incorporated by Next; since Next 15.5 the route loader
  stops — "not-found.tsx doesn't have a root layout" — and the development server responds with
  500 to any unknown address instead of 404. The production build doesn’t notice: it works fine
  there, and that’s why the bug could live for months on the developer’s terminal without any
  release turning red.
  This is the output that Next gives for the case, and it requests the
  `experimental.globalNotFound` switch in `next.config.ts`. Both go together: without the file the
  switch does nothing, and without the switch this file is not looked at.
  `app/not-found-view.test.ts` ties them.
 */
export default async function GlobalNotFound() {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body style={{ margin: 0 }}>
        <NotFoundView es={locale === "es"} />
      </body>
    </html>
  );
}
