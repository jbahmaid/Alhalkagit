import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { UserDetail } from '@/components/admin/UserDetail';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'admin.users' }))('title') };
}

/** S-20: one account (view and edit). ?step=1..5 edits a seeker profile section. */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['ADMIN', 'SUPER_ADMIN']}>
      <Suspense>
        <UserDetail id={id} />
      </Suspense>
    </RequireAuth>
  );
}
