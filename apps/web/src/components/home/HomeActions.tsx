'use client';

import { useTranslations } from 'next-intl';
import { homeFor } from '@/lib/roles';
import { useAuth } from '@/lib/use-auth';
import { ButtonLink } from '@/components/ui';

/** Hero buttons: sign-up choices for visitors, a shortcut to their area for signed-in users. */
export function HomeActions() {
  const t = useTranslations();
  const { status, user } = useAuth();
  if (status === 'authenticated' && user) {
    return (
      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink href={homeFor(user.role)}>{t('home.goToArea')}</ButtonLink>
      </div>
    );
  }
  return (
    <>
      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink href="/signup">{t('home.ctaSeeker')}</ButtonLink>
        <ButtonLink href="/signup/employer" variant="secondary">
          {t('home.ctaEmployer')}
        </ButtonLink>
      </div>
      <p className="mt-3 text-sm text-text-muted">
        {t('home.haveAccount')}{' '}
        <ButtonLink href="/login" variant="ghost" size="sm">
          {t('common.login')}
        </ButtonLink>
      </p>
    </>
  );
}
