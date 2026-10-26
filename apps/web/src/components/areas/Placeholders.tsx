'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/use-auth';
import { Badge, EmptyState, PageHeader } from '@/components/ui';

/** Role landing pages for batch 1; later batches replace them with S-05, S-12 and S-17. */
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
      <EmptyState icon="user" title={t('seeker.placeholderTitle')} body={t('seeker.placeholderBody')} />
    </>
  );
}

export function EmployerHome() {
  const t = useTranslations();
  return (
    <>
      <PageHeader eyebrow={t('common.roleEmployer')} title={t('employer.title')} />
      <EmptyState icon="brief" title={t('employer.placeholderTitle')} body={t('employer.placeholderBody')} />
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
