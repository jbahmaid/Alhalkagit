'use client';

import type { ExportKind, ExportTokenDto, UserRole, UserStatus } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { api, download } from '@/lib/api';
import { useApiErrors } from '@/lib/errors';
import { Alert, Badge, Button, Dialog, Icon, Note, PasswordField, useToast } from '@/components/ui';

// ---------------------------------------------------------------------------
// Responsive table (prototype .rtable): a table from 768px, labelled rows on phones.
// ---------------------------------------------------------------------------

export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface max-md:overflow-visible">
      <table className="w-full border-collapse text-[15px] max-md:block">
        <thead className="max-md:sr-only">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-border bg-surface-2 px-3 py-2.5 text-start text-[13px] font-semibold text-text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-md:block">{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return (
    <tr className="max-md:block max-md:border-b max-md:border-border max-md:py-2 max-md:last:border-b-0">
      {children}
    </tr>
  );
}

const TD =
  'border-b border-border px-3 py-2.5 align-middle [overflow-wrap:anywhere] max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:border-0 max-md:px-3.5 max-md:py-1.5 max-md:text-end max-md:before:max-w-[45%] max-md:before:flex-none max-md:before:text-start max-md:before:text-[13px] max-md:before:font-semibold max-md:before:text-text-muted max-md:before:content-[attr(data-label)]';

/** `full` cells span the row on phones (no label column), e.g. an expandable diff. */
export function Td({
  label,
  children,
  full = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
  className?: string;
}) {
  return (
    <td
      data-label={label}
      className={`${TD} ${full ? 'max-md:block max-md:text-start max-md:before:mb-1 max-md:before:block max-md:before:max-w-none' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

/** Buttons in a table cell: end-aligned on phones. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">{children}</div>;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function useRoleName() {
  const t = useTranslations('common');
  return useCallback(
    (role: UserRole | null | undefined) =>
      role === 'SEEKER'
        ? t('roleSeeker')
        : role === 'EMPLOYER'
          ? t('roleEmployer')
          : role === 'ADMIN'
            ? t('roleAdmin')
            : role === 'SUPER_ADMIN'
              ? t('roleSuperAdmin')
              : '',
    [t],
  );
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const t = useTranslations('admin.users.statusName');
  if (status === 'ACTIVE')
    return (
      <Badge variant="match" icon="check">
        {t(status)}
      </Badge>
    );
  if (status === 'PENDING_VERIFICATION')
    return (
      <Badge variant="near" icon="clock">
        {t(status)}
      </Badge>
    );
  return (
    <Badge variant={status === 'SUSPENDED' ? 'danger' : 'muted'} icon="x">
      {t(status)}
    </Badge>
  );
}

export function SystemBadge() {
  const t = useTranslations('common');
  return (
    <Badge variant="primary" icon="lock">
      {t('sysAccount')}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Tabs (WAI-ARIA tabs: arrow keys move between tabs, the panel follows)
// ---------------------------------------------------------------------------

export function Tabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
}: {
  label: string;
  tabs: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const rtl = useLocale() === 'ar';
  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    let next = step ? (i + step + tabs.length) % tabs.length : -1;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab, i) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.key}`}
            aria-controls={`${idPrefix}-panel`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px min-h-touch flex-none whitespace-nowrap border-b-[3px] px-3 py-2 text-[15px] ${
              selected
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  active,
  children,
}: {
  idPrefix: string;
  active: string;
  children: ReactNode;
}) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${active}`}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const t = useTranslations('common');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('pageOf', { page, pages })} className="mt-3 flex items-center justify-between gap-2">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <Icon name="chev" className="h-4 w-4 rotate-180 rtl:rotate-0" />
        {t('prev')}
      </Button>
      <span className="text-sm text-text-muted tabular-nums">{t('pageOf', { page, pages })}</span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('next')}
        <Icon name="chev" className="h-4 w-4" flipInRtl />
      </Button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Excel export: password re-confirmed for a short-lived export token, then the file is
// streamed by the API and saved by the browser (FR-2.5.4). Admins only; the API enforces it.
// ---------------------------------------------------------------------------

export function ExportButton({
  kind,
  label,
  filters,
}: {
  kind: ExportKind;
  label?: string;
  /** Current screen filters, sent with the request (users / audit). */
  filters?: Record<string, unknown>;
}) {
  const t = useTranslations('admin.export');
  const tc = useTranslations('common');
  const locale = useLocale();
  const toast = useToast();
  const errs = useApiErrors();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = await api<ExportTokenDto>('/admin/export/token', {
        method: 'POST',
        body: { password },
      });
      await download(`/admin/export/${kind}`, { token, locale, ...(filters ?? {}) }, `sanad-${kind}.xlsx`);
      setOpen(false);
      setPassword('');
      toast(t('toast'));
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-export={kind}>
        <Icon name="download" className="h-4 w-4" />
        {label ?? tc('exportXlsx')}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
          setPassword('');
        }}
        title={t('title')}
      >
        <form id={`export-${kind}`} onSubmit={submit} noValidate>
          <Note kind="privacy" icon="lock">
            {t('body')}
          </Note>
          {filters && <p className="mt-0 text-sm text-text-muted">{t('filtered')}</p>}
          <Alert>{error}</Alert>
          <PasswordField
            id={`export-${kind}-pw`}
            label={t('password')}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={!password}>
              <Icon name="download" className="h-4 w-4" />
              {t('confirm')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** A simple "are you sure" dialog with a danger or primary confirm button. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy,
  error,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const tc = useTranslations('common');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <p className="mt-0 text-text-muted">{body}</p>}
      <Alert>{error}</Alert>
      {children}
    </Dialog>
  );
}
