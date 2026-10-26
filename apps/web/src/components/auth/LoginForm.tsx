'use client';

import type { PendingVerificationDto, SessionDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { setSession } from '@/lib/auth-store';
import { focusFirstInvalid, useApiErrors } from '@/lib/errors';
import { homeFor, safeNext } from '@/lib/roles';
import { useAuth } from '@/lib/use-auth';
import { Alert, Button, ButtonLink, Card, Note, PageHeader, PasswordField, TextField } from '@/components/ui';

/** S-02 Login: email or username (the system admin uses "admin") + password. */
export function LoginForm({ next, notice }: { next?: string; notice?: 'reset' | 'ended' }) {
  const t = useTranslations();
  const router = useRouter();
  const { status, user } = useAuth();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. back button): go to the user's area.
  useEffect(() => {
    if (status === 'authenticated' && user && !busy) {
      router.replace(user.mustChangePassword ? '/change-password' : (safeNext(next) ?? homeFor(user.role)));
    }
  }, [status, user, busy, next, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!identifier.trim()) fe.identifier = t('validation.required');
    if (!password) fe.password = t('validation.required');
    setFieldErrors(fe);
    setFormError(null);
    if (Object.keys(fe).length) return focusFirstInvalid(form.current);

    setBusy(true);
    try {
      const session = await api<SessionDto>('/auth/login', { body: { identifier, password }, auth: false });
      setSession(session);
      router.replace(
        session.user.mustChangePassword ? '/change-password' : (safeNext(next) ?? homeFor(session.user.role)),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_EMAIL_NOT_VERIFIED') {
        const d = err.details as PendingVerificationDto;
        router.push(`/verify-email?email=${encodeURIComponent(d.email)}&wait=${d.resendAvailableIn}`);
        return;
      }
      setFormError(errs.message(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-form">
      <PageHeader title={t('auth.login.title')} />
      {notice === 'reset' && (
        <Note kind="success" live="polite">
          {t('auth.login.resetDone')}
        </Note>
      )}
      {notice === 'ended' && <Note kind="info">{t('auth.login.sessionEnded')}</Note>}
      <Card>
        <form ref={form} noValidate onSubmit={onSubmit}>
          <Alert>{formError}</Alert>
          <TextField
            id="login-identifier"
            name="identifier"
            label={t('auth.login.identifier')}
            autoComplete="username"
            ltr
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            error={fieldErrors.identifier}
          />
          <PasswordField
            id="login-password"
            name="password"
            label={t('auth.login.password')}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />
          <Button type="submit" block loading={busy}>
            {t('auth.login.submit')}
          </Button>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <ButtonLink href="/forgot-password" variant="ghost" size="sm">
              {t('auth.login.forgot')}
            </ButtonLink>
            <span className="text-sm text-text-muted">
              {t('auth.login.noAccount')}{' '}
              <Link href="/signup" className="inline-flex min-h-touch items-center font-semibold">
                {t('common.signup')}
              </Link>
            </span>
          </div>
        </form>
      </Card>
    </div>
  );
}
