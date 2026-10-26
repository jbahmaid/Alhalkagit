'use client';

import type { AccountDto, MeDto, PendingVerificationDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { setUser } from '@/lib/auth-store';
import { focusFirstInvalid, isEmail, useApiErrors } from '@/lib/errors';
import { useApi } from '@/lib/use-api';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Icon,
  Kv,
  Note,
  OtpInput,
  PageHeader,
  PasswordField,
  TextField,
  useToast,
} from '@/components/ui';
import { LoadState } from '@/components/jobs/job-ui';
import { SystemBadge, useRoleName } from '@/components/admin/admin-ui';

/**
 * "My account" for every role: login email (changed with the password and a code sent to the
 * new address) and a link to the password change. The system admin changes its email here too.
 */
export function AccountScreen() {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const roleName = useRoleName();
  const { data, setData, error, loading, reload } = useApi<AccountDto>('/me/account');

  if (!data) {
    return (
      <>
        <PageHeader title={t('title')} lead={t('lead')} />
        <LoadState
          loading={loading}
          error={error}
          title={tc('loadFailed')}
          onRetry={reload}
          label={t('title')}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-form">
      <PageHeader title={t('title')} lead={t('lead')} />
      <Card className="mb-4">
        <Kv
          rows={[
            [
              t('email'),
              <span key="e" dir="ltr" data-testid="account-email">
                {data.email}
              </span>,
            ],
            ...(data.username
              ? ([
                  [
                    t('username'),
                    <span key="u" dir="ltr">
                      {data.username}
                    </span>,
                  ],
                ] as [string, ReactNode][])
              : []),
            [t('role'), roleName(data.role)],
          ]}
        />
        {data.isSystemAccount && (
          <div className="mt-3">
            <SystemBadge />
          </div>
        )}
      </Card>
      <EmailChange account={data} onChanged={setData} />
      <Card>
        <h2 className="m-0 mb-1 text-lg font-semibold">{t('password')}</h2>
        <p className="mt-0 text-sm text-text-muted">{t('passwordLead')}</p>
        <ButtonLink href="/change-password" variant="secondary">
          <Icon name="lock" className="h-4 w-4" />
          {t('changePassword')}
        </ButtonLink>
      </Card>
    </div>
  );
}

function EmailChange({ account, onChanged }: { account: AccountDto; onChanged: (a: AccountDto) => void }) {
  const t = useTranslations('account');
  const tv = useTranslations('validation');
  const toast = useToast();
  const errs = useApiErrors();
  const [pending, setPending] = useState<string | null>(account.pendingEmail);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(e: FormEvent<HTMLFormElement>) {
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
      const res = await api<PendingVerificationDto>('/me/account/email', {
        method: 'POST',
        body: { email: email.trim(), currentPassword: password },
      });
      setPending(res.email);
      setPassword('');
      setCode('');
    } catch (err) {
      const mapped = errs.fields(err);
      setFe(mapped);
      setError(Object.keys(mapped).length ? tv('fixErrors') : errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!/^\d{6}$/.test(code)) {
      setFe({ code: tv('code') });
      return focusFirstInvalid(form);
    }
    setBusy(true);
    setError(null);
    setFe({});
    try {
      const updated = await api<AccountDto>('/me/account/email/confirm', { method: 'POST', body: { code } });
      onChanged(updated);
      setUser(await api<MeDto>('/me'));
      toast(t('emailChanged', { email: updated.email }));
      setPending(null);
      setEmail('');
      setCode('');
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <h2 className="m-0 mb-1 text-lg font-semibold">{t('changeEmail')}</h2>
      <p className="mt-0 text-sm text-text-muted">{t('changeEmailLead')}</p>
      <Alert>{error}</Alert>
      {pending ? (
        <form onSubmit={confirm} noValidate>
          <Note kind="info" live="polite">
            {t('codeSent', { email: pending })}
          </Note>
          <OtpInput id="ac-code" label={t('code')} value={code} onValueChange={setCode} error={fe.code} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              {t('confirm')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPending(null);
                setError(null);
              }}
              disabled={busy}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={request} noValidate>
          <TextField
            id="ac-email"
            type="email"
            label={t('newEmail')}
            ltr
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fe.email}
          />
          <PasswordField
            id="ac-pw"
            label={t('currentPassword')}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fe.currentPassword}
          />
          <Button type="submit" loading={busy}>
            {t('sendCode')}
          </Button>
        </form>
      )}
    </Card>
  );
}
