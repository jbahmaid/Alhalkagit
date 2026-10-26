/**
 * Batch 3 journey: employer, jobs, matching and interest requests, against a running stack.
 *
 *   ADMIN_PASSWORD="$(docker compose exec -T api cat /app/secrets/admin-initial-password.txt)" \
 *   BASE_URL=http://localhost:3000 MAILPIT_URL=http://localhost:8025 node e2e/batch3-jobs.cjs
 *
 * Needs the `playwright` package (and `docker compose` for the audit query at the end).
 * The employer signs up (S-10), waits (S-11), is approved through the admin API, posts one job
 * that fits the seeker and one that does not (S-13). The seeker finishes the wizard (with the
 * position sector) and lands on the ranked list (S-07) with the badges and order, sees "why it
 * fits" (S-08), expresses interest with consent, and every API response and page the seeker
 * gets is scanned for the employer's name, organization, email and phone. The employer gets the
 * email in Mailpit, sees the applicant (S-14/S-15) with the CV link, closes the job as hired
 * (S-16), the counter goes up and the seeker sees "no longer available" (S-09). Then another
 * employer is refused the applicants, English, 375px, console errors and the audit rows.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { makePdf, SAMPLE_CV } = require('./lib/pdf.cjs');

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
    if (process.env.SHOT_DIR) {
      for (const [i, p] of shotPages.entries()) {
        await p
          .screenshot({ path: `${process.env.SHOT_DIR}/fail-${results.length}-${i}.png`, fullPage: true })
          .catch(() => {});
      }
    }
  }
}
const shotPages = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function mailsTo(email, after = 0) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  const data = await res.json();
  return (data.messages || []).filter((m) => new Date(m.Created).getTime() >= after);
}
async function mailFor(email, after, match) {
  for (let i = 0; i < 60; i++) {
    for (const m of await mailsTo(email, after)) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      if (!match || match(full)) return full;
    }
    await wait(500);
  }
  throw new Error(`no matching email for ${email}`);
}
const codeFor = async (email, after) =>
  /(\d{6})/.exec((await mailFor(email, after, (m) => /\d{6}/.test(m.Text))).Text)[1];

async function call(path, opts = {}) {
  // The auth routes are rate limited per IP (10 a minute); wait and retry instead of failing.
  for (let i = 0; ; i++) {
    const r = await callOnce(path, opts);
    if (r.status !== 429 || i >= 15) return r;
    await wait(5000);
  }
}
async function callOnce(path, { token, method, body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
async function login(identifier, password) {
  const r = await call('/auth/login', { body: { identifier, password } });
  return r.status === 200 ? r.json : null;
}
async function adminToken() {
  let s = ADMIN_PASSWORD ? await login('admin', ADMIN_PASSWORD) : null;
  if (s && s.user.mustChangePassword) {
    const r = await call('/auth/password/change', {
      token: s.accessToken,
      body: { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_NEW_PASSWORD },
    });
    assert(r.status < 300, `admin password change ${r.status}`);
    s = await login(ADMIN_EMAIL, ADMIN_NEW_PASSWORD);
  }
  if (!s) s = await login(ADMIN_EMAIL, ADMIN_NEW_PASSWORD);
  assert(s && !s.user.mustChangePassword, 'admin login (set ADMIN_PASSWORD)');
  return s.accessToken;
}
async function lookup(type, code) {
  const r = await call(`/lookups/${type}`);
  const item = r.json.find((x) => x.code === code);
  assert(item, `${type}/${code}`);
  return item;
}

function watch(page, label) {
  page.on('console', (m) => {
    // Deliberate refusals checked below log one 403/404 each in the console.
    if (m.type() === 'error' && !/status of (40[34]|429)/.test(m.text()))
      consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
}

(async () => {
  const ts = Date.now();
  const emp = {
    contactName: 'سارة القحطاني',
    organizationName: `شركة مدار التقنية ${ts}`,
    email: `employer.${ts}@example.com`,
    phoneLocal: '0503334444',
    password: 'Employer-Pass-2026',
  };
  const seeker = {
    email: `seeker3.${ts}@example.com`,
    password: 'Seeker-Pass-2026',
    idNumber: `1${String(ts * 7).slice(-9)}`,
    mobile: '0551239876',
  };
  const fitTitle = `محلل بيانات ${String(ts).slice(-4)}`;
  const farTitle = `ممرض طوارئ ${String(ts).slice(-4)}`;
  const [it, health, bachelor, doctorate, sa, dar, fakhdh] = await Promise.all([
    lookup('sectors', 'IT'),
    lookup('sectors', 'HEALTH'),
    lookup('education-levels', 'BACHELOR'),
    lookup('education-levels', 'DOCTORATE'),
    lookup('countries', 'SA'),
    lookup('dars', 'SAMPLE_DAR_1'),
    lookup('fakhdhs', 'SAMPLE_FAKHDH_1A'),
  ]);

  const browser = await chromium.launch();
  const empCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const ep = await empCtx.newPage();
  watch(ep, 'employer');
  shotPages.push(ep);

  let admin;
  let empToken;
  let seekerToken;
  let employerId;
  let fitJobId;
  let farJobId;
  let interestId;

  await check('S-10 employer sign-up -> email code -> S-11 pending with disabled "post job"', async () => {
    const started = Date.now() - 2000;
    await ep.goto(`${BASE}/ar/signup/employer`);
    await ep.getByRole('button', { name: 'إنشاء الحساب' }).click();
    await ep.waitForSelector('[role=alert]:has-text("راجع الحقول المظللة")');
    await ep.fill('#e-name', emp.contactName);
    await ep.fill('#e-org', emp.organizationName);
    await ep.selectOption('#e-sec', it.id);
    await ep.selectOption('#e-btype', { index: 1 });
    await ep.fill('#e-email', emp.email);
    await ep.fill('#e-phone', emp.phoneLocal);
    await ep.fill('#e-pw', emp.password);
    await ep.check('#e-terms');
    await ep.getByRole('button', { name: 'إنشاء الحساب' }).click();
    await ep.waitForURL(/\/ar\/verify-email\?.*as=employer/);
    await ep.fill('#otp', await codeFor(emp.email, started));
    await ep.getByRole('button', { name: 'تأكيد' }).click();
    await ep.waitForURL(/\/ar\/employer$/);
    await ep.waitForSelector('h1:has-text("حسابك بانتظار الاعتماد")');
    const btn = ep.getByRole('button', { name: 'نشر فرصة جديدة' });
    assert((await btn.getAttribute('aria-disabled')) === 'true', 'post button disabled');
    assert((await ep.textContent('#pd-why')).includes('يتاح نشر الفرص بعد اعتماد حسابك'), 'reason shown');
    await ep.goto(`${BASE}/ar/employer/jobs/new`);
    await ep.waitForSelector('h1:has-text("حسابك بانتظار الاعتماد")');
  });

  await check('Server refuses a job from the unapproved employer (403 EMPLOYER_NOT_APPROVED)', async () => {
    empToken = (await login(emp.email, emp.password)).accessToken;
    const r = await call('/employer/jobs', {
      token: empToken,
      body: {
        title: 'x',
        description: 'وصف تجريبي طويل بما يكفي للتحقق.',
        sectorId: it.id,
        city: 'الرياض',
        countryId: sa.id,
        minYearsExperience: 0,
        employmentType: 'FULL_TIME',
      },
    });
    assert(
      r.status === 403 && r.json.code === 'EMPLOYER_NOT_APPROVED',
      `${r.status} ${r.json && r.json.code}`,
    );
    return `${r.status} ${r.json.code}`;
  });

  await check('Admin API approves the employer; approval email arrives', async () => {
    const started = Date.now() - 2000;
    admin = await adminToken();
    const list = await call('/admin/employers?status=PENDING', { token: admin });
    const row = list.json.find((e) => e.email === emp.email);
    assert(row, 'pending employer listed');
    employerId = row.id;
    const r = await call(`/admin/employers/${employerId}/approve`, { token: admin, body: {} });
    assert(r.status < 300 && r.json.approvalStatus === 'APPROVED', `approve ${r.status}`);
    const again = await call(`/admin/employers/${employerId}/approve`, { token: admin, body: {} });
    assert(again.status === 409, `second approve ${again.status}`);
    const mail = await mailFor(emp.email, started, (m) => /\/ar\/employer/.test(m.Text));
    return mail.Subject;
  });

  await check('S-12 dashboard, S-13 post two jobs (one fits the seeker, one does not)', async () => {
    await ep.goto(`${BASE}/ar/employer`);
    await ep.waitForSelector('h1:has-text("لوحة صاحب العمل")');
    await ep.waitForSelector(`text=${emp.organizationName}`);
    const post = async (j) => {
      await ep.getByRole('link', { name: 'نشر فرصة جديدة' }).click();
      await ep.waitForSelector('h1:has-text("نشر فرصة")');
      await ep.waitForFunction(() => document.querySelectorAll('#pj-sec option').length > 1);
      await ep.fill('#pj-title', j.title);
      await ep.selectOption('#pj-sec', j.sector);
      await ep.fill('#pj-city', j.city);
      await ep.selectOption('#pj-edu', j.edu);
      await ep.fill('#pj-years', String(j.years));
      await ep.fill('#pj-desc', j.desc);
      await ep.getByRole('button', { name: 'نشر الفرصة' }).click();
      await ep.waitForURL(/\/ar\/employer$/);
      await ep.waitForSelector(`text=${j.title}`);
    };
    await post({
      title: fitTitle,
      sector: it.id,
      city: 'الرياض',
      edu: bachelor.id,
      years: 3,
      desc: 'تحليل بيانات المبيعات وبناء لوحات متابعة أسبوعية للإدارة باستخدام SQL و Power BI.',
    });
    await post({
      title: farTitle,
      sector: health.id,
      city: 'جدة',
      edu: doctorate.id,
      years: 10,
      desc: 'رعاية المرضى في قسم الطوارئ والعمل بنظام المناوبات في المستشفى.',
    });
    const open = await ep.textContent('[data-stat=open]');
    assert(open.trim() === '2', `open jobs ${open}`);
    const dash = await call('/employer/dashboard', { token: empToken });
    fitJobId = dash.json.jobs.find((j) => j.title === fitTitle).id;
    farJobId = dash.json.jobs.find((j) => j.title === farTitle).id;
    return `open=${open.trim()}`;
  });

  // ---- Seeker ----
  const seekCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await seekCtx.newPage();
  watch(sp, 'seeker');
  shotPages.push(sp);
  const seen = []; // every API body and page the seeker receives
  sp.on('response', async (res) => {
    if (!res.url().includes('/api/')) return;
    try {
      seen.push({ where: res.url(), text: await res.text() });
    } catch {
      /* body not available (redirect / aborted) */
    }
  });
  const snap = async (label) => seen.push({ where: `page ${label}`, text: await sp.content() });

  await check(
    'Seeker: steps 1-4 via API, step 5 in the wizard with a position sector, CV, finish -> S-07',
    async () => {
      const started = Date.now() - 2000;
      const su = await call('/auth/signup/seeker', {
        body: {
          email: seeker.email,
          password: seeker.password,
          consentShare: true,
          consentTerms: true,
          locale: 'ar',
        },
      });
      assert(su.status < 300, `signup ${su.status}`);
      const v = await call('/auth/verify-email', {
        body: { email: seeker.email, code: await codeFor(seeker.email, started) },
      });
      const token = v.json.accessToken;
      seekerToken = token;
      const patch = async (part, body) => {
        const r = await call(`/me/profile/${part}`, { token, method: 'PATCH', body });
        assert(r.status === 200, `${part} ${r.status} ${JSON.stringify(r.json)}`);
      };
      await patch('personal', {
        firstName: 'خالد',
        fatherName: 'سالم',
        grandfatherName: 'محمد',
        familyName: 'الحربي',
        idType: 'NATIONAL_ID',
        idNumber: seeker.idNumber,
        gender: 'MALE',
        birthDate: '1994-03-10',
        nationalityId: sa.id,
        hasSpecialNeeds: false,
      });
      await patch('affiliation', { darId: dar.id, fakhdhId: fakhdh.id });
      await patch('contact', { mobile: seeker.mobile, email: seeker.email });
      await patch('education', {
        educationLevelId: bachelor.id,
        graduationYear: 2016,
        institution: 'جامعة الملك سعود',
        countryId: sa.id,
        fieldOfStudy: 'نظم المعلومات',
      });

      await sp.goto(`${BASE}/ar/login`);
      await sp.fill('#login-identifier', seeker.email);
      await sp.fill('#login-password', seeker.password);
      // Login is rate limited per IP: if the earlier suites used it up, wait and try again.
      for (let i = 0; i < 12; i++) {
        await sp.getByRole('button', { name: 'دخول' }).click();
        const where = await Promise.race([
          sp.waitForURL(/\/ar\/seeker$/).then(() => 'in'),
          sp.waitForSelector('main [role=alert]').then(() => 'alert'),
        ]);
        if (where === 'in') break;
        await wait(6000);
      }
      await sp.waitForURL(/\/ar\/seeker$/);
      for (const label of ['الفرص', 'طلباتي', 'ملفي']) {
        assert(await sp.getByRole('link', { name: label }).first().isVisible(), `nav ${label}`);
      }
      await sp.goto(`${BASE}/ar/seeker/profile?step=5`);
      await sp.waitForSelector('h2:has-text("الخطوة 5 من 6")');
      await sp.getByRole('radio', { name: 'نعم' }).check();
      await sp.fill('#w-years', '6');
      const fs = sp.locator('fieldset', { has: sp.locator('legend:text-is("المنصب 1")') });
      await fs.getByLabel('المسمى الوظيفي').fill('محلل بيانات');
      await fs.getByLabel('قطاع العمل').selectOption(it.id);
      await fs.getByLabel('من', { exact: true }).fill('2019-01');
      await fs.getByLabel('ما زلت في هذا المنصب').check();
      await sp.getByRole('button', { name: 'التالي' }).click();
      await sp.waitForSelector('h2:has-text("الخطوة 6 من 6")');
      await sp
        .locator('input[type=file]')
        .setInputFiles({ name: 'cv-khaled.pdf', mimeType: 'application/pdf', buffer: makePdf(SAMPLE_CV) });
      await sp.waitForSelector('text=cv-khaled.pdf');
      await sp.getByRole('button', { name: 'إنهاء وعرض الفرص' }).click();
      await sp.waitForURL(/\/ar\/seeker\/jobs$/);
      await sp.waitForSelector('text=اكتمل ملفك. هذه الفرص مرتبة حسب ملاءمتها لك.');
    },
  );

  await check(
    'S-07: fitting job first with "مناسبة" badge (icon, word, score); other job after, no badge',
    async () => {
      await sp.waitForSelector(`h2:has-text("${fitTitle}")`);
      await sp.waitForSelector(`h2:has-text("${farTitle}")`);
      const titles = await sp.locator('main [role=article] h2').allTextContents();
      const iFit = titles.indexOf(fitTitle);
      const iFar = titles.indexOf(farTitle);
      assert(iFit >= 0 && iFar > iFit, `order: ${titles.join(' | ')}`);
      const fitCard = sp.locator('[role=article]', { has: sp.locator(`h2:text-is("${fitTitle}")`) });
      // Scores stored while the profile was incomplete are recomputed by the worker a few
      // seconds after "finish" (debounced); until then the list shows the stored ones.
      for (let i = 0; i < 10 && !(await fitCard.locator('span.rounded-pill').count()); i++) {
        await wait(2000);
        await sp.reload();
        await sp.waitForSelector(`h2:has-text("${fitTitle}")`);
      }
      const badge = (await fitCard.locator('span.rounded-pill').first().textContent()).replace(/\s+/g, ' ');
      assert(/مناسبة · درجة الملاءمة \d+/.test(badge), `badge "${badge}"`);
      const score = Number(/(\d+)$/.exec(badge.trim())[1]);
      assert(score >= 90, `score ${score}`);
      assert((await fitCard.locator('span.rounded-pill svg').count()) >= 1, 'badge has an icon');
      const farCard = sp.locator('[role=article]', { has: sp.locator(`h2:text-is("${farTitle}")`) });
      assert(!(await farCard.textContent()).includes('مناسبة'), 'no badge on the far job');
      await sp.check('#jf');
      await sp.waitForFunction((t) => !document.body.textContent.includes(t), farTitle);
      assert(await sp.locator(`h2:has-text("${fitTitle}")`).isVisible(), 'fit filter keeps the fitting job');
      await sp.uncheck('#jf');
      await sp.waitForSelector(`h2:has-text("${farTitle}")`);
      await snap('S-07');
      return badge;
    },
  );

  await check('S-08: why it fits; consent dialog gates "send"; sent state', async () => {
    await sp
      .locator('[role=article]', { has: sp.locator(`h2:text-is("${fitTitle}")`) })
      .getByRole('link', { name: 'عرض التفاصيل' })
      .click();
    await sp.waitForURL(new RegExp(`/ar/seeker/jobs/${fitJobId}$`));
    await sp.waitForSelector(`h1:has-text("${fitTitle}")`);
    for (const why of ['القطاع يطابق خبرتك', 'مؤهلك يحقق المستوى المطلوب', 'سنوات خبرتك تحقق المطلوب']) {
      await sp.waitForSelector(`text=${why}`);
    }
    await snap('S-08');
    await sp.getByRole('button', { name: 'طلب اهتمام' }).click();
    const dlg = sp.getByRole('dialog');
    await dlg.waitFor();
    for (const item of ['سيرتك الذاتية', 'رقم جوالك وبريدك', 'لا يُرسل رقم هويتك ولا الدار والفخذ']) {
      assert((await dlg.textContent()).includes(item), `dialog lists ${item}`);
    }
    const send = dlg.getByRole('button', { name: 'إرسال الطلب' });
    assert(await send.isDisabled(), 'send disabled before consent');
    await dlg.getByLabel('أوافق على مشاركة هذه البيانات').check();
    await send.click();
    await sp.waitForSelector('main >> text=أُرسل طلب الاهتمام');
    await sp.waitForSelector('text=تابع حالته من "طلباتي"');
    await snap('S-08 sent');
    const far = await call(`/jobs/${farJobId}`, {
      token: seekerToken,
    });
    assert(far.json.match.label === 'NONE', `far job label ${far.json.match.label}`);
  });

  await check(
    'Employer gets the new-interest email (ar) with the link, without ID, dar or fakhdh',
    async () => {
      const mail = await mailFor(emp.email, ts, (m) => m.Text.includes(fitTitle));
      const all = `${mail.Subject}\n${mail.Text}\n${mail.HTML}`;
      assert(all.includes(`/ar/employer/jobs/${fitJobId}/applicants`), 'link to applicants');
      for (const bad of [seeker.idNumber, dar.nameAr, fakhdh.nameAr, 'خالد']) {
        assert(!all.includes(bad), `email contains ${bad}`);
      }
      return mail.Subject;
    },
  );

  await check(
    'S-14/S-15: employer sees the applicant, contact buttons and a 5-minute CV link; no ID, dar or fakhdh',
    async () => {
      await ep.goto(`${BASE}/ar/employer`);
      await ep.waitForFunction(
        () => document.querySelector('[data-stat=requests]')?.textContent.trim() === '1',
      );
      await ep.goto(`${BASE}/ar/employer/jobs/${fitJobId}/applicants`);
      await ep.waitForSelector('h2:has-text("خالد سالم محمد الحربي")');
      await ep.waitForSelector('main >> text=مناسبة');
      await ep.getByRole('link', { name: 'عرض الملف' }).click();
      await ep.waitForSelector('h1:has-text("خالد سالم محمد الحربي")');
      interestId = ep.url().split('/').pop();
      const main = await ep.textContent('main');
      for (const want of ['0551239876', seeker.email, 'جامعة الملك سعود', 'محلل بيانات', 'cv-khaled.pdf']) {
        assert(main.includes(want), `shows ${want}`);
      }
      for (const bad of [
        seeker.idNumber,
        seeker.idNumber.slice(-4),
        dar.nameAr,
        fakhdh.nameAr,
        'الدار',
        'الفخذ',
      ]) {
        assert(!main.includes(bad), `must not show ${bad}`);
      }
      assert(
        (await ep.getByRole('link', { name: 'اتصال' }).getAttribute('href')) === 'tel:+966551239876',
        'tel link',
      );
      assert(
        (await ep.getByRole('link', { name: 'مراسلة' }).getAttribute('href')) === `mailto:${seeker.email}`,
        'mailto',
      );
      const [download] = await Promise.all([
        ep.waitForEvent('download'),
        ep.getByRole('button', { name: 'فتح السيرة' }).click(),
      ]);
      assert(/\/api\/files\//.test(download.url()), download.url());
      return download.suggestedFilename();
    },
  );

  await check('Another employer and a seeker are refused the applicants (404 / 403)', async () => {
    const started = Date.now() - 2000;
    const otherEmail = `other.${ts}@example.com`;
    await call('/auth/signup/employer', {
      body: {
        contactName: 'منافس',
        organizationName: `مؤسسة أخرى ${ts}`,
        sectorId: it.id,
        businessTypeId: (await call('/lookups/business-types')).json[0].id,
        email: otherEmail,
        phone: '0507778888',
        password: emp.password,
        consentTerms: true,
      },
    });
    const v = await call('/auth/verify-email', {
      body: { email: otherEmail, code: await codeFor(otherEmail, started) },
    });
    const list = await call('/admin/employers?status=PENDING', { token: admin });
    const other = list.json.find((e) => e.email === otherEmail);
    await call(`/admin/employers/${other.id}/approve`, { token: admin, body: {} });
    const tok = v.json.accessToken;
    const a = await call(`/employer/jobs/${fitJobId}/applicants`, { token: tok });
    const b = await call(`/employer/applicants/${interestId}`, { token: tok });
    const c = await call(`/employer/applicants/${interestId}/cv-link`, { token: tok, body: {} });
    const s = await call(`/employer/applicants/${interestId}`, {
      token: seekerToken,
    });
    assert(
      a.status === 404 && b.status === 404 && c.status === 404,
      `other employer ${a.status}/${b.status}/${c.status}`,
    );
    assert(s.status === 403, `seeker ${s.status}`);
    return `${a.status} ${a.json.code}, ${b.status} ${b.json.code}, seeker ${s.status}`;
  });

  await check('S-16: close as hired via the platform -> counters updated', async () => {
    await ep.goto(`${BASE}/ar/employer/jobs/${fitJobId}/close`);
    await ep.waitForSelector('h1:has-text("إغلاق الفرصة")');
    await ep.getByRole('radio', { name: 'تم التوظيف عبر المنصة' }).check();
    await ep.getByRole('button', { name: 'تأكيد الإغلاق' }).click();
    await ep.waitForSelector('#cj-who[aria-invalid=true]');
    await ep.selectOption('#cj-who', { label: 'خالد سالم محمد الحربي' });
    await ep.getByRole('button', { name: 'تأكيد الإغلاق' }).click();
    await ep.waitForURL(/\/ar\/employer$/);
    await ep.waitForSelector('text=أُغلقت الفرصة وسُجلت النتيجة.');
    const hired = (await ep.textContent('[data-stat=hired]')).trim();
    const open = (await ep.textContent('[data-stat=open]')).trim();
    assert(hired === '1' && open === '1', `hired ${hired}, open ${open}`);
    const row = ep.locator('tr', { has: ep.locator(`strong:text-is("${fitTitle}")`) });
    assert((await row.textContent()).includes('غير متوفرة'), 'row shows unavailable');
    return `hired=${hired}, open=${open}`;
  });

  await check(
    'S-09: the seeker sees "الفرصة لم تعد متوفرة"; the job leaves the list and refuses interest',
    async () => {
      await sp.getByRole('link', { name: 'طلباتي' }).first().click();
      await sp.waitForURL(/\/ar\/seeker\/requests$/);
      await sp.waitForSelector(`h2:has-text("${fitTitle}")`);
      await sp.waitForSelector('text=الفرصة لم تعد متوفرة');
      await snap('S-09');
      await sp.goto(`${BASE}/ar/seeker/jobs`);
      await sp.waitForSelector(`h2:has-text("${farTitle}")`);
      assert(!(await sp.textContent('main')).includes(fitTitle), 'closed job not listed');
      await snap('S-07 after close');
      const r = await call(`/jobs/${fitJobId}/interest`, {
        token: seekerToken,
        body: { consent: true },
      });
      assert(r.status === 409, `interest on closed job ${r.status}`);
    },
  );

  await check('English: seeker jobs, requests and the employer dashboard', async () => {
    await sp.goto(`${BASE}/en/seeker/jobs`);
    await sp.waitForSelector('h1:has-text("Available jobs")');
    await sp.waitForSelector('text=Suitable: 70+');
    await snap('en S-07');
    await sp.goto(`${BASE}/en/seeker/requests`);
    await sp.waitForSelector('text=No longer available');
    await snap('en S-09');
    await sp.goto(`${BASE}/en/seeker/jobs/${farJobId}`);
    await sp.waitForSelector('text=Sector differs from your experience');
    await snap('en S-08');
    await ep.goto(`${BASE}/en/employer`);
    await ep.waitForSelector('h1:has-text("Employer dashboard")');
    await ep.waitForSelector('main >> text=Hired via platform');
  });

  await check(
    'PRIVACY: no employer name, organization, email, phone or id in any seeker response or page',
    async () => {
      const needles = [
        emp.contactName,
        emp.organizationName,
        emp.email,
        emp.phoneLocal,
        emp.phoneLocal.slice(1),
        employerId,
      ];
      const leaks = [];
      for (const s of seen) for (const n of needles) if (s.text.includes(n)) leaks.push(`${n} in ${s.where}`);
      assert(seen.length > 20, `only ${seen.length} responses captured`);
      assert(leaks.length === 0, leaks.slice(0, 3).join('; '));
      return `${seen.length} responses/pages scanned`;
    },
  );

  // ---- 375px ----
  for (const [ctxName, ctx, paths] of [
    [
      'seeker',
      seekCtx,
      ['/ar/seeker/jobs', `/ar/seeker/jobs/${fitJobId}`, '/ar/seeker/requests', '/en/seeker/jobs'],
    ],
    [
      'employer',
      empCtx,
      [
        '/ar/employer',
        '/ar/employer/jobs/new',
        `/ar/employer/jobs/${farJobId}/edit`,
        `/ar/employer/jobs/${fitJobId}/applicants`,
        `/ar/employer/applicants/${interestId}`,
        `/ar/employer/jobs/${farJobId}/close`,
        '/en/employer',
      ],
    ],
  ]) {
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 375, height: 740 });
    watch(m, `${ctxName}-375`);
    for (const path of paths) {
      await check(`375px, no horizontal scroll: ${path}`, async () => {
        await m.goto(`${BASE}${path}`);
        await m.waitForSelector('main h1');
        await m.waitForLoadState('networkidle');
        const { sw, cw } = await m.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        }));
        assert(sw <= cw, `scrollWidth ${sw} > ${cw}`);
        const small = await m.evaluate(() =>
          [
            ...document.querySelectorAll(
              'main button, main a, main select, main input:not([type=checkbox]):not([type=radio])',
            ),
          ]
            .filter((el) => el.offsetParent !== null)
            .map((el) => ({ h: el.getBoundingClientRect().height, t: (el.textContent || el.id).trim() }))
            .filter((x) => x.h < 44),
        );
        assert(small.length === 0, `targets under 44px: ${JSON.stringify(small.slice(0, 3))}`);
        return `${sw}px`;
      });
    }
  }

  step('No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  await browser.close();

  await check('Audit rows: approval, jobs, interest, match scores, sensitive views', async () => {
    const sql = `select entity || ':' || action, count(*) from audit_log
      where (entity = 'employers' and entity_id = '${employerId}')
         or (entity = 'jobs' and entity_id in ('${fitJobId}', '${farJobId}'))
         or (entity = 'interest_requests' and entity_id = '${interestId}')
         or (entity = 'match_scores' and after::text like '%${fitJobId}%')
         or (entity in ('seeker_profiles', 'uploaded_files') and action = 'VIEW_SENSITIVE')
      group by 1 order by 1`;
    const out = execFileSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'sanad',
        '-d',
        'sanad',
        '-At',
        '-F',
        '=',
        '-c',
        sql,
      ],
      {
        encoding: 'utf8',
      },
    );
    const rows = Object.fromEntries(
      out
        .trim()
        .split('\n')
        .map((l) => l.split('=')),
    );
    for (const k of [
      'employers:APPROVE',
      'employers:UPDATE',
      'jobs:CREATE',
      'jobs:UPDATE',
      'interest_requests:CREATE',
      'interest_requests:UPDATE',
      'match_scores:CREATE',
      'seeker_profiles:VIEW_SENSITIVE',
      'uploaded_files:VIEW_SENSITIVE',
    ]) {
      assert(Number(rows[k]) >= 1, `missing ${k}`);
    }
    return out.trim().split('\n').join(', ');
  });

  console.log(`\nemployer: ${emp.email}\nseeker: ${seeker.email}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
