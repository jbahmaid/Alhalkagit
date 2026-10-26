import ar from './i18n/ar.json';
import en from './i18n/en.json';
import type { EmailJob, EmailMessage, Locale } from './email.types';

const DICT: Record<Locale, typeof ar> = { ar, en };

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function fill(s: string, vars: Record<string, string | number | null>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars && vars[k] !== null ? String(vars[k]) : `{${k}}`));
}

/** What goes between the header and the footer. */
interface Body {
  subject: string;
  heading: string;
  /** Paragraphs, plain text (escaped on render). */
  paragraphs: string[];
  /** One-time code shown large (verification and reset). */
  code?: { label: string; value: string; expires: string };
  /** Call-to-action button (absolute URL). */
  button?: { label: string; href: string };
  footer: string;
}

function body(job: EmailJob, t: (typeof DICT)['ar']): Body {
  switch (job.template) {
    case 'verifyEmail':
    case 'passwordReset':
    case 'emailChangeCode': {
      const s = t[job.template];
      return {
        subject: s.subject,
        heading: s.heading,
        paragraphs: [s.intro],
        code: { label: t.codeLabel, value: job.vars.code, expires: fill(t.expires, job.vars) },
        footer: t.footer,
      };
    }
    case 'employerApproved': {
      const s = t.employerApproved;
      return {
        subject: s.subject,
        heading: fill(s.heading, job.vars),
        paragraphs: [s.intro],
        button: { label: s.button, href: job.vars.link },
        footer: t.noticeFooter,
      };
    }
    case 'employerRejected': {
      const s = t.employerRejected;
      return {
        subject: s.subject,
        heading: fill(s.heading, job.vars),
        paragraphs: [
          s.intro,
          ...(job.vars.reason ? [`${s.reasonLabel}: ${job.vars.reason}`] : []),
          s.contact,
        ],
        footer: t.noticeFooter,
      };
    }
    case 'emailChanged': {
      const s = t.emailChanged;
      return {
        subject: s.subject,
        heading: s.heading,
        paragraphs: [fill(s.intro, job.vars)],
        footer: t.noticeFooter,
      };
    }
    case 'adminInvite': {
      const s = t.adminInvite;
      return {
        subject: s.subject,
        heading: fill(s.heading, job.vars),
        paragraphs: [s.intro, `${s.loginLabel}: ${job.vars.login}`],
        code: { label: s.passwordLabel, value: job.vars.password, expires: '' },
        button: { label: s.button, href: job.vars.link },
        footer: t.noticeFooter,
      };
    }
    case 'newInterest': {
      const s = t.newInterest;
      return {
        subject: fill(s.subject, job.vars),
        heading: s.heading,
        paragraphs: [fill(s.intro, job.vars)],
        button: { label: s.button, href: job.vars.link },
        footer: t.noticeFooter,
      };
    }
  }
}

/** Bilingual transactional emails. Arabic is rendered right-to-left. */
export function renderEmail(job: EmailJob): EmailMessage {
  const locale: Locale = job.locale === 'en' ? 'en' : 'ar';
  const t = DICT[locale];
  const b = body(job, t);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = locale === 'ar' ? 'right' : 'left';

  const paragraphs = b.paragraphs
    .map((p) => `<p style="font-size:16px;line-height:1.7;margin:0 0 16px">${esc(p)}</p>`)
    .join('\n          ');
  const code = b.code
    ? `<p style="font-size:13px;color:#56615C;margin:0 0 4px">${esc(b.code.label)}</p>
          <p dir="ltr" style="font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 16px;color:#0E5E58;text-align:${align};word-break:break-all">${esc(b.code.value)}</p>${
            b.code.expires
              ? `\n          <p style="font-size:14px;color:#56615C;margin:0">${esc(b.code.expires)}</p>`
              : ''
          }`
    : '';
  const button = b.button
    ? `<p style="margin:8px 0 0"><a href="${esc(b.button.href)}" style="display:inline-block;background:#0E5E58;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${esc(b.button.label)}</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(b.subject)}</title></head>
<body style="margin:0;padding:0;background:#F6F5F1;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;color:#1B2421">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F5F1;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:520px;background:#FFFFFF;border:1px solid #D9D6CC;border-radius:14px;text-align:${align}">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #D9D6CC">
          <div style="font-size:20px;font-weight:700;color:#0E5E58">${esc(t.brand)}</div>
          <div style="font-size:13px;color:#56615C">${esc(t.tagline)}</div>
        </td></tr>
        <tr><td style="padding:24px">
          <h1 style="font-size:20px;margin:0 0 12px">${esc(b.heading)}</h1>
          ${paragraphs}
          ${code}
          ${button}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #D9D6CC;font-size:12px;color:#56615C">${esc(b.footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    t.brand,
    '',
    b.heading,
    ...b.paragraphs,
    ...(b.code ? ['', `${b.code.label}: ${b.code.value}`, ...(b.code.expires ? [b.code.expires] : [])] : []),
    ...(b.button ? ['', `${b.button.label}: ${b.button.href}`] : []),
    '',
    b.footer,
  ].join('\n');
  return { to: job.to, subject: b.subject, html, text };
}
