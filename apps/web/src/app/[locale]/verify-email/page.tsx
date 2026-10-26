import type { Metadata } from 'next';
import { OTP_RESEND_COOLDOWN_SECONDS } from '@sanad/shared';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VerifyEmailForm } from '@/components/auth/VerifyEmailForm';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'auth.verify' }))('title') };
}

/** S-04 */
export default async function VerifyEmailPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { email, wait, as } = await searchParams;
  const seconds = Number.isFinite(Number(wait)) ? Number(wait) : OTP_RESEND_COOLDOWN_SECONDS;
  return (
    <VerifyEmailForm email={email} wait={Math.min(Math.max(seconds, 0), 3600)} employer={as === 'employer'} />
  );
}
