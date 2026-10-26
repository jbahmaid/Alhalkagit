'use client';

import { JOB_LIMITS, localSaudiMobile, type AdminEmployerDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApiErrors } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useLookupName, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Kv,
  Note,
  PageHeader,
  TextAreaField,
  useToast,
} from '@/components/ui';
import { LoadState } from '@/components/jobs/job-ui';
import { ConfirmDialog, TabPanel, Tabs } from './admin-ui';

type Tab = 'PENDING' | 'APPROVED' | 'REJECTED';

/** S-18 (FR-2.2.2): approve, or reject with an optional reason. Admins only see this data. */
export function Approvals() {
  const t = useTranslations('admin.approvals');
  const tc = useTranslations('common');
  const [tab, setTab] = useState<Tab>('PENDING');
  const { data, error, loading, reload, setData } = useApi<AdminEmployerDto[]>(
    `/admin/employers?status=${tab}`,
  );
  const tabs: { key: Tab; label: string }[] = [
    { key: 'PENDING', label: t('tabPending') },
    { key: 'APPROVED', label: t('tabApproved') },
    { key: 'REJECTED', label: t('tabRejected') },
  ];
  const empty = { PENDING: t('noPending'), APPROVED: t('noApproved'), REJECTED: t('noRejected') }[tab];

  return (
    <>
      <PageHeader title={t('title')} />
      <Note kind="privacy" icon="lock">
        {t('note')}
      </Note>
      <Tabs idPrefix="ap" label={t('tabs')} tabs={tabs} value={tab} onChange={setTab} />
      <TabPanel idPrefix="ap" active={tab}>
        {!data || loading ? (
          <LoadState
            loading={loading}
            error={error}
            title={tc('loadFailed')}
            onRetry={reload}
            label={t('title')}
          />
        ) : data.length ? (
          <div className="grid gap-3">
            {data.map((e) => (
              <EmployerCard
                key={e.id}
                employer={e}
                onDecided={() => setData(data.filter((x) => x.id !== e.id))}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon="check" title={empty} />
        )}
      </TabPanel>
    </>
  );
}

function EmployerCard({ employer: e, onDecided }: { employer: AdminEmployerDto; onDecided: () => void }) {
  const t = useTranslations('admin.approvals');
  const locale = useLocale();
  const toast = useToast();
  const errs = useApiErrors();
  const name = useLookupName();
  const { lists } = useLookups(['sectors', 'business-types']);
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const headingId = `emp-${e.id}`;

  async function approve() {
    setBusy('approve');
    setError(null);
    try {
      await api(`/admin/employers/${e.id}/approve`, { method: 'POST' });
      toast(t('approvedToast', { org: e.organizationName }));
      onDecided();
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy('reject');
    setError(null);
    try {
      await api(`/admin/employers/${e.id}/reject`, {
        method: 'POST',
        body: { reason: reason.trim() || null },
      });
      setRejecting(false);
      toast(t('rejectedToast', { org: e.organizationName }));
      onDecided();
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <article aria-labelledby={headingId}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id={headingId} className="m-0 text-lg font-semibold">
            {e.organizationName}
          </h2>
          {e.emailVerifiedAt ? (
            <Badge variant="match" icon="check">
              {t('emailVerified')}
            </Badge>
          ) : (
            <Badge variant="near" icon="clock">
              {t('emailNotVerified')}
            </Badge>
          )}
        </div>
        <Kv
          rows={[
            [t('name'), e.contactName],
            [t('sector'), name(lists.sectors?.find((s) => s.id === e.sectorId))],
            [t('btype'), name(lists['business-types']?.find((s) => s.id === e.businessTypeId))],
            [
              t('email'),
              <span key="e" dir="ltr">
                {e.email}
              </span>,
            ],
            [
              t('phone'),
              <span key="p" dir="ltr">
                {localSaudiMobile(e.phone)}
              </span>,
            ],
            [t('registered'), formatDate(e.createdAt, locale)],
            ...(e.approvedAt && e.approvalStatus === 'APPROVED'
              ? ([[t('approvedOn'), formatDate(e.approvedAt, locale)]] as [string, string][])
              : []),
            ...(e.approvalStatus === 'REJECTED' && e.rejectionReason
              ? ([[t('reason'), e.rejectionReason]] as [string, string][])
              : []),
          ]}
        />
        {error && !rejecting && (
          <p role="alert" className="mb-0 mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        {e.approvalStatus !== 'APPROVED' && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              onClick={approve}
              loading={busy === 'approve'}
              disabled={!!busy}
              aria-describedby={headingId}
            >
              <Icon name="check" className="h-4 w-4" />
              {t('approve')}
            </Button>
            {e.approvalStatus === 'PENDING' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setRejecting(true)}
                disabled={!!busy}
                aria-describedby={headingId}
              >
                {t('reject')}
              </Button>
            )}
          </div>
        )}
      </article>
      <ConfirmDialog
        open={rejecting}
        title={t('rejectTitle', { org: e.organizationName })}
        confirmLabel={t('confirmReject')}
        danger
        busy={busy === 'reject'}
        error={rejecting ? error : null}
        onConfirm={reject}
        onClose={() => {
          setRejecting(false);
          setError(null);
        }}
      >
        <TextAreaField
          id={`reject-${e.id}`}
          label={t('rejectReason')}
          hint={t('rejectHint')}
          optional
          rows={3}
          maxLength={JOB_LIMITS.rejectionReasonMax}
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
        />
      </ConfirmDialog>
    </Card>
  );
}
