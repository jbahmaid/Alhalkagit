import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ProfileScreen } from '@/components/profile/ProfileScreen';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'profile' }))('title') };
}

/** S-05 / S-06 and the "ملفي" summary. */
export default async function SeekerProfilePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['SEEKER']}>
      <Suspense>
        <ProfileScreen />
      </Suspense>
    </RequireAuth>
  );
}
