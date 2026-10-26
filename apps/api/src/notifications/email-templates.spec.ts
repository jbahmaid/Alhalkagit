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
