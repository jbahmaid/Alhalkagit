'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/use-auth';
import { PageHeader } from '@/components/ui';
import { ProfileCompletionCard } from '@/components/profile/ProfileCompletionCard';

/** The seeker landing page: profile completion. (The admin one is S-17, components/admin.) */
export function SeekerHome() {
  const t = useTranslations();
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        eyebrow={t('common.roleSeeker')}
        title={t('seeker.title')}
        lead={user ? t('seeker.welcome', { name: user.displayName }) : undefined}
      />
      <ProfileCompletionCard />
    </>
  );
}
