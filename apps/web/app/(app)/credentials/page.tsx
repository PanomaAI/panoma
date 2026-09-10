import { PageSection, PageShell } from "@/components/page-shell";
import { SecretScan } from "@/components/secret-scan";
import { Rich } from "@/components/rich-text";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.credentials") };
}

export default async function SecretsPage() {
  const locale = await getLocale();

  /*
    The second paragraph goes in `headExtra` and not in `note`, and the difference is not a detail:
    `note` is the monospaced line of figures some screens carry, and this is a sentence with a
    `<strong>` inside it. It keeps the size and the ink it already had.
   */
  const allowlist = (
    <p className="mt-3 max-w-2xl text-xs leading-relaxed text-faint">
      <Rich
        text={t(locale, "credentials.allowlist")}
        slots={{ not: <strong>{t(locale, "credentials.not")}</strong> }}
      />
    </p>
  );

  return (
    <PageShell
      eyebrow={t(locale, "nav.credentials")}
      title={t(locale, "credentials.title")}
      lead={
        <Rich
          text={t(locale, "credentials.intro")}
          slots={{ env: <code className="font-mono text-chalk">.env</code> }}
        />
      }
      headExtra={allowlist}
    >
      <PageSection>
        <SecretScan />
      </PageSection>
    </PageShell>
  );
}
