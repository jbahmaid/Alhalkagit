import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: 'admin' }))('title') };
}

/** S-17 admin dashboard */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <RequireAuth roles={['ADMIN', 'SUPER_ADMIN']}>
      <AdminDashboard />
    </RequireAuth>
  );
}
