'use client';

import { AUDIT_ACTIONS, type AuditAction, type AuditEntryDto, type AuditPageDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/use-auth';
import { Badge, Button, Note, PageHeader, SelectField, TextField, type BadgeVariant } from '@/components/ui';
import { LoadState } from '@/components/jobs/job-ui';
import { DataTable, ExportButton, Pager, Td, Tr, useRoleName } from './admin-ui';

type Filters = { user: string; action: AuditAction | ''; entity: string; from: string; to: string };
const EMPTY: Filters = { user: '', action: '', entity: '', from: '', to: '' };
const PAGE_SIZE = 25;

const clean = (f: Filters) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) as Partial<Filters>;

function actionVariant(a: AuditAction): BadgeVariant {
  if (a === 'DELETE' || a === 'HARD_DELETE' || a === 'LOGIN_FAILED' || a === 'REJECT' || a === 'SUSPEND')
    return 'danger';
  if (a === 'CREATE' || a === 'APPROVE' || a === 'RESTORE') return 'match';
  if (a === 'VIEW_SENSITIVE' || a === 'EXPORT') return 'near';
  return 'muted';
}

/** S-21 (FR-2.4.2): read only, filtered and paged; before / after values stay masked. */
export function AuditLog() {
  const t = useTranslations('admin.audit');
  const tc = useTranslations('common');
  const locale = useLocale();
  const roleName = useRoleName();
  const { user } = useAuth();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...clean(filters) });
  const { data, error, loading, reload } = useApi<AuditPageDto>(`/admin/audit?${qs}`);
  const canExport = user?.role === 'SUPER_ADMIN' || user?.permissions.includes('data.export');
  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  function apply(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setFilters({ ...draft, user: draft.user.trim() });
  }

  return (
    <>
      <PageHeader title={t('title')} />
      <Note kind="info" icon="lock">
        {t('note')}
      </Note>
      {canExport && (
        <div className="mb-4">
          <ExportButton kind="audit" filters={{ audit: clean(filters) }} />
        </div>
      )}
      <form role="search" onSubmit={apply} className="grid items-end gap-x-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField
          id="au"
          type="search"
          label={t('user')}
          placeholder={t('userHint')}
          required={false}
          value={draft.user}
          onChange={set('user')}
        />
        <SelectField
          id="aa"
          label={t('action')}
          required={false}
          placeholder={t('allActions')}
          options={AUDIT_ACTIONS.map((a) => ({ value: a, label: t(`act.${a}`) }))}
          value={draft.action}
          onChange={set('action')}
        />
        <SelectField
          id="ae"
          label={t('entity')}
          required={false}
          placeholder={t('allTables')}
          options={(data?.entities ?? []).map((e) => ({ value: e, label: e }))}
          value={draft.entity}
          onChange={set('entity')}
        />
        <TextField
          id="af"
          type="date"
          ltr
          label={t('fromDate')}
          required={false}
          value={draft.from}
          onChange={set('from')}
        />
        <TextField
          id="at"
          type="date"
          ltr
          label={t('toDate')}
          required={false}
          value={draft.to}
          onChange={set('to')}
        />
        <div className="mb-4 flex flex-wrap gap-2 sm:col-span-2 lg:col-span-5">
          <Button type="submit" variant="secondary">
            {t('apply')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
              setPage(1);
            }}
          >
            {t('clear')}
          </Button>
        </div>
      </form>
      {!data ? (
        <LoadState
          loading={loading}
          error={error}
          title={tc('loadFailed')}
          onRetry={reload}
          label={t('title')}
        />
      ) : (
        <>
          <p role="status" className="mt-0 text-sm text-text-muted">
            {tc('resultsCount', { n: data.total })}
          </p>
          {data.items.length ? (
            <DataTable
              head={[
                t('time'),
                t('user'),
                t('role'),
                t('action'),
                t('entity'),
                t('recordId'),
                t('ip'),
                t('beforeAfter'),
              ]}
            >
              {data.items.map((r) => (
                <Row key={r.id} r={r} locale={locale} roleName={roleName} />
              ))}
            </DataTable>
          ) : (
            <p className="rounded-lg border border-border bg-surface p-6 text-center text-text-muted">
              {t('noRows')}
            </p>
          )}
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

function Row({
  r,
  locale,
  roleName,
}: {
  r: AuditEntryDto;
  locale: string;
  roleName: ReturnType<typeof useRoleName>;
}) {
  const t = useTranslations('admin.audit');
  const ta = useTranslations('admin');
  const json = (v: unknown) => (v === null || v === undefined ? t('none') : JSON.stringify(v, null, 2));
  return (
    <Tr>
      <Td label={t('time')}>
        <span className="whitespace-nowrap">{formatDateTime(r.createdAt, locale)}</span>
      </Td>
      <Td label={t('user')}>
        <span dir="ltr">{r.actorLabel ?? ta('systemActor')}</span>
      </Td>
      <Td label={t('role')}>{roleName(r.actorRole)}</Td>
      <Td label={t('action')}>
        <Badge variant={actionVariant(r.action)}>{t(`act.${r.action}`)}</Badge>
      </Td>
      <Td label={t('entity')}>
        <code>{r.entity}</code>
      </Td>
      <Td label={t('recordId')}>
        <code className="text-xs" dir="ltr">
          {r.entityId ?? '—'}
        </code>
      </Td>
      <Td label={t('ip')}>
        <span dir="ltr">{r.ip ?? '—'}</span>
      </Td>
      <Td label={t('beforeAfter')} full>
        <details className="group">
          <summary className="min-h-touch cursor-pointer py-2 font-medium text-primary">{t('view')}</summary>
          <div className="text-[13px] text-text-muted">{t('before')}</div>
          <pre
            dir="ltr"
            className="m-0 mb-2 max-h-64 overflow-auto rounded-md bg-surface-2 p-2 text-xs text-start md:max-w-md"
          >
            {json(r.before)}
          </pre>
          <div className="text-[13px] text-text-muted">{t('after')}</div>
          <pre
            dir="ltr"
            className="m-0 max-h-64 overflow-auto rounded-md bg-surface-2 p-2 text-xs text-start md:max-w-md"
          >
            {json(r.after)}
          </pre>
        </details>
      </Td>
    </Tr>
  );
}
