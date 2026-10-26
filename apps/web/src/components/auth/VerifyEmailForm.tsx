'use client';

import type { PendingVerificationDto, SessionDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { setSession } from '@/lib/auth-store';
import { focusFirstInvalid, useApiErrors } from '@/lib/errors';
import { mmss } from '@/lib/format';
import { homeFor } from '@/lib/roles';
import { Alert, Button, ButtonLink, Card, EmptyState, OtpInput, PageHeader, useToast } from '@/components/ui';
import { useCountdown } from './useCountdown';

/** S-04 Email verification: 6-digit code, resend after a countdown, change email. */
export function VerifyEmailForm({
  email,
  wait,
  employer = false,
}: {
  email?: string;
  wait: number;
  /** Came from the employer sign-up (S-10): "change email" goes back there. */
  employer?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const countdown = useCountdown(wait);

  if (!email) {
    return (
      <EmptyState
        icon="mail"
        title={t('auth.verify.title')}
        body={t('auth.verify.missingEmail')}
        action={<ButtonLink href="/signup">{t('common.signup')}</ButtonLink>}
      />
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!/^\d{6}$/.test(code)) {
      setCodeError(t('validation.code'));
      return focusFirstInvalid(form.current);
    }
    setCodeError(undefined);
    setBusy(true);
    try {
      const session = await api<SessionDto>('/auth/verify-email', { body: { email, code }, auth: false });
      setSession(session);
      toast(t('auth.verify.verified'));
      // New seekers start the profile wizard right away (S-05).
      router.replace(session.user.role === 'SEEKER' ? '/seeker/profile' : homeFor(session.user.role));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_ALREADY_VERIFIED') {
        router.replace('/login');
        return;
      }
      setCodeError(errs.message(err));
      setBusy(false);
      focusFirstInvalid(form.current);
    }
  }

  async function resend() {
    setResending(true);
    setFormError(null);
    try {
      const res = await api<PendingVerificationDto>('/auth/verify-email/resend', {
        body: { email },
        auth: false,
      });
      countdown.restart(res.resendAvailableIn);
      toast(t('auth.verify.codeSent'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_RESEND_COOLDOWN') {
        countdown.restart(Number((err.details as { retryAfter?: number })?.retryAfter ?? 60));
      }
      setFormError(errs.message(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto max-w-form">
      <PageHeader
        title={t('auth.verify.title')}
        lead={
          <>
            {t('auth.verify.lead')}{' '}
            <strong dir="ltr" className="break-all">
              {email}
            </strong>
          </>
        }
      />
      <Card>
        <form ref={form} noValidate onSubmit={onSubmit}>
          <Alert>{formError}</Alert>
          <OtpInput
            id="otp"
            name="code"
            label={t('auth.verify.code')}
            hint={t('auth.verify.codeHint')}
            value={code}
            onValueChange={setCode}
            error={codeError}
          />
          <Button type="submit" block loading={busy}>
            {t('auth.verify.submit')}
          </Button>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={resend}
              disabled={countdown.left > 0}
              loading={resending}
            >
              {countdown.left > 0
                ? t('auth.verify.resendIn', { time: mmss(countdown.left) })
                : t('auth.verify.resend')}
            </Button>
            <ButtonLink
              href={`${employer ? '/signup/employer' : '/signup'}?email=${encodeURIComponent(email)}`}
              variant="ghost"
              size="sm"
            >
              {t('auth.verify.changeEmail')}
            </ButtonLink>
          </div>
        </form>
      </Card>
    </div>
  );
}
