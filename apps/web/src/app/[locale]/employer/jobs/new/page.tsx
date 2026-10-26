import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { JobForm } from '@/components/employer/JobForm';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'employer' }))('postTitle') };
}

/** S-13 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['EMPLOYER']}>
      <JobForm />
    </RequireAuth>
  );
}
