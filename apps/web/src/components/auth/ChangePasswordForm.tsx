'use client';

import { checkPassword, type SessionDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth-store';
import { focusFirstInvalid, useApiErrors } from '@/lib/errors';
import { homeFor } from '@/lib/roles';
import { useAuth } from '@/lib/use-auth';
import { Alert, Button, Card, Note, PageHeader, PasswordField, useToast } from '@/components/ui';

/** Change password; forced on the admin's first login (mustChangePassword). */
export function ChangePasswordForm() {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const errs = useApiErrors();
  const { user } = useAuth();
  const form = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!current) fe.currentPassword = t('validation.required');
    if (checkPassword(password)) fe.newPassword = t('validation.passwordPolicy');
    if (password2 !== password) fe.password2 = t('validation.passwordMismatch');
    setFieldErrors(fe);
    setFormError(null);
    if (Object.keys(fe).length) return focusFirstInvalid(form.current);
    setBusy(true);
    try {
      const session = await api<SessionDto>('/auth/password/change', {
        body: { currentPassword: current, newPassword: password },
      });
      setSession(session);
      toast(t('auth.change.done'));
      router.replace(homeFor(session.user.role));
    } catch (err) {
      const mapped = errs.fields(err);
      const code = (err as { code?: string }).code;
      if (code === 'AUTH_WRONG_PASSWORD') mapped.currentPassword = errs.message(err);
      if (code === 'AUTH_PASSWORD_REUSED') mapped.newPassword = errs.message(err);
      setFieldErrors(mapped);
      setFormError(errs.message(err));
      setBusy(false);
      focusFirstInvalid(form.current);
    }
  }

  return (
    <div className="mx-auto max-w-form">
      <PageHeader title={t('auth.change.title')} lead={t('auth.change.lead')} />
      {user?.mustChangePassword && (
        <Note kind="warn" icon="lock">
          {t('auth.change.forcedNote')}
        </Note>
      )}
      <Card>
        <form ref={form} noValidate onSubmit={onSubmit}>
          <Alert>{formError}</Alert>
          {/* Lets password managers attach the new password to the right account. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={user?.username ?? user?.email ?? ''}
            readOnly
            hidden
          />
          <PasswordField
            id="cp-current"
            name="currentPassword"
            label={t('auth.change.current')}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={fieldErrors.currentPassword}
          />
          <PasswordField
            id="cp-new"
            name="newPassword"
            label={t('auth.change.newPassword')}
            hint={t('auth.signup.pwHint')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.newPassword}
          />
          <PasswordField
            id="cp-new2"
            name="password2"
            label={t('auth.change.confirm')}
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            error={fieldErrors.password2}
          />
          <Button type="submit" block loading={busy}>
            {t('auth.change.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
