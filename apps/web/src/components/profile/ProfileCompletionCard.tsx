'use client';

import { useTranslations } from 'next-intl';
import { ButtonLink, Card, Icon, Spinner } from '@/components/ui';
import { PROFILE_PATH, useProfile } from '@/lib/use-profile';

/** Seeker home: how complete the profile is, and the way back into the wizard. */
export function ProfileCompletionCard() {
  const t = useTranslations('profile.home');
  const { profile, failed } = useProfile();
  if (failed) return null;
  if (!profile) {
    return (
      <Card className="flex justify-center py-8">
        <Spinner className="h-6 w-6" />
      </Card>
    );
  }
  const done = !!profile.completedAt;
  const percent = done ? 100 : profile.percent;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 flex items-center gap-2 text-lg font-semibold">
          <Icon name="user" className="h-5 w-5 text-primary" />
          {t('title')}
        </h2>
        <span className="text-sm font-semibold text-primary">{t('percent', { percent })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t('title')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mb-3 h-2 overflow-hidden rounded-pill bg-surface-2"
      >
        <span className="block h-full rounded-pill bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="mb-4 mt-0 text-text-muted">{done ? t('completeBody') : t('incompleteBody')}</p>
      <ButtonLink href={PROFILE_PATH} variant={done ? 'secondary' : 'primary'}>
        {done ? t('view') : profile.personal ? t('continue') : t('start')}
      </ButtonLink>
    </Card>
  );
}
