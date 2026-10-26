'use client';

import { checkPassword, type PendingVerificationDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { focusFirstInvalid, isEmail, useApiErrors } from '@/lib/errors';
import { Alert, Button, Card, Checkbox, PageHeader, PasswordField, TextField } from '@/components/ui';

/** S-03 Seeker sign-up with explicit consent (architecture section 8). */
export function SignupForm({ initialEmail = '' }: { initialEmail?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [consentShare, setConsentShare] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): Record<string, string> {
    const fe: Record<string, string> = {};
    if (!isEmail(email)) fe.email = t(email.trim() ? 'validation.email' : 'validation.required');
    if (checkPassword(password)) fe.password = t('validation.passwordPolicy');
    if (password2 !== password) fe.password2 = t('validation.passwordMismatch');
    if (!consentShare) fe.consentShare = t('validation.consent');
    if (!consentTerms) fe.consentTerms = t('validation.consent');
    return fe;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fe = validate();
    setFieldErrors(fe);
    setFormError(Object.keys(fe).length ? t('validation.fixErrors') : null);
    if (Object.keys(fe).length) return focusFirstInvalid(form.current);

    setBusy(true);
    try {
      const res = await api<PendingVerificationDto>('/auth/signup/seeker', {
        body: { email, password, consentShare, consentTerms, locale },
        auth: false,
      });
      router.push(`/verify-email?email=${encodeURIComponent(res.email)}&wait=${res.resendAvailableIn}`);
    } catch (err) {
      const mapped = errs.fields(err);
      if (err instanceof ApiError && err.code === 'AUTH_EMAIL_TAKEN') mapped.email = errs.message(err);
      setFieldErrors(mapped);
      setFormError(errs.message(err));
      setBusy(false);
      focusFirstInvalid(form.current);
    }
  }

  return (
    <div className="mx-auto max-w-form">
      <PageHeader title={t('auth.signup.title')} lead={t('auth.signup.lead')} />
      <Card>
        <form ref={form} noValidate onSubmit={onSubmit}>
          <Alert>{formError}</Alert>
          <TextField
            id="su-email"
            name="email"
            type="email"
            label={t('auth.signup.email')}
            autoComplete="email"
            ltr
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
          />
          <PasswordField
            id="su-password"
            name="password"
            label={t('auth.signup.password')}
            hint={t('auth.signup.pwHint')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />
          <PasswordField
            id="su-password2"
            name="password2"
            label={t('auth.signup.pw2')}
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            error={fieldErrors.password2}
          />
          <Checkbox
            id="su-consent"
            label={t('auth.signup.consentShare')}
            checked={consentShare}
            onChange={(e) => setConsentShare(e.target.checked)}
            error={fieldErrors.consentShare}
          />
          <Checkbox
            id="su-terms"
            label={t('auth.signup.consentTerms')}
            checked={consentTerms}
            onChange={(e) => setConsentTerms(e.target.checked)}
            error={fieldErrors.consentTerms}
          />
          <Button type="submit" block loading={busy} className="mt-2">
            {t('auth.signup.submit')}
          </Button>
          <p className="mb-0 mt-3 text-sm text-text-muted">
            {t('auth.signup.haveAccount')}{' '}
            <Link href="/login" className="inline-flex min-h-touch items-center font-semibold">
              {t('common.login')}
            </Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
