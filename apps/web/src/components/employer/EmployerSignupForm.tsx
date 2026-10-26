'use client';

import { checkPassword, normalizePhone, type PendingVerificationDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { focusFirstInvalid, isEmail, useApiErrors } from '@/lib/errors';
import { useLookupOptions, useLookups } from '@/lib/lookups';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Note,
  PageHeader,
  PasswordField,
  SelectField,
  TextField,
} from '@/components/ui';

/** S-10 Employer sign-up (FR-2.2.1). After email verification the account waits for approval. */
export function EmployerSignupForm({ initialEmail = '' }: { initialEmail?: string }) {
  const t = useTranslations();
  const te = useTranslations('employer');
  const locale = useLocale();
  const router = useRouter();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const { lists } = useLookups(['sectors', 'business-types']);
  const options = useLookupOptions();
  const [v, setV] = useState({
    contactName: '',
    organizationName: '',
    sectorId: '',
    businessTypeId: '',
    email: initialEmail,
    phone: '',
    password: '',
  });
  const [consentTerms, setConsentTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  function validate(): Record<string, string> {
    const fe: Record<string, string> = {};
    const required = t('validation.required');
    if (!v.contactName.trim()) fe.contactName = required;
    if (!v.organizationName.trim()) fe.organizationName = required;
    if (!v.sectorId) fe.sectorId = required;
    if (!v.businessTypeId) fe.businessTypeId = required;
    if (!isEmail(v.email)) fe.email = v.email.trim() ? t('validation.email') : required;
    if (!v.phone.trim()) fe.phone = required;
    else if (!normalizePhone(v.phone)) fe.phone = t('validation.phone');
    if (checkPassword(v.password)) fe.password = t('validation.passwordPolicy');
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
      const res = await api<PendingVerificationDto>('/auth/signup/employer', {
        body: { ...v, consentTerms, locale },
        auth: false,
      });
      router.push(
        `/verify-email?email=${encodeURIComponent(res.email)}&wait=${res.resendAvailableIn}&as=employer`,
      );
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
      <PageHeader title={te('signupTitle')} />
      <Card>
        <form ref={form} noValidate onSubmit={onSubmit}>
          <Note kind="privacy">{te('signupNote')}</Note>
          <Alert>{formError}</Alert>
          <TextField
            id="e-name"
            label={te('name')}
            autoComplete="name"
            value={v.contactName}
            onChange={set('contactName')}
            error={fieldErrors.contactName}
          />
          <TextField
            id="e-org"
            label={te('org')}
            autoComplete="organization"
            value={v.organizationName}
            onChange={set('organizationName')}
            error={fieldErrors.organizationName}
          />
          <SelectField
            id="e-sec"
            label={te('sector')}
            options={options(lists.sectors)}
            value={v.sectorId}
            onChange={set('sectorId')}
            error={fieldErrors.sectorId}
          />
          <SelectField
            id="e-btype"
            label={te('btype')}
            hint={te('btypeHint')}
            options={options(lists['business-types'])}
            value={v.businessTypeId}
            onChange={set('businessTypeId')}
            error={fieldErrors.businessTypeId}
          />
          <TextField
            id="e-email"
            type="email"
            label={te('email')}
            autoComplete="email"
            ltr
            value={v.email}
            onChange={set('email')}
            error={fieldErrors.email}
          />
          <TextField
            id="e-phone"
            type="tel"
            label={te('phone')}
            autoComplete="tel"
            inputMode="tel"
            ltr
            value={v.phone}
            onChange={set('phone')}
            error={fieldErrors.phone}
          />
          <PasswordField
            id="e-pw"
            label={te('password')}
            hint={te('pwHint')}
            autoComplete="new-password"
            value={v.password}
            onChange={set('password')}
            error={fieldErrors.password}
          />
          <Checkbox
            id="e-terms"
            label={te('consentTerms')}
            checked={consentTerms}
            onChange={(e) => setConsentTerms(e.target.checked)}
            error={fieldErrors.consentTerms}
          />
          <Button type="submit" block loading={busy} className="mt-2">
            {te('createAccount')}
          </Button>
          <p className="mb-0 mt-3 text-sm text-text-muted">
            {te('haveAccount')}{' '}
            <Link href="/login" className="inline-flex min-h-touch items-center font-semibold">
              {t('common.login')}
            </Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
