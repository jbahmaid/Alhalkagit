import { renderEmail } from './email-templates';
import { createSmsSender } from './sms';

describe('email templates', () => {
  it('renders Arabic right-to-left with the code', () => {
    const m = renderEmail({
      template: 'verifyEmail',
      to: 'a@b.c',
      locale: 'ar',
      vars: { code: '123456', minutes: 10 },
    });
    expect(m.subject).toContain('سَنَد');
    expect(m.html).toContain('dir="rtl"');
    expect(m.html).toContain('123456');
    expect(m.text).toContain('10');
  });

  it('renders English left-to-right', () => {
    const m = renderEmail({
      template: 'passwordReset',
      to: 'a@b.c',
      locale: 'en',
      vars: { code: '654321', minutes: 10 },
    });
    expect(m.subject).toMatch(/password/i);
    expect(m.html).toContain('dir="ltr"');
    expect(m.html).toContain('654321');
  });

  it('renders the employer approval with a button link', () => {
    const m = renderEmail({
      template: 'employerApproved',
      to: 'a@b.c',
      locale: 'ar',
      vars: { name: 'Org', link: 'https://x.test/ar/employer' },
    });
    expect(m.html).toContain('href="https://x.test/ar/employer"');
    expect(m.text).toContain('https://x.test/ar/employer');
    expect(m.html).toContain('Org');
  });

  it('renders the rejection with and without a reason, escaping HTML', () => {
    const withReason = renderEmail({
      template: 'employerRejected',
      to: 'a@b.c',
      locale: 'en',
      vars: { name: 'Org', reason: '<b>incomplete</b>' },
    });
    expect(withReason.html).toContain('&lt;b&gt;incomplete&lt;/b&gt;');
    expect(withReason.html).not.toContain('<b>incomplete</b>');
    const without = renderEmail({
      template: 'employerRejected',
      to: 'a@b.c',
      locale: 'en',
      vars: { name: 'Org', reason: null },
    });
    expect(without.text).not.toContain('{reason}');
    expect(without.text).not.toContain('null');
  });

  it('renders the new-interest email with the job title and link only', () => {
    const m = renderEmail({
      template: 'newInterest',
      to: 'a@b.c',
      locale: 'en',
      vars: { jobTitle: 'Accountant', link: 'https://x.test/en/employer/jobs/1/applicants' },
    });
    expect(m.subject).toContain('Accountant');
    expect(m.html).toContain('dir="ltr"');
    expect(m.text).toContain('https://x.test/en/employer/jobs/1/applicants');
    expect(m.text).not.toMatch(/\{\w+\}/);
  });
});

describe('SMS sender', () => {
  it('is disabled by default', async () => {
    const s = createSmsSender({ sms: { enabled: false, provider: 'log' } });
    expect(s.enabled).toBe(false);
    await expect(s.send('+966500000000', 'hi')).resolves.toEqual({ sent: false, reason: 'SMS_DISABLED' });
  });
  it('uses the stub provider when enabled', async () => {
    const s = createSmsSender({ sms: { enabled: true, provider: 'log' } });
    await expect(s.send('+966500000000', 'hi')).resolves.toEqual({ sent: true });
  });
});
