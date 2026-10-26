import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmployerSignupForm } from '@/components/employer/EmployerSignupForm';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'employer' }))('signupTitle') };
}

/** S-10 */
export default async function EmployerSignupPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { email } = await searchParams;
  return <EmployerSignupForm initialEmail={email ?? ''} />;
}
