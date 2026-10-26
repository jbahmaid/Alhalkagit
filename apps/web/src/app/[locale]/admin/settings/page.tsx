import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { MatchingSettings } from '@/components/admin/MatchingSettings';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'admin.settings' }))('title') };
}

/** Matching settings */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['ADMIN', 'SUPER_ADMIN']}>
      <MatchingSettings />
    </RequireAuth>
  );
}
