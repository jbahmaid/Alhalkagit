'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { focusFirstInvalid, isEmail, useApiErrors } from '@/lib/errors';
import { Alert, Button, Card, PageHeader, TextField, useToast } from '@/components/ui';

export function ForgotPasswordForm() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isEmail(email)) {
      setEmailError(t(email.trim() ? 'validation.email' : 'validation.required'));
      return focusFirstInvalid(form.current);
    }
    setEmailError(undefined);
    setFormError(null);
    setBusy(true);
    try {
      await api('/auth/password/forgot', { body: { email, locale }, auth: false });
      toast(t('auth.forgot.sent'));
      router.push(`/reset-password?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err) {
      setFormError(errs.message(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-form">
      <PageHeader title={t('auth.forgot.title')} lead={t('auth.forgot.lead')} />
      <Card>
        <form ref={form} noValidate onSubmit={onSubmit}>
          <Alert>{formError}</Alert>
          <TextField
            id="fp-email"
            name="email"
            type="email"
            label={t('auth.forgot.email')}
            autoComplete="email"
            ltr
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError}
          />
          <Button type="submit" block loading={busy}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
