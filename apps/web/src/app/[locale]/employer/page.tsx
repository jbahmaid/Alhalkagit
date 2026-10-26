import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { EmployerHome } from '@/components/employer/EmployerHome';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'employer' }))('title') };
}

/** S-11 (pending) or S-12 (dashboard) */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['EMPLOYER']}>
      <EmployerHome />
    </RequireAuth>
  );
}
