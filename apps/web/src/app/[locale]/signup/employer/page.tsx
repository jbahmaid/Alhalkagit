import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ButtonLink, EmptyState, PageHeader } from '@/components/ui';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'employer' }))('signupTitle') };
}

/** S-10 placeholder: employer sign-up arrives in batch 3. */
export default async function EmployerSignupPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <div className="mx-auto max-w-form">
      <PageHeader title={t('employer.signupTitle')} />
      <EmptyState
        icon="brief"
        title={t('common.comingSoon')}
        body={t('employer.signupSoonBody')}
        action={<ButtonLink href="/signup">{t('home.ctaSeeker')}</ButtonLink>}
      />
    </div>
  );
}
