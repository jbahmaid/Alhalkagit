'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/use-auth';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { ProfileCompletionCard } from '@/components/profile/ProfileCompletionCard';

/** Role landing pages. The seeker one shows profile completion; S-17 (admin) comes in batch 4. */
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

export function AdminHome() {
  const t = useTranslations();
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        eyebrow={user?.role === 'SUPER_ADMIN' ? t('common.roleSuperAdmin') : t('common.roleAdmin')}
        title={t('admin.title')}
        lead={user ? t('admin.welcome', { name: user.displayName }) : undefined}
      />
      {user?.isSystemAccount && (
        <div className="mb-4">
          <Badge variant="primary" icon="shield">
            {t('common.sysAccount')}
          </Badge>
        </div>
      )}
      <EmptyState icon="spark" title={t('admin.placeholderTitle')} body={t('admin.placeholderBody')} />
    </>
  );
}
