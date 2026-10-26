'use client';

import { WIZARD_STEPS, type ProfileDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { useLookups } from '@/lib/lookups';
import { useProfile } from '@/lib/use-profile';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { ProfileSummary } from './ProfileSummary';
import { ProfileWizard } from './ProfileWizard';

/** The first step that is still missing (1-based); the CV step once the required ones are done. */
export function firstOpenStep(profile: ProfileDto): number {
  const i = WIZARD_STEPS.findIndex((k) => k !== 'cv' && !profile.steps[k]);
  return i === -1 ? 6 : i + 1;
}

/**
 * /seeker/profile ("ملفي"). Without ?step it opens the summary when the profile is complete,
 * otherwise the wizard at the first missing step. ?step=1..6 opens that step (edit mode after
 * completion).
 */
export function ProfileScreen() {
  const t = useTranslations('profile');
  const params = useSearchParams();
  const { profile, setProfile, failed, reload } = useProfile();
  const {
    lists,
    ready,
    failed: listsFailed,
  } = useLookups(['countries', 'dars', 'fakhdhs', 'education-levels', 'sectors']);
  const onProfile = useCallback((p: ProfileDto) => setProfile(p), [setProfile]);

  if (failed || listsFailed) {
    return (
      <EmptyState
        icon="warn"
        title={t('loadFailed')}
        action={
          <Button variant="secondary" onClick={() => (failed ? reload() : window.location.reload())}>
            {t('retry')}
          </Button>
        }
      />
    );
  }
  if (!profile || !ready) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label={t('title')}>
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const completed = !!profile.completedAt;
  const raw = Number(params.get('step'));
  const requested = Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : null;
  if (completed && !requested) return <ProfileSummary profile={profile} lists={lists} />;
  // Before the personal step is saved nothing else can be (PROFILE_PERSONAL_REQUIRED).
  const step = !profile.personal ? 1 : (requested ?? firstOpenStep(profile));
  return (
    <ProfileWizard step={step} profile={profile} lists={lists} editing={completed} onProfile={onProfile} />
  );
}
