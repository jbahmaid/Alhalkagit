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

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Bilingual transactional emails. Arabic is rendered right-to-left. */
export function renderEmail(job: EmailJob): EmailMessage {
  const locale: Locale = job.locale === 'en' ? 'en' : 'ar';
  const t = DICT[locale];
  const section = t[job.template];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = locale === 'ar' ? 'right' : 'left';
  const expires = fill(t.expires, job.vars);
  const code = job.vars.code;

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(section.subject)}</title></head>
<body style="margin:0;padding:0;background:#F6F5F1;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;color:#1B2421">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F5F1;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:520px;background:#FFFFFF;border:1px solid #D9D6CC;border-radius:14px;text-align:${align}">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #D9D6CC">
          <div style="font-size:20px;font-weight:700;color:#0E5E58">${esc(t.brand)}</div>
          <div style="font-size:13px;color:#56615C">${esc(t.tagline)}</div>
        </td></tr>
        <tr><td style="padding:24px">
          <h1 style="font-size:20px;margin:0 0 12px">${esc(section.heading)}</h1>
          <p style="font-size:16px;line-height:1.7;margin:0 0 16px">${esc(section.intro)}</p>
          <p style="font-size:13px;color:#56615C;margin:0 0 4px">${esc(t.codeLabel)}</p>
          <p dir="ltr" style="font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 16px;color:#0E5E58;text-align:${align}">${esc(code)}</p>
          <p style="font-size:14px;color:#56615C;margin:0">${esc(expires)}</p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #D9D6CC;font-size:12px;color:#56615C">${esc(t.footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    t.brand,
    '',
    section.heading,
    section.intro,
    '',
    `${t.codeLabel}: ${code}`,
    expires,
    '',
    t.footer,
  ].join('\n');
  return { to: job.to, subject: section.subject, html, text };
}
