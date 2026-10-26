import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { SeekerJobs } from '@/components/jobs/SeekerJobs';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'jobs' }))('title') };
}

/** S-07 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['SEEKER']}>
      <SeekerJobs />
    </RequireAuth>
  );
}
