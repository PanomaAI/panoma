import { SecretScan } from "@/components/secret-scan";
import { Rich } from "@/components/rich-text";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.credentials") };
}

export default async function SecretsPage() {
  const locale = await getLocale();

  return (
    <main id="app-main" tabIndex={-1} className="app-main legacy-page">
      <section className="pt-12">
        <p className="eyebrow">{t(locale, "nav.credentials")}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {t(locale, "credentials.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
          <Rich
            text={t(locale, "credentials.intro")}
            slots={{ env: <code className="font-mono text-chalk">.env</code> }}
          />
        </p>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-faint">
          <Rich
            text={t(locale, "credentials.allowlist")}
            slots={{ not: <strong>{t(locale, "credentials.not")}</strong> }}
          />
        </p>
      </section>

      <div className="mt-8">
        <SecretScan />
      </div>
    </main>
  );
}
