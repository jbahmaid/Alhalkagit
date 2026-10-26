'use client';

import { LOOKUP_LIMITS, type AdminLookupItemDto, type LookupType } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiErrors } from '@/lib/errors';
import { invalidateLookups, useLookupName } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Icon,
  Note,
  PageHeader,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { LoadState } from '@/components/jobs/job-ui';
import { DataTable, RowActions, TabPanel, Tabs, Td, Tr } from './admin-ui';

const TABS: { key: LookupType; label: string }[] = [
  { key: 'dars', label: 'dars' },
  { key: 'fakhdhs', label: 'fakhdhs' },
  { key: 'sectors', label: 'sectors' },
  { key: 'business-types', label: 'businessTypes' },
  { key: 'education-levels', label: 'educationLevels' },
  { key: 'countries', label: 'countries' },
];

type Draft = { code: string; nameAr: string; nameEn: string; sortOrder: string; rank: string; darId: string };
const EMPTY: Draft = { code: '', nameAr: '', nameEn: '', sortOrder: '', rank: '', darId: '' };

/** S-19 (FR-2.4.2): add, edit, disable / enable. Items are never deleted. */
export function Lookups() {
  const t = useTranslations('admin.lookups');
  const tc = useTranslations('common');
  const [type, setType] = useState<LookupType>('dars');
  const { data, error, loading, reload, setData } = useApi<AdminLookupItemDto[]>(`/admin/lookups/${type}`);
  // Fakhdhs show their dar, and the form links a fakhdh to one.
  const dars = useApi<AdminLookupItemDto[]>(type === 'fakhdhs' ? '/admin/lookups/dars' : null);
  const [editing, setEditing] = useState<AdminLookupItemDto | null>(null);

  function saved(item: AdminLookupItemDto) {
    invalidateLookups(type);
    setData((list) => {
      const rest = (list ?? []).filter((x) => x.id !== item.id);
      return [...rest, item].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.nameAr.localeCompare(b.nameAr, 'ar'),
      );
    });
  }

  return (
    <>
      <PageHeader title={t('title')} lead={t('lead')} />
      <Tabs
        idPrefix="lk"
        label={t('title')}
        tabs={TABS.map((x) => ({ key: x.key, label: t(`tab.${x.label}`) }))}
        value={type}
        onChange={(k) => {
          setType(k);
          setEditing(null);
        }}
      />
      <TabPanel idPrefix="lk" active={type}>
        <ItemForm key={`add-${type}`} type={type} dars={dars.data ?? []} onSaved={saved} />
        <Note kind="info">{t('inactiveNote')}</Note>
        {!data || loading ? (
          <LoadState
            loading={loading}
            error={error}
            title={tc('loadFailed')}
            onRetry={reload}
            label={t('title')}
          />
        ) : data.length ? (
          <ItemTable type={type} items={data} dars={dars.data ?? []} onEdit={setEditing} onSaved={saved} />
        ) : (
          <EmptyState icon="info" title={t('empty')} />
        )}
      </TabPanel>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? t('editItem', { name: editing.nameAr }) : ''}
      >
        {editing && (
          <ItemForm
            key={editing.id}
            type={type}
            item={editing}
            dars={dars.data ?? []}
            onSaved={(item) => {
              saved(item);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </>
  );
}

function ItemTable({
  type,
  items,
  dars,
  onEdit,
  onSaved,
}: {
  type: LookupType;
  items: AdminLookupItemDto[];
  dars: AdminLookupItemDto[];
  onEdit: (item: AdminLookupItemDto) => void;
  onSaved: (item: AdminLookupItemDto) => void;
}) {
  const t = useTranslations('admin.lookups');
  const toast = useToast();
  const errs = useApiErrors();
  const name = useLookupName();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(item: AdminLookupItemDto) {
    setBusy(item.id);
    setError(null);
    try {
      const saved = await api<AdminLookupItemDto>(`/admin/lookups/${type}/${item.id}`, {
        method: 'PATCH',
        body: { isActive: !item.isActive },
      });
      onSaved(saved);
      toast(saved.isActive ? t('enabledToast') : t('disabledToast'));
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setBusy(null);
    }
  }

  const head = [
    '#',
    t('code'),
    t('nameAr'),
    t('nameEn'),
    ...(type === 'education-levels' ? [t('rank')] : []),
    ...(type === 'fakhdhs' ? [t('dar')] : []),
    t('status'),
    t('actions'),
  ];
  return (
    <>
      <Alert>{error}</Alert>
      <DataTable head={head}>
        {items.map((x) => {
          const label = `${x.nameAr} / ${x.nameEn}`;
          return (
            <Tr key={x.id}>
              <Td label="#" className="tabular-nums">
                {x.sortOrder}
              </Td>
              <Td label={t('code')}>
                <code dir="ltr">{x.code}</code>
              </Td>
              <Td label={t('nameAr')}>
                <span lang="ar" dir="rtl">
                  {x.nameAr}
                </span>
              </Td>
              <Td label={t('nameEn')}>
                <span lang="en" dir="ltr">
                  {x.nameEn}
                </span>
              </Td>
              {type === 'education-levels' && (
                <Td label={t('rank')} className="tabular-nums">
                  {x.rank}
                </Td>
              )}
              {type === 'fakhdhs' && (
                <Td label={t('dar')}>{x.darId ? name(dars.find((d) => d.id === x.darId)) : t('anyDar')}</Td>
              )}
              <Td label={t('status')}>
                {x.isActive ? (
                  <Badge variant="match" icon="check">
                    {t('active')}
                  </Badge>
                ) : (
                  <Badge variant="muted" icon="x">
                    {t('inactive')}
                  </Badge>
                )}
              </Td>
              <Td label={t('actions')}>
                <RowActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onEdit(x)}
                    aria-label={`${t('edit')}: ${label}`}
                  >
                    {t('edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === x.id}
                    disabled={!!busy}
                    onClick={() => toggle(x)}
                    aria-label={`${x.isActive ? t('disable') : t('enable')}: ${label}`}
                  >
                    {x.isActive ? t('disable') : t('enable')}
                  </Button>
                </RowActions>
              </Td>
            </Tr>
          );
        })}
      </DataTable>
    </>
  );
}

/** Add (no `item`) or edit form. Codes are upper-cased; countries take an ISO alpha-2 code. */
function ItemForm({
  type,
  item,
  dars,
  onSaved,
  onCancel,
}: {
  type: LookupType;
  item?: AdminLookupItemDto;
  dars: AdminLookupItemDto[];
  onSaved: (item: AdminLookupItemDto) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('admin.lookups');
  const tv = useTranslations('validation');
  const tc = useTranslations('common');
  const toast = useToast();
  const errs = useApiErrors();
  const name = useLookupName();
  const [d, setD] = useState<Draft>(
    item
      ? {
          code: item.code,
          nameAr: item.nameAr,
          nameEn: item.nameEn,
          sortOrder: String(item.sortOrder),
          rank: item.rank !== undefined ? String(item.rank) : '',
          darId: item.darId ?? '',
        }
      : EMPTY,
  );
  const [fe, setFe] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD((s) => ({ ...s, [k]: e.target.value }));
  const country = type === 'countries';
  const idp = item ? `lk-edit` : `lk-add`;

  function check(): Record<string, string> {
    const e: Record<string, string> = {};
    const code = d.code.trim().toUpperCase();
    if (!code) e.code = tv('required');
    else if (country ? !/^[A-Z]{2}$/.test(code) : !/^[A-Z0-9_]+$/.test(code))
      e.code = country ? tv('isoCode') : tv('lookupCode');
    if (!d.nameAr.trim()) e.nameAr = tv('required');
    if (!d.nameEn.trim()) e.nameEn = tv('required');
    if (d.sortOrder && !/^\d+$/.test(d.sortOrder)) e.sortOrder = tv('number');
    if (type === 'education-levels' && !/^\d+$/.test(d.rank)) e.rank = d.rank ? tv('number') : tv('required');
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const e = check();
    setFe(e);
    if (Object.keys(e).length) {
      setFormError(tv('fixErrors'));
      return;
    }
    setFormError(null);
    setBusy(true);
    const body = {
      code: d.code.trim().toUpperCase(),
      nameAr: d.nameAr.trim(),
      nameEn: d.nameEn.trim(),
      ...(d.sortOrder ? { sortOrder: Number(d.sortOrder) } : {}),
      ...(type === 'education-levels' ? { rank: Number(d.rank) } : {}),
      ...(type === 'fakhdhs' ? { darId: d.darId || null } : {}),
    };
    try {
      const saved = await api<AdminLookupItemDto>(
        item ? `/admin/lookups/${type}/${item.id}` : `/admin/lookups/${type}`,
        {
          method: item ? 'PATCH' : 'POST',
          body,
        },
      );
      onSaved(saved);
      toast(item ? t('savedToast') : t('addedToast'));
      if (!item) setD(EMPTY);
    } catch (err) {
      const mapped = errs.fields(err);
      // `matches` on this code field is the lookup format, not the 6-digit verification code.
      if (
        err instanceof ApiError &&
        err.fieldErrors.some((f) => f.field === 'code' && f.errors.includes('matches'))
      )
        mapped.code = country ? tv('isoCode') : tv('lookupCode');
      setFe(mapped);
      setFormError(Object.keys(mapped).length ? tv('fixErrors') : errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <>
      <Alert>{formError}</Alert>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField
          id={`${idp}-ar`}
          label={t('nameAr')}
          lang="ar"
          dir="rtl"
          maxLength={LOOKUP_LIMITS.nameMax}
          value={d.nameAr}
          onChange={set('nameAr')}
          error={fe.nameAr}
        />
        <TextField
          id={`${idp}-en`}
          label={t('nameEn')}
          lang="en"
          ltr
          maxLength={LOOKUP_LIMITS.nameMax}
          value={d.nameEn}
          onChange={set('nameEn')}
          error={fe.nameEn}
        />
        <TextField
          id={`${idp}-code`}
          label={t('code')}
          hint={country ? t('isoHint') : t('codeHint')}
          ltr
          autoCapitalize="characters"
          maxLength={country ? 2 : LOOKUP_LIMITS.codeMax}
          value={d.code}
          onChange={(e) => setD((s) => ({ ...s, code: e.target.value.toUpperCase() }))}
          error={fe.code}
        />
        <TextField
          id={`${idp}-sort`}
          label={t('sortOrder')}
          hint={t('sortHint')}
          optional
          ltr
          inputMode="numeric"
          value={d.sortOrder}
          onChange={set('sortOrder')}
          error={fe.sortOrder}
        />
        {type === 'education-levels' && (
          <TextField
            id={`${idp}-rank`}
            label={t('rank')}
            hint={t('rankHint')}
            ltr
            inputMode="numeric"
            value={d.rank}
            onChange={set('rank')}
            error={fe.rank}
          />
        )}
        {type === 'fakhdhs' && (
          <SelectField
            id={`${idp}-dar`}
            label={t('dar')}
            optional
            placeholder={t('anyDar')}
            options={dars
              .filter((x) => x.isActive || x.id === item?.darId)
              .map((x) => ({ value: x.id, label: name(x) }))}
            value={d.darId}
            onChange={set('darId')}
            error={fe.darId}
          />
        )}
      </div>
    </>
  );

  if (item) {
    return (
      <form onSubmit={submit} noValidate>
        {fields}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('save')}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <Card className="mb-4">
      <form onSubmit={submit} noValidate aria-labelledby="lk-add-title">
        <h2 id="lk-add-title" className="m-0 mb-3 text-base font-semibold">
          {t('addItem')}
        </h2>
        {fields}
        <Button type="submit" loading={busy}>
          <Icon name="plus" className="h-4 w-4" />
          {t('add')}
        </Button>
      </form>
    </Card>
  );
}
