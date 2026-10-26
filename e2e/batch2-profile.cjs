/**
 * Batch 2 smoke test: seeker profile wizard (S-05) and CV (S-06), against a running stack.
 *
 *   BASE_URL=http://localhost:3000 MAILPIT_URL=http://localhost:8025 node e2e/batch2-profile.cjs
 *
 * Needs the `playwright` package. Checks: sign-up lands in the wizard, validation messages,
 * "finish later", the six steps with three positions then deleting one, CV upload / wrong type /
 * replace / download, finishing (to the jobs list), editing a section from "ملفي", English, 375px without
 * horizontal scroll, and no console errors. Prints the seeker email for the audit query.
 */
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { makePdf, SAMPLE_CV } = require('./lib/pdf.cjs');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MAILPIT = (process.env.MAILPIT_URL || 'http://localhost:8025').replace(/\/$/, '');

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
    // The deliberate fake.pdf upload logs one 415; anything else counts.
    if (m.type() === 'error' && !/status of 415/.test(m.text())) consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
}

/** The profile as the API sees it (separate session, so the browser session is untouched). */
async function apiProfile(email, password) {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: email, password }),
  });
  const { accessToken } = await login.json();
  const res = await fetch(`${BASE}/api/me/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  return res.json();
}

const stepHeading = (page, n) => page.waitForSelector(`h2:has-text("الخطوة ${n} من 6")`);
const next = (page) => page.getByRole('button', { name: 'التالي' }).click();

(async () => {
  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await desktop.newPage();
  watch(page, 'desktop');

  const email = `profile.${Date.now()}@example.com`;
  const password = 'Passw0rd!2026';
  const idNumber = `1${String(Date.now()).slice(-9)}`;

  await check('Sign-up -> verified -> lands in the wizard at step 1 of 6', async () => {
    const started = Date.now() - 2000;
    await page.goto(`${BASE}/ar/signup`);
    await page.fill('#su-email', email);
    await page.fill('#su-password', password);
    await page.fill('#su-password2', password);
    await page.check('#su-consent');
    await page.check('#su-terms');
    await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
    await page.waitForURL(/\/ar\/verify-email\?/);
    await page.fill('#otp', await codeFor(email, started));
    await page.getByRole('button', { name: 'تأكيد' }).click();
    await page.waitForURL(/\/ar\/seeker\/profile$/);
    await stepHeading(page, 1);
    const nav = await page.getByRole('link', { name: 'ملفي' }).first().getAttribute('aria-current');
    assert(nav === 'page', 'ملفي is the current nav item');
    return email;
  });

  await check('Step 1: client validation, wrong ID format, age computed from the birth date', async () => {
    await next(page);
    await page.waitForSelector('[role=alert]:has-text("راجع الحقول المظللة")');
    await page.fill('#w-first', 'خالد');
    await page.fill('#w-father', 'سالم');
    await page.fill('#w-grand', 'عبدالله');
    await page.fill('#w-family', 'الحربي');
    await page.fill('#w-id', '3123');
    await page.getByLabel('ذكر').check();
    await page.fill('#w-birth', '1995-04-12');
    const age = await page.textContent('#age-out');
    assert(/31/.test(age), `age text: ${age}`);
    const firstCountry = await page.locator('#w-nat option').nth(1).textContent();
    assert(firstCountry.includes('السعودية'), `first country: ${firstCountry}`);
    const count = await page.locator('#w-nat option').count();
    await page.selectOption('#w-nat', { index: 1 });
    await page.getByRole('radio', { name: 'لا' }).check();
    await next(page);
    await page.waitForSelector('text=رقم الهوية 10 أرقام');
    await page.fill('#w-id', idNumber);
    await next(page);
    await page.waitForURL(/step=2$/);
    await stepHeading(page, 2);
    await page.waitForSelector('text=حُفظ تلقائياً');
    return `age ${age.match(/\d+/)[0]}, ${count - 1} countries`;
  });

  await check('Step 2: fakhdh list follows the chosen dar', async () => {
    assert(await page.locator('#w-fakhdh').isDisabled(), 'fakhdh disabled before a dar');
    await page.selectOption('#w-dar', { index: 1 });
    const options = await page.locator('#w-fakhdh option').allTextContents();
    assert(options.length >= 2, `fakhdh options: ${options.length}`);
    await page.selectOption('#w-fakhdh', { index: 1 });
    await next(page);
    await stepHeading(page, 3);
    return options.slice(1).join(' / ');
  });

  await check('Step 3: Saudi mobile (Arabic digits accepted), email prefilled', async () => {
    const prefilled = await page.inputValue('#w-email');
    assert(prefilled === email, `email prefilled: ${prefilled}`);
    await page.fill('#w-phone', '12345');
    await next(page);
    await page.waitForSelector('text=أدخل رقم جوال سعودي صحيح');
    await page.fill('#w-phone', '٠٥٠١٢٣٤٥٦٧');
    await next(page);
    await stepHeading(page, 4);
  });

  await check('"أكمل لاحقاً" on an untouched step -> home shows completion -> continue', async () => {
    await page.getByRole('button', { name: 'أكمل لاحقاً' }).click();
    await page.waitForURL(/\/ar\/seeker$/);
    await page.waitForSelector('text=حُفظ ملفك، يمكنك إكماله لاحقاً');
    await page.waitForSelector('text=50٪ مكتمل');
    await page.getByRole('link', { name: 'أكمل ملفي' }).click();
    await page.waitForURL(/\/ar\/seeker\/profile$/);
    await stepHeading(page, 4);
    return '50%';
  });

  await check('Step 4: education', async () => {
    await page.selectOption('#w-edu', { index: 1 });
    await page.fill('#w-grad', '2017');
    await page.selectOption('#w-gradc', { index: 1 });
    await page.fill('#w-inst', 'جامعة الملك سعود');
    await next(page);
    await stepHeading(page, 5);
  });

  await check('Step 5: three positions (one current), date order checked, verifier', async () => {
    await page.getByRole('radio', { name: 'نعم' }).check();
    await page.fill('#w-years', '6');
    const titles = ['محلل بيانات أول', 'محلل بيانات', 'متدرب تحليل'];
    const dates = [
      ['2023-02', null],
      ['2020-01', '2023-01'],
      ['2019-06', '2019-12'],
    ];
    for (let i = 0; i < 3; i++) {
      if (i > 0) await page.getByRole('button', { name: 'أضف منصباً آخر' }).click();
      const fs = page.locator('fieldset', { has: page.locator(`legend:text-is("المنصب ${i + 1}")`) });
      await fs.getByLabel('المسمى الوظيفي').fill(titles[i]);
      await fs.getByLabel('من', { exact: true }).fill(dates[i][0]);
      if (dates[i][1]) await fs.getByLabel('إلى', { exact: true }).fill(dates[i][1]);
      else await fs.getByLabel('ما زلت في هذا المنصب').check();
    }
    // wrong order on position 3 first
    const third = page.locator('fieldset', { has: page.locator('legend:text-is("المنصب 3")') });
    await third.getByLabel('إلى', { exact: true }).fill('2019-01');
    await page.fill('#w-ver-name', 'سعد العتيبي');
    await page.fill('#w-ver-phone', '0551112233');
    await next(page);
    await page.waitForSelector('text=تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
    await third.getByLabel('إلى', { exact: true }).fill('2019-12');
    await next(page);
    await stepHeading(page, 6);
    const p = await apiProfile(email, password);
    assert(p.experience.positions.length === 3, `positions ${p.experience.positions.length}`);
    assert(p.experience.positions[0].endDate === null, 'first is current');
    return p.experience.positions.map((x) => x.title).join(' | ');
  });

  await check('Back to step 5, delete one position, save', async () => {
    await page.getByRole('link', { name: 'السابق' }).click();
    await stepHeading(page, 5);
    assert((await page.locator('legend:has-text("المنصب")').count()) === 3, 'three positions shown');
    await page.getByRole('button', { name: /حذف المنصب\s+المنصب 2/ }).click();
    assert((await page.locator('legend:has-text("المنصب")').count()) === 2, 'two positions left');
    await next(page);
    await stepHeading(page, 6);
    const p = await apiProfile(email, password);
    const t = p.experience.positions.map((x) => x.title);
    assert(t.length === 2 && t[0] === 'محلل بيانات أول' && t[1] === 'متدرب تحليل', `positions: ${t}`);
    return t.join(' | ');
  });

  const cv1 = makePdf(SAMPLE_CV);
  const cv2 = makePdf([...SAMPLE_CV, 'Updated: Power BI certificate, 2024.']);
  await check('Step 6: analysis card shows "متاح عند التفعيل"; wrong type refused', async () => {
    await page.waitForSelector('#an-h');
    await page.waitForSelector('text=متاح عند التفعيل');
    const input = page.locator('input[type=file]');
    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.waitForSelector('[role=alert]:has-text("نوع الملف غير مدعوم")');
    // A text file renamed to .pdf passes the browser check but not the server's magic bytes.
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/me/profile/cv') && r.request().method() === 'POST'),
      input.setInputFiles({
        name: 'fake.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('not a pdf at all'),
      }),
    ]);
    assert(res.status() === 415, `server answered ${res.status()}`);
    await page.waitForSelector('[role=alert]:has-text("نوع الملف غير مدعوم")');
    return 'client check + server 415';
  });

  await check('CV upload (Arabic file name), replace keeps the earlier version, download', async () => {
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'سيرتي الذاتية.pdf', mimeType: 'application/pdf', buffer: cv1 });
    await page.waitForSelector('text=سيرتي الذاتية.pdf');
    await page.waitForSelector('text=تم الرفع');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'cv-v2.pdf', mimeType: 'application/pdf', buffer: cv2 });
    await page.waitForSelector('text=cv-v2.pdf');
    await page.waitForSelector('text=نسخة سابقة واحدة محفوظة');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'تنزيل' }).click(),
    ]);
    const body = readFileSync(await download.path());
    assert(download.suggestedFilename() === 'cv-v2.pdf', `name ${download.suggestedFilename()}`);
    assert(body.equals(cv2), `downloaded ${body.length} bytes, expected ${cv2.length}`);
    assert(/\/api\/files\//.test(download.url()) && !download.url().includes(':9000'), download.url());
    return `${body.length} bytes via ${new URL(download.url()).pathname.slice(0, 16)}…`;
  });

  await check('Remove CV (with confirmation), then upload again', async () => {
    await page.getByRole('button', { name: 'حذف', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'حذف', exact: true }).click();
    await page.waitForSelector('text=اختر ملف السيرة');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'cv-final.pdf', mimeType: 'application/pdf', buffer: cv2 });
    await page.waitForSelector('text=cv-final.pdf');
  });

  await check('Finish -> ranked jobs (S-07), then the summary with every section', async () => {
    await page.getByRole('button', { name: 'إنهاء وعرض الفرص' }).click();
    await page.waitForURL(/\/ar\/seeker\/jobs$/);
    await page.waitForSelector('text=اكتمل ملفك. هذه الفرص مرتبة حسب ملاءمتها لك.');
    await page.getByRole('link', { name: 'ملفي' }).first().click();
    await page.waitForURL(/\/ar\/seeker\/profile$/);
    await page.waitForSelector('text=مكتمل');
    const sections = await page.locator('main h2').allTextContents();
    for (const s of ['البيانات الشخصية', 'الدار والفخذ', 'التواصل', 'التعليم', 'الخبرات', 'السيرة الذاتية']) {
      assert(sections.includes(s), `section ${s}`);
    }
    const main = await page.textContent('main');
    assert(
      main.includes('0501234567') && main.includes('حتى الآن') && main.includes('cv-final.pdf'),
      'summary data',
    );
    assert(!main.includes(idNumber) && main.includes(idNumber.slice(-4)), 'ID masked');
    const p = await apiProfile(email, password);
    assert(p.completionStep === 'COMPLETED' && p.percent === 100, `${p.completionStep} ${p.percent}`);
    return `${p.completionStep}, ${p.percent}%`;
  });

  await check('Edit a section from ملفي (contact) and return to the summary', async () => {
    await page.getByRole('link', { name: 'ملفي' }).first().click();
    await page.getByRole('link', { name: 'تعديل التواصل' }).click();
    await page.waitForURL(/step=3$/);
    await page.fill('#w-phone', '0559876543');
    await page.getByRole('button', { name: 'حفظ التعديلات' }).click();
    await page.waitForURL(/\/ar\/seeker\/profile$/);
    await page.waitForSelector('text=0559876543');
    const p = await apiProfile(email, password);
    assert(p.contact.mobile === '+966559876543', p.contact.mobile);
    return p.contact.mobile;
  });

  await check('Seeker home shows 100% complete', async () => {
    await page.goto(`${BASE}/ar/seeker`);
    await page.waitForSelector('text=100٪ مكتمل');
  });

  await check('English: summary and the experience step', async () => {
    await page.goto(`${BASE}/en/seeker/profile`);
    await page.waitForSelector('h1:has-text("My professional profile")');
    await page.waitForSelector('h2:has-text("Experience")');
    assert((await page.getAttribute('html', 'dir')) === 'ltr', 'ltr');
    await page.goto(`${BASE}/en/seeker/profile?step=5`);
    await page.waitForSelector('h2:has-text("Step 5 of 6: Experience")');
    await page.waitForSelector('legend:has-text("Position 2")');
    await page.waitForSelector('text=I currently hold this position');
    await page.goto(`${BASE}/en/seeker/profile?step=6`);
    await page.waitForSelector('text=Available when activated');
  });

  // Mobile last: it takes over the refresh cookie (rotation), so the desktop page is done.
  const mobile = await browser.newContext({
    viewport: { width: 375, height: 740 },
    isMobile: true,
    hasTouch: true,
    storageState: await desktop.storageState(),
  });
  const m = await mobile.newPage();
  watch(m, 'mobile');
  for (const path of [
    '/ar/seeker',
    '/ar/seeker/profile',
    '/ar/seeker/profile?step=1',
    '/ar/seeker/profile?step=2',
    '/ar/seeker/profile?step=4',
    '/ar/seeker/profile?step=5',
    '/ar/seeker/profile?step=6',
    '/en/seeker/profile?step=5',
    '/en/seeker/profile',
  ]) {
    await check(`375px, no horizontal scroll: ${path}`, async () => {
      await m.goto(`${BASE}${path}`);
      await m.waitForSelector('main h1');
      await m.waitForLoadState('networkidle');
      await m.waitForSelector('main form, main h2');
      const { sw, cw } = await m.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      assert(sw <= cw, `scrollWidth ${sw} > ${cw}`);
      const small = await m.evaluate(() =>
        [
          ...document.querySelectorAll(
            'main button, main a, main select, main input:not([type=checkbox]):not([type=radio]):not(.sr-only)',
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
  console.log(`\nseeker: ${email}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
