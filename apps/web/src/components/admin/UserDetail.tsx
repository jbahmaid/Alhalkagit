'use client';

import {
  localSaudiMobile,
  type AdminUserDetailDto,
  type AdminUserRowDto,
  type ProfileDto,
  type RevealedIdDto,
} from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { focusFirstInvalid, isEmail, useApiErrors } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { useLookupName, useLookupOptions, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/use-auth';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  ChoiceGroup,
  Dialog,
  Icon,
  Kv,
  Note,
  PageHeader,
  PasswordField,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { BackLink, LoadState } from '@/components/jobs/job-ui';
import { ProfileSummary } from '@/components/profile/ProfileSummary';
import { STEP_COMPONENTS } from '@/components/profile/ProfileWizard';
import { ProfileApiContext, type StepHandle } from '@/components/profile/step-kit';
import { ConfirmDialog, SystemBadge, UserStatusBadge, useRoleName } from './admin-ui';

const isAdmin = (role: string) => role === 'ADMIN' || role === 'SUPER_ADMIN';

/** S-20 account page: view and edit any account. The API enforces every rule shown here. */
export function UserDetail({ id }: { id: string }) {
  const t = useTranslations('admin.user');
  const tc = useTranslations('common');
  const tn = useTranslations('nav');
  const roleName = useRoleName();
  const { user: me } = useAuth();
  const { data, setData, error, loading, reload } = useApi<AdminUserDetailDto>(`/admin/users/${id}`);

  if (!data) {
    return (
      <>
        <Back />
        <PageHeader title={t('account')} />
        <LoadState
          loading={loading}
          error={error}
          title={tc('loadFailed')}
          onRetry={reload}
          label={t('account')}
        />
      </>
    );
  }

  const self = me?.id === data.id;
  const superAdmin = me?.role === 'SUPER_ADMIN';
  // Mirrors the API: an admin account needs admins.manage (SUPER_ADMIN); the system account
  // keeps only its email editable; your own account is edited from "My account".
  const manageable = !self && (!isAdmin(data.role) || superAdmin);
  const update = (row: AdminUserRowDto) => setData({ ...data, ...row });

  return (
    <>
      <Back />
      <PageHeader eyebrow={roleName(data.role)} title={data.name} />
      <div className="mb-4 flex flex-wrap gap-2">
        <UserStatusBadge status={data.status} />
        {data.isSystemAccount && <SystemBadge />}
      </div>
      {data.isSystemAccount && (
        <Note kind="privacy" icon="lock">
          {t('sysNote')}
        </Note>
      )}
      {self && (
        <Note kind="info">
          {t('ownNote')}{' '}
          <ButtonLink href="/account" variant="ghost" size="sm">
            {tn('account')}
          </ButtonLink>
        </Note>
      )}
      {!self && isAdmin(data.role) && !superAdmin && <Note kind="info">{t('superOnly')}</Note>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <AccountCard user={data} manageable={manageable} superAdmin={superAdmin} onChange={update} />
        {data.employer && <EmployerCard user={data} onSaved={setData} />}
      </div>
      {data.role === 'SEEKER' && <SeekerSection user={data} />}
    </>
  );
}

function Back() {
  const t = useTranslations('admin.user');
  return (
    <ButtonLink href="/admin/users" variant="ghost" className="mb-2">
      <BackLink>{t('back')}</BackLink>
    </ButtonLink>
  );
}

// ---------------------------------------------------------------------------
// Account: status, role, email
// ---------------------------------------------------------------------------

type Pending = null | 'suspend' | 'reactivate' | 'delete';

function AccountCard({
  user,
  manageable,
  superAdmin,
  onChange,
}: {
  user: AdminUserDetailDto;
  manageable: boolean;
  superAdmin: boolean;
  onChange: (row: AdminUserRowDto) => void;
}) {
  const t = useTranslations('admin.user');
  const tc = useTranslations('common');
  const locale = useLocale();
  const roleName = useRoleName();
  const toast = useToast();
  const errs = useApiErrors();
  const router = useRouter();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [role, setRole] = useState<string>(user.role);
  const protectedAccount = user.isSystemAccount;

  async function act(kind: Exclude<Pending, null>) {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'delete') {
        await api(`/admin/users/${user.id}`, { method: 'DELETE' });
        toast(t('deletedToast'));
        router.replace('/admin/users');
        return;
      }
      onChange(await api<AdminUserRowDto>(`/admin/users/${user.id}/${kind}`, { method: 'POST' }));
      toast(kind === 'suspend' ? t('suspendedToast') : t('reactivatedToast'));
      setConfirm(null);
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveRole() {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await api<AdminUserRowDto>(`/admin/users/${user.id}/role`, { method: 'PATCH', body: { role } }),
      );
      toast(t('roleSaved'));
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  const none = <span className="text-text-muted">—</span>;
  return (
    <Card>
      <h2 className="m-0 mb-3 text-lg font-semibold">{t('account')}</h2>
      <Kv
        rows={[
          [
            t('loginEmail'),
            <span key="e" dir="ltr">
              {user.email}
            </span>,
          ],
          [t('username'), user.username ? <span dir="ltr">{user.username}</span> : none],
          [t('role'), roleName(user.role)],
          [t('status'), <UserStatusBadge key="s" status={user.status} />],
          [t('registered'), formatDate(user.createdAt, locale)],
          [t('lastLogin'), user.lastLoginAt ? formatDateTime(user.lastLoginAt, locale) : t('never')],
          [
            t('emailVerified'),
            user.emailVerifiedAt ? formatDate(user.emailVerifiedAt, locale) : t('notVerified'),
          ],
          ...(user.mustChangePassword ? [[t('mustChange'), tc('yes')] as [string, ReactNode]] : []),
        ]}
      />
      {!confirm && <Alert>{error}</Alert>}
      {manageable && (
        <div className="mt-4 flex flex-wrap gap-2" data-testid="account-actions">
          <Button variant="secondary" size="sm" onClick={() => setEmailOpen(true)}>
            <Icon name="mail" className="h-4 w-4" />
            {t('changeEmail')}
          </Button>
          {!protectedAccount && (
            <>
              {user.status === 'SUSPENDED' ? (
                <Button variant="secondary" size="sm" onClick={() => setConfirm('reactivate')}>
                  {t('reactivate')}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setConfirm('suspend')}>
                  {t('suspend')}
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => setConfirm('delete')}>
                {t('delete')}
              </Button>
            </>
          )}
        </div>
      )}
      {manageable && superAdmin && isAdmin(user.role) && !protectedAccount && (
        <div className="mt-4 border-t border-border pt-3">
          <ChoiceGroup
            legend={t('changeRole')}
            name="admin-role"
            options={[
              { value: 'ADMIN', label: roleName('ADMIN') },
              { value: 'SUPER_ADMIN', label: roleName('SUPER_ADMIN') },
            ]}
            value={role}
            onChange={setRole}
          />
          <Button size="sm" onClick={saveRole} loading={busy && !confirm} disabled={role === user.role}>
            {t('saveRole')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'delete'
            ? t('deleteTitle', { name: user.name })
            : confirm === 'suspend'
              ? t('suspendTitle', { name: user.name })
              : t('reactivate')
        }
        body={confirm === 'delete' ? t('deleteBody') : confirm === 'suspend' ? t('suspendBody') : undefined}
        confirmLabel={
          confirm === 'delete' ? t('delete') : confirm === 'suspend' ? t('suspend') : t('reactivate')
        }
        danger={confirm !== 'reactivate'}
        busy={busy}
        error={confirm ? error : null}
        onConfirm={() => confirm && act(confirm)}
        onClose={() => {
          setConfirm(null);
          setError(null);
        }}
      />
      <ChangeEmailDialog
        open={emailOpen}
        user={user}
        onClose={() => setEmailOpen(false)}
        onSaved={(row) => {
          onChange(row);
          setEmailOpen(false);
        }}
      />
    </Card>
  );
}

function ChangeEmailDialog({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: AdminUserDetailDto;
  onClose: () => void;
  onSaved: (row: AdminUserRowDto) => void;
}) {
  const t = useTranslations('admin.user');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const toast = useToast();
  const errs = useApiErrors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const errors: Record<string, string> = {};
    if (!email.trim()) errors.email = tv('required');
    else if (!isEmail(email)) errors.email = tv('email');
    if (!password) errors.currentPassword = tv('required');
    setFe(errors);
    if (Object.keys(errors).length) return focusFirstInvalid(form);
    setBusy(true);
    setError(null);
    try {
      const row = await api<AdminUserRowDto>(`/admin/users/${user.id}/email`, {
        method: 'PATCH',
        body: { email: email.trim(), currentPassword: password },
      });
      toast(t('emailSaved'));
      setEmail('');
      setPassword('');
      onSaved(row);
    } catch (err) {
      const mapped = errs.fields(err);
      setFe(mapped);
      setError(Object.keys(mapped).length ? tv('fixErrors') : errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('changeEmailTitle')}>
      <form onSubmit={submit} noValidate>
        <p className="mt-0 text-sm text-text-muted" dir="ltr">
          {user.email}
        </p>
        <Alert>{error}</Alert>
        <TextField
          id="ce-email"
          type="email"
          label={t('newEmail')}
          ltr
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fe.email}
        />
        <PasswordField
          id="ce-pw"
          label={t('yourPassword')}
          hint={t('yourPasswordHint')}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fe.currentPassword}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {tc('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Employer data (employers.update)
// ---------------------------------------------------------------------------

function EmployerCard({
  user,
  onSaved,
}: {
  user: AdminUserDetailDto;
  onSaved: (d: AdminUserDetailDto) => void;
}) {
  const t = useTranslations('admin.user');
  const ta = useTranslations('admin.approvals');
  const te = useTranslations('employer');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const toast = useToast();
  const errs = useApiErrors();
  const name = useLookupName();
  const options = useLookupOptions();
  const { lists } = useLookups(['sectors', 'business-types']);
  const e = user.employer!;
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ ...e, phone: localSaudiMobile(e.phone) });
  const [fe, setFe] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (ev: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: ev.target.value }));

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const errors: Record<string, string> = {};
    for (const k of [
      'contactName',
      'organizationName',
      'sectorId',
      'businessTypeId',
      'email',
      'phone',
    ] as const)
      if (!String(v[k] ?? '').trim()) errors[k] = tv('required');
    if (!errors.email && !isEmail(v.email)) errors.email = tv('email');
    setFe(errors);
    if (Object.keys(errors).length) return focusFirstInvalid(form);
    setBusy(true);
    setError(null);
    try {
      const saved = await api<AdminUserDetailDto>(`/admin/users/${user.id}/employer`, {
        method: 'PATCH',
        body: {
          contactName: v.contactName,
          organizationName: v.organizationName,
          sectorId: v.sectorId,
          businessTypeId: v.businessTypeId,
          email: v.email,
          phone: v.phone,
        },
      });
      onSaved(saved);
      toast(t('employerSaved'));
      setEditing(false);
    } catch (err) {
      const mapped = errs.fields(err);
      setFe(mapped);
      setError(Object.keys(mapped).length ? tv('fixErrors') : errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold">{t('employerData')}</h2>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Icon name="pencil" className="h-4 w-4" />
            {t('editEmployer')}
          </Button>
        )}
      </div>
      {editing ? (
        <form onSubmit={submit} noValidate>
          <Alert>{error}</Alert>
          <TextField
            id="ee-name"
            label={ta('name')}
            value={v.contactName}
            onChange={set('contactName')}
            error={fe.contactName}
          />
          <TextField
            id="ee-org"
            label={te('org')}
            value={v.organizationName}
            onChange={set('organizationName')}
            error={fe.organizationName}
          />
          <SelectField
            id="ee-sector"
            label={ta('sector')}
            options={options(lists.sectors, e.sectorId)}
            value={v.sectorId}
            onChange={set('sectorId')}
            error={fe.sectorId}
          />
          <SelectField
            id="ee-btype"
            label={ta('btype')}
            options={options(lists['business-types'], e.businessTypeId)}
            value={v.businessTypeId}
            onChange={set('businessTypeId')}
            error={fe.businessTypeId}
          />
          <TextField
            id="ee-email"
            type="email"
            ltr
            label={ta('email')}
            value={v.email}
            onChange={set('email')}
            error={fe.email}
          />
          <TextField
            id="ee-phone"
            type="tel"
            ltr
            label={ta('phone')}
            value={v.phone}
            onChange={set('phone')}
            error={fe.phone}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {tc('save')}
            </Button>
          </div>
        </form>
      ) : (
        <Kv
          rows={[
            [ta('name'), e.contactName],
            [te('org'), e.organizationName],
            [ta('sector'), name(lists.sectors?.find((s) => s.id === e.sectorId))],
            [ta('btype'), name(lists['business-types']?.find((s) => s.id === e.businessTypeId))],
            [
              ta('email'),
              <span key="e" dir="ltr">
                {e.email}
              </span>,
            ],
            [
              ta('phone'),
              <span key="p" dir="ltr">
                {localSaudiMobile(e.phone)}
              </span>,
            ],
            [
              t('approvalStatus'),
              <Badge
                key="a"
                variant={
                  e.approvalStatus === 'APPROVED'
                    ? 'match'
                    : e.approvalStatus === 'PENDING'
                      ? 'near'
                      : 'danger'
                }
                icon={
                  e.approvalStatus === 'APPROVED' ? 'check' : e.approvalStatus === 'PENDING' ? 'clock' : 'x'
                }
              >
                {t(`approval.${e.approvalStatus}`)}
              </Badge>,
            ],
          ]}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Seeker profile: the summary, ID reveal, and the wizard's step forms (?step=1..5)
// ---------------------------------------------------------------------------

function SeekerSection({ user }: { user: AdminUserDetailDto }) {
  const t = useTranslations('admin.user');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const base = `/admin/users/${user.id}/profile`;
  const profile = useApi<ProfileDto>(user.hasSeekerProfile ? base : null);
  const { lists, ready } = useLookups(['countries', 'dars', 'fakhdhs', 'education-levels', 'sectors']);
  const ctx = useMemo(
    () => ({ base, editHref: (n: number) => (n <= 5 ? `/admin/users/${user.id}?step=${n}` : null) }),
    [base, user.id],
  );
  const raw = Number(params.get('step'));
  const step = Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : null;

  return (
    <section className="mt-6" aria-labelledby="seeker-profile">
      <h2 id="seeker-profile" className="m-0 mb-3 text-xl font-semibold">
        {t('seekerProfile')}
      </h2>
      {!user.hasSeekerProfile ? (
        <p className="text-text-muted">{t('noProfile')}</p>
      ) : !profile.data || !ready ? (
        <LoadState
          loading={profile.loading || !ready}
          error={profile.error}
          title={tc('loadFailed')}
          onRetry={profile.reload}
          label={t('seekerProfile')}
        />
      ) : (
        <ProfileApiContext.Provider value={ctx}>
          {step && (step === 1 || profile.data.personal) ? (
            <StepEditor
              userId={user.id}
              n={step}
              profile={profile.data}
              lists={lists}
              onProfile={(p) => profile.setData(p)}
            />
          ) : (
            <ProfileSummary
              profile={profile.data}
              lists={lists}
              embedded
              idAction={profile.data.personal ? <RevealId userId={user.id} /> : undefined}
            />
          )}
        </ProfileApiContext.Provider>
      )}
    </section>
  );
}

function StepEditor({
  userId,
  n,
  profile,
  lists,
  onProfile,
}: {
  userId: string;
  n: number;
  profile: ProfileDto;
  lists: ReturnType<typeof useLookups>['lists'];
  onProfile: (p: ProfileDto) => void;
}) {
  const t = useTranslations('admin.user');
  const tp = useTranslations('profile');
  const router = useRouter();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const handle = useRef<StepHandle>(null);
  const [busy, setBusy] = useState(false);
  const Step = STEP_COMPONENTS[n - 1];
  const keys = ['personal', 'affiliation', 'contact', 'education', 'experience'] as const;
  const back = `/admin/users/${userId}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const saved = await handle.current?.save();
      if (!saved) return focusFirstInvalid(form.current);
      toast(tp('sectionSaved'));
      router.push(back);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="max-w-[720px]">
      <h3 className="m-0 mb-3 text-lg font-semibold">
        {t('editSection', { section: tp(`steps.${keys[n - 1]}`) })}
      </h3>
      <Step key={n} ref={handle} profile={profile} lists={lists} onProfile={onProfile} />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <ButtonLink href={back} variant="secondary">
          <Icon name="chev" className="h-4 w-4 rotate-180 rtl:rotate-0" />
          {t('backToProfile')}
        </ButtonLink>
        <Button type="submit" loading={busy}>
          {tp('saveSection')}
        </Button>
      </div>
    </form>
  );
}

/** Shows the decrypted ID number (seekers.id_number.reveal); the API records VIEW_SENSITIVE. */
function RevealId({ userId }: { userId: string }) {
  const t = useTranslations('admin.user');
  const errs = useApiErrors();
  const [value, setValue] = useState<RevealedIdDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      setValue(await api<RevealedIdDto>(`/admin/users/${userId}/profile/reveal-id`, { method: 'POST' }));
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <>
        <strong dir="ltr" data-testid="revealed-id" className="tabular-nums">
          {value.idNumber}
        </strong>
        <Button variant="ghost" size="sm" onClick={() => setValue(null)}>
          {t('hideId')}
        </Button>
      </>
    );
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={reveal} loading={busy} aria-describedby={`reveal-${userId}`}>
        <Icon name="eye" className="h-4 w-4" />
        {t('revealId')}
      </Button>
      <span id={`reveal-${userId}`} className="block w-full text-[13px] font-normal text-text-muted">
        {error ?? t('revealNote')}
      </span>
    </>
  );
}
