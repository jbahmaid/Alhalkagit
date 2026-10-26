'use client';

import { checkPassword } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { focusFirstInvalid, useApiErrors } from '@/lib/errors';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Note,
  OtpInput,
  PageHeader,
  PasswordField,
  useToast,
} from '@/components/ui';

export function ResetPasswordForm({ email }: { email?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!email) {
    return (
      <EmptyState
        title={t('auth.reset.title')}
        action={<ButtonLink href="/forgot-password">{t('auth.forgot.submit')}</ButtonLink>}
      />
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!/^\d{6}$/.test(code)) fe.code = t('validation.code');
    if (checkPassword(password)) fe.newPassword = t('validation.passwordPolicy');
    if (password2 !== password) fe.password2 = t('validation.passwordMismatch');
    setFieldErrors(fe);
    setFormError(null);
    if (Object.keys(fe).length) return focusFirstInvalid(form.current);
    setBusy(true);
    try {
      await api('/auth/password/reset', { body: { email, code, newPassword: password }, auth: false });
      router.replace('/login?notice=reset');
    } catch (err) {
      const mapped = errs.fields(err);
      if (!Object.keys(mapped).length && /CODE/.test((err as { code?: string }).code ?? ''))
        mapped.code = errs.message(err);
      setFieldErrors(mapped);
      setFormError(errs.message(err));
      setBusy(false);
      focusFirstInvalid(form.current);
    }
  }

  async function resend() {
    await api('/auth/password/forgot', { body: { email, locale }, auth: false }).catch(() => undefined);
    setInfo(t('auth.forgot.sent'));
    toast(t('auth.forgot.sent'));
  }

  return (
    <div className="mx-auto max-w-form">
      <PageHeader
        title={t('auth.reset.title')}
        lead={
          <>
            {t('auth.reset.lead')}{' '}
            <strong dir="ltr" className="break-all">
              {email}
            </strong>
          </>
        }
      />
      {info && <Note kind="info">{info}</Note>}
      <Card>
        <form ref={form} noValidate onSubmit={onSubmit}>
          <Alert>{formError}</Alert>
          <OtpInput
            id="rp-code"
            name="code"
            label={t('auth.reset.code')}
            value={code}
            onValueChange={setCode}
            error={fieldErrors.code}
          />
          <PasswordField
            id="rp-password"
            name="newPassword"
            label={t('auth.reset.newPassword')}
            hint={t('auth.signup.pwHint')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.newPassword}
          />
          <PasswordField
            id="rp-password2"
            name="password2"
            label={t('auth.reset.confirm')}
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            error={fieldErrors.password2}
          />
          <Button type="submit" block loading={busy}>
            {t('auth.reset.submit')}
          </Button>
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={resend}>
              {t('auth.reset.resend')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
