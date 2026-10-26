import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ApplicantProfile } from '@/components/employer/ApplicantProfile';

type Props = { params: Promise<{ locale: string; interestId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'employer' }))('applicantsTitle') };
}

/** S-15 */
export default async function Page({ params }: Props) {
  const { locale, interestId } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['EMPLOYER']}>
      <ApplicantProfile interestId={interestId} />
    </RequireAuth>
  );
}
