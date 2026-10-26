import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Applicants } from '@/components/employer/Applicants';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'employer' }))('applicantsTitle') };
}

/** S-14 */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['EMPLOYER']}>
      <Applicants jobId={id} />
    </RequireAuth>
  );
}
