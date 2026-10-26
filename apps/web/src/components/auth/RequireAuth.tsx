'use client';

import type { UserRole } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { homeFor } from '@/lib/roles';
import { useAuth } from '@/lib/use-auth';
import { Spinner } from '@/components/ui';

/**
 * Client-side route guard (the API enforces the real permissions on every request).
 * - not signed in: to /login?next=<this page>
 * - must change password: to /change-password (unless this is that page)
 * - wrong role: to the user's own area
 */
export function RequireAuth({
  roles,
  allowPasswordChange = false,
  children,
}: {
  roles?: UserRole[];
  allowPasswordChange?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('common');
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const redirect =
    status === 'anonymous'
      ? `/login?next=${encodeURIComponent(pathname)}`
      : status === 'authenticated' && user
        ? user.mustChangePassword && !allowPasswordChange
          ? '/change-password'
          : roles && !roles.includes(user.role)
            ? homeFor(user.role)
            : null
        : null;

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  if (status !== 'authenticated' || redirect) {
    return (
      <div className="flex justify-center py-16 text-text-muted" role="status" aria-live="polite">
        <Spinner className="h-6 w-6" />
        <span className="sr-only">{t('loading')}</span>
      </div>
    );
  }
  return <>{children}</>;
}
