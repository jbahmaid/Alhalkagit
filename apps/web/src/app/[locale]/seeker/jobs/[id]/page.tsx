import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { SeekerJobDetail } from '@/components/jobs/SeekerJobDetail';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'jobs' }))('title') };
}

/** S-08 */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['SEEKER']}>
      <SeekerJobDetail id={id} />
    </RequireAuth>
  );
}
