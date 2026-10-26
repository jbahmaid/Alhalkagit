/**
 * Batch 1 smoke test (Playwright, headless Chromium) against a running stack.
 *
 *   BASE_URL=http://localhost:3000 MAILPIT_URL=http://localhost:8025 \
 *   ADMIN_PASSWORD="$(docker compose exec -T api cat /app/secrets/admin-initial-password.txt)" \
 *   node e2e/batch1-smoke.cjs
 *
 * Needs the `playwright` package (npm i -g playwright && npx playwright install chromium).
 * Checks: home in Arabic RTL + switch to English, seeker sign-up with the emailed code,
 * session restore on reload, logout, admin first login with forced password change, login with
 * the admin email, 375px without horizontal scroll, and no console errors.
 */
const { chromium } = require('playwright');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MAILPIT = (process.env.MAILPIT_URL || 'http://localhost:8025').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jbahmaid@gmail.com';
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_NEW_PASSWORD = process.env.ADMIN_NEW_PASSWORD || 'Sanad-Admin-2026';

const results = [];
const consoleErrors = [];

function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    step(name, true, detail || '');
  } catch (err) {
    step(name, false, err.message.split('\n')[0]);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function codeFor(email, after = 0) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const data = await res.json();
    const msg = (data.messages || []).find((m) => new Date(m.Created).getTime() >= after);
    if (msg) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const m = /(\d{6})/.exec(full.Text);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email for ${email}`);
}

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
}

(async () => {
  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desktop.newPage();
  watch(page, 'desktop');

  await check('Home renders in Arabic, right-to-left', async () => {
    await page.goto(`${BASE}/`);
    await page.waitForURL(/\/ar$/);
    const dir = await page.getAttribute('html', 'dir');
    const lang = await page.getAttribute('html', 'lang');
    const h1 = await page.textContent('h1');
    assert(dir === 'rtl' && lang === 'ar', `dir=${dir} lang=${lang}`);
    assert(h1.includes('فرص عمل موثوقة'), `h1=${h1}`);
    return h1;
  });

  await check('Language switch goes to English (LTR) on the same page and back', async () => {
    await page.getByRole('button', { name: /Switch to English|التبديل إلى الإنجليزية/ }).click();
    await page.waitForURL(/\/en$/);
    await page.waitForFunction(() => document.documentElement.dir === 'ltr');
    const h1 = await page.textContent('h1');
    assert(h1.includes('Trusted job opportunities'), `h1=${h1}`);
    await page.goto(`${BASE}/en/login`);
    await page.getByRole('button', { name: /Switch to Arabic/ }).click();
    await page.waitForURL(/\/ar\/login$/);
    return h1;
  });

  const email = `seeker.${Date.now()}@example.com`;
  const seekerPassword = 'Passw0rd!2026';
  await check('Seeker sign-up -> emailed code -> verified -> seeker area', async () => {
    const started = Date.now() - 2000;
    await page.goto(`${BASE}/ar/signup`);
    await page.fill('#su-email', email);
    await page.fill('#su-password', seekerPassword);
    await page.fill('#su-password2', seekerPassword);
    await page.check('#su-consent');
    await page.check('#su-terms');
    await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
    await page.waitForURL(/\/ar\/verify-email\?/);
    const code = await codeFor(email, started);
    await page.fill('#otp', code);
    await page.getByRole('button', { name: 'تأكيد' }).click();
    await page.waitForURL(/\/ar\/seeker\/profile$/);
    await page.waitForSelector('h1:has-text("ملفي المهني")');
    return `${email}, code ${code}`;
  });

  await check('Session survives a reload (silent refresh via HttpOnly cookie)', async () => {
    await page.reload();
    await page.waitForSelector('h1:has-text("ملفي المهني")');
    const cookies = await desktop.cookies();
    const rt = cookies.find((c) => c.name === 'sanad_rt');
    assert(rt && rt.httpOnly && rt.path === '/api/auth' && rt.sameSite === 'Lax', 'refresh cookie flags');
    const token = await page.evaluate(
      () => JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage),
    );
    assert(!/eyJ/.test(token), 'access token must not be stored in web storage');
  });

  await check('Logout', async () => {
    await page.getByRole('button', { name: 'خروج' }).click();
    await page.waitForURL(/\/ar$/);
    await page.goto(`${BASE}/ar/seeker`);
    await page.waitForURL(/\/ar\/login\?next=/);
  });

  await check('Admin first login (username "admin") -> forced password change -> admin area', async () => {
    assert(ADMIN_PASSWORD, 'ADMIN_PASSWORD env is required');
    await page.goto(`${BASE}/ar/login`);
    await page.fill('#login-identifier', 'admin');
    await page.fill('#login-password', ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'دخول', exact: true }).last().click();
    await page.waitForURL(/\/ar\/change-password$/);
    await page.waitForSelector('text=هذه كلمة مرور مؤقتة');
    await page.fill('#cp-current', ADMIN_PASSWORD);
    await page.fill('#cp-new', ADMIN_NEW_PASSWORD);
    await page.fill('#cp-new2', ADMIN_NEW_PASSWORD);
    await page.getByRole('button', { name: 'تغيير كلمة المرور' }).click();
    await page.waitForURL(/\/ar\/admin$/);
    const lead = await page.textContent('main');
    assert(lead.includes('مرحباً، admin'), 'admin name shown');
    await page.getByRole('button', { name: 'خروج' }).click();
    await page.waitForURL(/\/ar$/);
  });

  await check('Admin can log in with the email address too', async () => {
    await page.goto(`${BASE}/en/login`);
    await page.fill('#login-identifier', ADMIN_EMAIL);
    await page.fill('#login-password', ADMIN_NEW_PASSWORD);
    await page.getByRole('button', { name: 'Log in', exact: true }).last().click();
    await page.waitForURL(/\/en\/admin$/);
    await page.waitForSelector('h1:has-text("Admin overview")');
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL(/\/en$/);
  });

  await check('Wrong password is refused (recorded as LOGIN_FAILED)', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: 'Wrong-pass-1' }),
    });
    const body = await res.json();
    assert(res.status === 401 && body.code === 'AUTH_INVALID_CREDENTIALS', `${res.status} ${body.code}`);
    return `${res.status} ${body.code}`;
  });

  const mobile = await browser.newContext({
    viewport: { width: 375, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  const m = await mobile.newPage();
  watch(m, 'mobile');
  for (const path of [
    '/ar',
    '/en',
    '/ar/login',
    '/ar/signup',
    '/ar/verify-email?email=someone%40example.com',
    '/ar/forgot-password',
    '/en/signup',
    '/ar/signup/employer',
  ]) {
    await check(`375px, no horizontal scroll: ${path}`, async () => {
      await m.goto(`${BASE}${path}`);
      await m.waitForLoadState('networkidle');
      const { sw, cw } = await m.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      assert(sw <= cw, `scrollWidth ${sw} > ${cw}`);
      const small = await m.evaluate(() =>
        [
          ...document.querySelectorAll(
            'main button, main a, main input:not([type=checkbox]):not([type=radio]):not([hidden])',
          ),
        ]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ h: el.getBoundingClientRect().height, t: el.textContent || el.id }))
          .filter((x) => x.h < 44),
      );
      assert(small.length === 0, `targets under 44px: ${JSON.stringify(small.slice(0, 3))}`);
      return `${sw}px`;
    });
  }

  step('No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
