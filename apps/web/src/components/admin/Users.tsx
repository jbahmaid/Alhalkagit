'use client';

import {
  USER_ROLES,
  USER_STATUSES,
  type AdminUserRowDto,
  type Paged,
  type UserRole,
  type UserStatus,
} from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { focusFirstInvalid, isEmail, useApiErrors } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/use-auth';
import {
  Alert,
  Button,
  ButtonLink,
  ChoiceGroup,
  Dialog,
  Icon,
  Note,
  PageHeader,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { LoadState } from '@/components/jobs/job-ui';
import {
  DataTable,
  ExportButton,
  Pager,
  RowActions,
  SystemBadge,
  Td,
  Tr,
  UserStatusBadge,
  useRoleName,
} from './admin-ui';

type Filters = { q: string; role: UserRole | ''; status: UserStatus | '' };
const PAGE_SIZE = 20;

/** S-20 (FR-2.4.1): search and filter every account; open one to view and edit it. */
export function Users() {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const locale = useLocale();
  const roleName = useRoleName();
  const { user } = useAuth();
  const [draft, setDraft] = useState<Filters>({ q: '', role: '', status: '' });
  const [filters, setFilters] = useState<Filters>(draft);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const qs = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  });
  const { data, error, loading, reload } = useApi<Paged<AdminUserRowDto>>(`/admin/users?${qs}`);
  const canExport = user?.role === 'SUPER_ADMIN' || user?.permissions.includes('data.export');
  const canManageAdmins = user?.role === 'SUPER_ADMIN' || user?.permissions.includes('admins.manage');

  function apply(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setFilters({ ...draft, q: draft.q.trim() });
  }

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="mb-4 flex flex-wrap gap-2">
        {canExport && (
          <ExportButton
            kind="users"
            filters={{
              users: {
                ...(filters.q ? { q: filters.q } : {}),
                ...(filters.role ? { role: filters.role } : {}),
                ...(filters.status ? { status: filters.status } : {}),
              },
            }}
          />
        )}
        {canManageAdmins && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Icon name="plus" className="h-4 w-4" />
            {t('createAdmin')}
          </Button>
        )}
      </div>
      <form
        role="search"
        onSubmit={apply}
        className="mb-2 grid items-end gap-x-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]"
      >
        <TextField
          id="uq"
          type="search"
          label={t('search')}
          placeholder={t('searchPlaceholder')}
          required={false}
          value={draft.q}
          onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
        />
        <SelectField
          id="ur"
          label={t('role')}
          required={false}
          placeholder={t('allRoles')}
          options={USER_ROLES.map((r) => ({ value: r, label: roleName(r) }))}
          value={draft.role}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as UserRole | '' }))}
        />
        <SelectField
          id="us"
          label={t('status')}
          required={false}
          placeholder={t('allStatuses')}
          options={USER_STATUSES.map((s) => ({ value: s, label: t(`statusName.${s}`) }))}
          value={draft.status}
          onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as UserStatus | '' }))}
        />
        <Button type="submit" variant="secondary" className="mb-4">
          {t('apply')}
        </Button>
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
            <DataTable head={[t('name'), t('role'), t('email'), t('status'), t('registered'), t('actions')]}>
              {data.items.map((u) => (
                <Tr key={u.id}>
                  <Td label={t('name')}>
                    <span className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
                      <strong>{u.name}</strong>
                      {u.isSystemAccount && <SystemBadge />}
                    </span>
                  </Td>
                  <Td label={t('role')}>{roleName(u.role)}</Td>
                  <Td label={t('email')}>
                    <span dir="ltr">{u.email}</span>
                  </Td>
                  <Td label={t('status')}>
                    <UserStatusBadge status={u.status} />
                  </Td>
                  <Td label={t('registered')}>{formatDate(u.createdAt, locale)}</Td>
                  <Td label={t('actions')}>
                    <RowActions>
                      <ButtonLink href={`/admin/users/${u.id}`} variant="secondary" size="sm">
                        {t('view')}
                        <span className="sr-only">: {u.name}</span>
                      </ButtonLink>
                    </RowActions>
                  </Td>
                </Tr>
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
      {canManageAdmins && (
        <CreateAdminDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function CreateAdminDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const roleName = useRoleName();
  const toast = useToast();
  const errs = useApiErrors();
  const [v, setV] = useState({ name: '', email: '', username: '', role: 'ADMIN' });
  const [fe, setFe] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (busy) return;
    const errors: Record<string, string> = {};
    if (!v.name.trim()) errors.name = tv('required');
    if (!v.email.trim()) errors.email = tv('required');
    else if (!isEmail(v.email)) errors.email = tv('email');
    if (v.username.trim() && !/^[a-z0-9._-]{3,64}$/.test(v.username.trim().toLowerCase()))
      errors.username = tv('username');
    setFe(errors);
    if (Object.keys(errors).length) {
      setFormError(tv('fixErrors'));
      focusFirstInvalid(form);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const row = await api<AdminUserRowDto>('/admin/admins', {
        method: 'POST',
        body: {
          name: v.name.trim(),
          email: v.email.trim(),
          username: v.username.trim() || null,
          role: v.role,
        },
      });
      toast(t('createdToast', { email: row.email }));
      setV({ name: '', email: '', username: '', role: 'ADMIN' });
      onCreated();
    } catch (err) {
      const mapped = errs.fields(err);
      if (Object.keys(mapped).length) {
        setFe(mapped);
        setFormError(tv('fixErrors'));
      } else {
        setFormError(errs.message(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('createAdmin')}>
      <form onSubmit={submit} noValidate>
        <Note kind="info">{t('newAdminNote')}</Note>
        <Alert>{formError}</Alert>
        <TextField
          id="na-name"
          label={t('adminName')}
          autoComplete="off"
          value={v.name}
          onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))}
          error={fe.name}
        />
        <TextField
          id="na-email"
          type="email"
          label={t('email')}
          ltr
          autoComplete="off"
          value={v.email}
          onChange={(e) => setV((s) => ({ ...s, email: e.target.value }))}
          error={fe.email}
        />
        <TextField
          id="na-user"
          label={t('username')}
          hint={t('usernameHint')}
          optional
          ltr
          autoComplete="off"
          autoCapitalize="none"
          value={v.username}
          onChange={(e) => setV((s) => ({ ...s, username: e.target.value }))}
          error={fe.username}
        />
        <ChoiceGroup
          legend={t('role')}
          name="na-role"
          options={[
            { value: 'ADMIN', label: roleName('ADMIN') },
            { value: 'SUPER_ADMIN', label: roleName('SUPER_ADMIN') },
          ]}
          value={v.role}
          onChange={(role) => setV((s) => ({ ...s, role }))}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
