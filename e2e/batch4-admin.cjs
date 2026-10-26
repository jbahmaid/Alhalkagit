/**
 * Batch 4 journey: the admin area (S-17 to S-21), settings, "my account" and the Excel export,
 * against a running stack.
 *
 *   ADMIN_PASSWORD="$(docker compose exec -T api cat /app/secrets/admin-initial-password.txt)" \
 *   BASE_URL=http://localhost:3000 MAILPIT_URL=http://localhost:8025 node e2e/batch4-admin.cjs
 *
 * Needs the `playwright` package; the workbook is read with the repo's `exceljs`.
 * The system admin signs in (S-17), approves a new employer (S-18), adds a dar, a country and a
 * business type (S-19) that then show in the seeker's and employer's dropdowns, creates a super
 * admin (S-20) who gets the temporary password by email and must change it at first login. The
 * new admin is blocked (UI and API) from suspending, deleting or re-roling the system account,
 * changes its email, and the system admin changes it back from "my account" with a code. Then the
 * audit log is filtered (S-21), the full export is refused with a wrong password and downloaded
 * with the right one, and the workbook is checked (sheets, RTL, frozen bold header, filter, dates,
 * IDs and phones as text). Employers and seekers get 403 on the export. English, 375px, console.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const ExcelJS = require(path.join(__dirname, '..', 'node_modules', 'exceljs'));

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MAILPIT = (process.env.MAILPIT_URL || 'http://localhost:8025').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jbahmaid@gmail.com';
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_NEW_PASSWORD = process.env.ADMIN_NEW_PASSWORD || 'Sanad-Admin-2026';
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sanad-b4-'));

const results = [];
const consoleErrors = [];
const shotPages = [];

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
          .screenshot({ path: `${process.env.SHOT_DIR}/b4-fail-${results.length}-${i}.png`, fullPage: true })
          .catch(() => {});
      }
    }
  }
}
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
  /(\d{6})/.exec((await mailFor(email, after, (m) => /\b\d{6}\b/.test(m.Text))).Text)[1];

async function call(path, opts = {}) {
  // Login and email routes are rate limited per IP; wait and retry instead of failing.
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
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = buf.length ? JSON.parse(buf.toString('utf8')) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, buf, headers: res.headers };
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
    s = await login('admin', ADMIN_NEW_PASSWORD);
  }
  if (!s) s = await login('admin', ADMIN_NEW_PASSWORD);
  assert(s && !s.user.mustChangePassword, 'admin login (set ADMIN_PASSWORD)');
  return s;
}
async function lookup(type, code) {
  const r = await call(`/lookups/${type}`);
  const item = r.json.find((x) => x.code === code);
  assert(item, `${type}/${code}`);
  return item;
}

/** Sign in through the UI; the login route is rate limited, so retry on the alert. */
async function uiLogin(page, locale, identifier, password, landing) {
  await page.goto(`${BASE}/${locale}/login`);
  await page.fill('#login-identifier', identifier);
  await page.fill('#login-password', password);
  for (let i = 0; i < 12; i++) {
    await page.locator('main form button[type=submit]').click();
    const where = await Promise.race([
      page.waitForURL(landing).then(() => 'in'),
      page.waitForSelector('main [role=alert]:not(:empty)').then(() => 'alert'),
    ]);
    if (where === 'in') return;
    await wait(6000);
  }
  await page.waitForURL(landing);
}

function watch(page, label) {
  page.on('console', (m) => {
    // Deliberate refusals checked below log one 403 / 404 / 429 each in the console.
    if (m.type() === 'error' && !/status of (40[0134]|429)/.test(m.text()))
      consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
}

async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}
const headerOf = (ws) => ws.getRow(1).values.slice(1);
const colOf = (ws, label) => {
  const i = headerOf(ws).indexOf(label);
  assert(i >= 0, `${ws.name}: no column "${label}" in ${headerOf(ws).join(' | ')}`);
  return i + 1;
};
function rowsWhere(ws, label, value) {
  const c = colOf(ws, label);
  const out = [];
  ws.eachRow((row, n) => {
    if (n > 1 && row.getCell(c).value === value) out.push(row);
  });
  return out;
}

(async () => {
  const ts = Date.now();
  const tail = String(ts).slice(-6);
  const emp = {
    contactName: 'منى العتيبي',
    organizationName: `مؤسسة الأفق ${ts}`,
    email: `employer4.${ts}@example.com`,
    phoneLocal: `05${String(ts).slice(-8)}`,
    password: 'Employer-Pass-2026',
  };
  const seeker = {
    email: `seeker4.${ts}@example.com`,
    password: 'Seeker-Pass-2026',
    idNumber: `1${String(ts * 3).slice(-9)}`,
    mobile: `055${String(ts).slice(-7)}`,
  };
  const newAdmin = {
    name: 'ريم الشهري',
    email: `admin4.${ts}@example.com`,
    username: `reem.${tail}`,
    password: 'Reem-Admin-2026',
  };
  const sysTempEmail = `system.${ts}@example.com`;
  const lk = {
    dar: { ar: `دار الوادي ${tail}`, en: `Wadi Dar ${tail}`, code: `DAR_${tail}` },
    btype: { ar: `مؤسسة اجتماعية ${tail}`, en: `Social enterprise ${tail}`, code: `SOCIAL_${tail}` },
    country: { ar: `دولة تجريبية ${tail}`, en: `Testland ${tail}` },
  };
  const [it, sa, bachelor] = await Promise.all([
    lookup('sectors', 'IT'),
    lookup('countries', 'SA'),
    lookup('education-levels', 'BACHELOR'),
  ]);
  // An unused ISO-style code for the new country (re-runs without a reset stay green).
  const usedCountries = new Set((await call('/lookups/countries')).json.map((c) => c.code));
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // X* and Q* are user-assigned in ISO 3166, so they never clash with a real country.
  lk.country.code = ['X', 'Q', ...letters]
    .flatMap((a) => [...letters].map((b) => a + b))
    .find((c) => !usedCountries.has(c));

  let sys; // system admin session (API)
  let employerId;
  let seekerToken;
  let empToken;
  let newAdminId;
  let newAdminToken;
  let sysUserId;
  const lkIds = {};

  // ---- Setup through the API: a pending employer and a seeker with step 1 saved ----
  await check('Setup: an employer signs up (pending) and a seeker saves step 1 (API)', async () => {
    sys = await adminToken();
    sysUserId = sys.user.id;
    const started = Date.now() - 2000;
    const su = await call('/auth/signup/employer', {
      body: {
        contactName: emp.contactName,
        organizationName: emp.organizationName,
        sectorId: it.id,
        businessTypeId: (await call('/lookups/business-types')).json[0].id,
        email: emp.email,
        phone: emp.phoneLocal,
        password: emp.password,
        consentTerms: true,
      },
    });
    assert(su.status < 300, `employer signup ${su.status} ${JSON.stringify(su.json)}`);
    const v = await call('/auth/verify-email', {
      body: { email: emp.email, code: await codeFor(emp.email, started) },
    });
    assert(v.status === 200, `employer verify ${v.status}`);
    empToken = v.json.accessToken;

    const s2 = Date.now() - 2000;
    const ss = await call('/auth/signup/seeker', {
      body: {
        email: seeker.email,
        password: seeker.password,
        consentShare: true,
        consentTerms: true,
        locale: 'ar',
      },
    });
    assert(ss.status < 300, `seeker signup ${ss.status}`);
    const sv = await call('/auth/verify-email', {
      body: { email: seeker.email, code: await codeFor(seeker.email, s2) },
    });
    seekerToken = sv.json.accessToken;
    const p = await call('/me/profile/personal', {
      token: seekerToken,
      method: 'PATCH',
      body: {
        firstName: 'فهد',
        fatherName: 'ناصر',
        grandfatherName: 'علي',
        familyName: 'الدوسري',
        idType: 'NATIONAL_ID',
        idNumber: seeker.idNumber,
        gender: 'MALE',
        birthDate: '1996-07-21',
        nationalityId: sa.id,
        hasSpecialNeeds: false,
      },
    });
    assert(p.status === 200, `personal ${p.status}`);
    const c = await call('/me/profile/contact', {
      token: seekerToken,
      method: 'PATCH',
      body: { mobile: seeker.mobile, email: seeker.email },
    });
    assert(c.status === 200, `contact ${c.status}`);
    const e = await call('/me/profile/education', {
      token: seekerToken,
      method: 'PATCH',
      body: {
        educationLevelId: bachelor.id,
        graduationYear: 2018,
        institution: 'جامعة الإمام',
        countryId: sa.id,
        fieldOfStudy: 'المحاسبة',
      },
    });
    assert(e.status === 200, `education ${e.status}`);
    return `country code for the test: ${lk.country.code}`;
  });

  const browser = await chromium.launch();
  const adminCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const ap = await adminCtx.newPage();
  watch(ap, 'sys-admin');
  shotPages.push(ap);

  await check('S-17: system admin signs in -> dashboard with stats, system badge and export', async () => {
    await uiLogin(ap, 'ar', ADMIN_EMAIL, ADMIN_NEW_PASSWORD, /\/ar\/admin$/);
    await ap.waitForSelector('h1:has-text("لوحة المدير")');
    await ap.waitForSelector('main >> text=حساب النظام');
    await ap.waitForSelector('[data-stat=employersPending]');
    const pending = Number((await ap.textContent('[data-stat=employersPending]')).trim());
    assert(pending >= 1, `pending ${pending}`);
    assert(await ap.locator('[data-export=full]').isVisible(), 'full export button');
    for (const label of ['الاعتماد', 'القوائم', 'المستخدمون', 'السجل', 'الإعدادات']) {
      assert(await ap.getByRole('link', { name: label }).first().isVisible(), `nav ${label}`);
    }
    return `pending=${pending}`;
  });

  await check('S-18: approve the employer from the pending tab; it moves to "approved"', async () => {
    const started = Date.now() - 2000;
    await ap.getByRole('link', { name: 'الاعتماد' }).first().click();
    await ap.waitForURL(/\/ar\/admin\/approvals$/);
    await ap.waitForSelector('h1:has-text("اعتماد أصحاب العمل")');
    const card = ap.locator('article', { has: ap.locator(`h2:text-is("${emp.organizationName}")`) });
    await card.waitFor();
    const text = await card.textContent();
    for (const want of [emp.contactName, emp.email, 'البريد موثّق'])
      assert(text.includes(want), `card ${want}`);
    await card.getByRole('button', { name: 'اعتماد' }).click();
    await ap.waitForSelector(`text=اعتُمد حساب ${emp.organizationName}`);
    await card.waitFor({ state: 'detached' });
    await ap.getByRole('tab', { name: 'معتمدون' }).click();
    await ap.waitForSelector(`h2:text-is("${emp.organizationName}")`);
    const list = await call('/admin/employers?status=APPROVED', { token: sys.accessToken });
    const row = list.json.find((e) => e.email === emp.email);
    assert(row && row.approvalStatus === 'APPROVED', 'approved via API view');
    employerId = row.id;
    const mail = await mailFor(emp.email, started, (m) => /\/ar\/employer/.test(m.Text));
    return mail.Subject;
  });

  await check('S-19: add a dar, a country and a business type', async () => {
    await ap.getByRole('link', { name: 'القوائم' }).first().click();
    await ap.waitForURL(/\/ar\/admin\/lookups$/);
    await ap.waitForSelector('h1:has-text("القوائم المرجعية")');
    const add = async (tab, item) => {
      if (tab) {
        await ap.getByRole('tab', { name: tab }).click();
        await ap.waitForSelector(
          `#lk-tab-${tab === 'الدول والجنسيات' ? 'countries' : 'business-types'}[aria-selected=true]`,
        );
      }
      // Empty submit shows the field errors first.
      await ap.locator('#lk-add-ar').waitFor();
      await ap.getByRole('button', { name: 'إضافة', exact: true }).click();
      await ap.waitForSelector('#lk-add-ar[aria-invalid=true]');
      await ap.fill('#lk-add-ar', item.ar);
      await ap.fill('#lk-add-en', item.en);
      await ap.fill('#lk-add-code', item.code.toLowerCase());
      await ap.getByRole('button', { name: 'إضافة', exact: true }).click();
      await ap.waitForSelector(`main td >> text=${item.ar}`);
      assert((await ap.inputValue('#lk-add-ar')) === '', 'form cleared');
      await ap.waitForSelector(`main code:text-is("${item.code}")`);
    };
    await add(null, lk.dar);
    await add('الدول والجنسيات', lk.country);
    await add('تصنيف قطاع الأعمال', lk.btype);
    // Duplicate code: refused with a field error.
    await ap.fill('#lk-add-ar', 'مكرر');
    await ap.fill('#lk-add-en', 'Duplicate');
    await ap.fill('#lk-add-code', lk.btype.code);
    await ap.getByRole('button', { name: 'إضافة', exact: true }).click();
    await ap.waitForSelector('main [role=alert]:not(:empty)');
    for (const [type, item] of [
      ['dars', lk.dar],
      ['countries', lk.country],
      ['business-types', lk.btype],
    ]) {
      const found = (await call(`/lookups/${type}`)).json.find((x) => x.code === item.code);
      assert(found && found.isActive, `${type} ${item.code} public`);
      lkIds[type] = found.id;
    }
    return `${lk.dar.code}, ${lk.country.code}, ${lk.btype.code}`;
  });

  const seekCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await seekCtx.newPage();
  watch(sp, 'seeker');
  shotPages.push(sp);
  const empCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ep = await empCtx.newPage();
  watch(ep, 'employer');
  shotPages.push(ep);

  await check(
    'New items show in the seeker (dar, nationality) and employer (business type, country) dropdowns',
    async () => {
      await uiLogin(sp, 'ar', seeker.email, seeker.password, /\/ar\/seeker(\/.*)?$/);
      await sp.goto(`${BASE}/ar/seeker/profile?step=2`);
      await sp.waitForSelector('#w-dar');
      await sp.waitForSelector(`#w-dar option[value="${lkIds.dars}"]:text-is("${lk.dar.ar}")`, {
        state: 'attached',
      });
      await sp.selectOption('#w-dar', lkIds.dars);
      await sp.goto(`${BASE}/ar/seeker/profile?step=1`);
      await sp.waitForSelector(`#w-nat option[value="${lkIds.countries}"]:text-is("${lk.country.ar}")`, {
        state: 'attached',
      });
      await sp.goto(`${BASE}/en/seeker/profile?step=2`);
      await sp.waitForSelector(`#w-dar option:text-is("${lk.dar.en}")`, { state: 'attached' });

      const anon = await browser.newPage();
      watch(anon, 'anon');
      await anon.goto(`${BASE}/ar/signup/employer`);
      await anon.waitForSelector(
        `#e-btype option[value="${lkIds['business-types']}"]:text-is("${lk.btype.ar}")`,
        {
          state: 'attached',
        },
      );
      await anon.close();
      await uiLogin(ep, 'ar', emp.email, emp.password, /\/ar\/employer$/);
      await ep.goto(`${BASE}/ar/employer/jobs/new`);
      await ep.waitForSelector(`#pj-country option[value="${lkIds.countries}"]:text-is("${lk.country.ar}")`, {
        state: 'attached',
      });
    },
  );

  await check('S-19: a disabled item leaves the input lists, then comes back when enabled', async () => {
    await ap.getByRole('tab', { name: 'الديار' }).click();
    await ap.getByRole('button', { name: `تعطيل: ${lk.dar.ar} / ${lk.dar.en}` }).click();
    await ap.waitForSelector('text=عُطّل العنصر');
    const list = (await call('/lookups/dars')).json.find((x) => x.id === lkIds.dars);
    assert(list && list.isActive === false, 'inactive in the public list');
    await sp.goto(`${BASE}/ar/seeker/profile?step=2`);
    await sp.waitForSelector('#w-dar option:nth-child(2)', { state: 'attached' });
    assert((await sp.locator(`#w-dar option[value="${lkIds.dars}"]`).count()) === 0, 'hidden from the form');
    await ap.getByRole('button', { name: `تفعيل: ${lk.dar.ar} / ${lk.dar.en}` }).click();
    await ap.waitForSelector('text=فُعّل العنصر');
  });

  await check('Seeker and employer are refused the admin API (403)', async () => {
    const out = [];
    for (const [who, token] of [
      ['seeker', seekerToken],
      ['employer', empToken],
    ]) {
      for (const p of ['/admin/dashboard', '/admin/users', '/admin/audit', '/admin/lookups/dars']) {
        const r = await call(p, { token });
        assert(r.status === 403, `${who} ${p} ${r.status}`);
      }
      out.push(`${who} 403`);
    }
    return out.join(', ');
  });

  await check('S-20: super admin creates an admin; the temporary password arrives by email', async () => {
    const started = Date.now() - 2000;
    await ap.getByRole('link', { name: 'المستخدمون' }).first().click();
    await ap.waitForURL(/\/ar\/admin\/users$/);
    await ap.getByRole('button', { name: 'إضافة مدير' }).click();
    const dlg = ap.getByRole('dialog');
    await dlg.waitFor();
    await dlg.getByRole('button', { name: 'إنشاء الحساب' }).click();
    await ap.waitForSelector('#na-name[aria-invalid=true]');
    await ap.fill('#na-name', newAdmin.name);
    await ap.fill('#na-email', newAdmin.email);
    await ap.fill('#na-user', newAdmin.username);
    await dlg.getByLabel('مدير النظام الأعلى').check();
    await dlg.getByRole('button', { name: 'إنشاء الحساب' }).click();
    await ap.waitForSelector(`text=أُنشئ الحساب وأُرسلت كلمة المرور المؤقتة إلى ${newAdmin.email}`);
    const mail = await mailFor(newAdmin.email, started, (m) => /كلمة المرور المؤقتة/.test(m.Text));
    newAdmin.temp = /كلمة المرور المؤقتة: (\S+)/.exec(mail.Text)[1];
    assert(mail.Text.includes(newAdmin.username), 'login name in the email');
    await ap.fill('#uq', newAdmin.email);
    await ap.getByRole('button', { name: 'تطبيق' }).click();
    await ap.waitForSelector(`main td >> text=${newAdmin.name}`);
    const rows = await call(`/admin/users?q=${encodeURIComponent(newAdmin.email)}`, {
      token: sys.accessToken,
    });
    newAdminId = rows.json.items[0].id;
    assert(rows.json.items[0].role === 'SUPER_ADMIN', `role ${rows.json.items[0].role}`);
    return mail.Subject;
  });

  const nCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const np = await nCtx.newPage();
  watch(np, 'new-admin');
  shotPages.push(np);

  await check('New admin logs in with the temporary password and is forced to change it', async () => {
    await uiLogin(np, 'ar', newAdmin.username, newAdmin.temp, /\/ar\/change-password$/);
    await np.waitForSelector('text=هذه كلمة مرور مؤقتة');
    const temp = await login(newAdmin.username, newAdmin.temp);
    const blocked = await call('/admin/dashboard', { token: temp.accessToken });
    assert(
      blocked.status === 403 && blocked.json.code === 'PASSWORD_CHANGE_REQUIRED',
      `before change ${blocked.status}`,
    );
    await np.goto(`${BASE}/ar/admin`);
    await np.waitForURL(/\/ar\/change-password$/);
    await np.fill('#cp-current', newAdmin.temp);
    await np.fill('#cp-new', newAdmin.password);
    await np.fill('#cp-new2', newAdmin.password);
    await np.locator('main form button[type=submit]').click();
    await np.waitForURL(/\/ar\/admin$/);
    await np.waitForSelector('h1:has-text("لوحة المدير")');
    newAdminToken = (await login(newAdmin.email, newAdmin.password)).accessToken;
    return `${blocked.status} ${blocked.json.code}`;
  });

  await check(
    'System account: badge, no suspend / delete / role controls; the API refuses them',
    async () => {
      await np.goto(`${BASE}/ar/admin/users`);
      await np.selectOption('#ur', 'SUPER_ADMIN');
      await np.getByRole('button', { name: 'تطبيق' }).click();
      const row = np.locator('tr', { has: np.locator('text=حساب النظام') });
      await row.waitFor();
      await row.getByRole('link', { name: /عرض وتعديل/ }).click();
      await np.waitForURL(new RegExp(`/ar/admin/users/${sysUserId}$`));
      await np.waitForSelector('text=حساب النظام لا يُحذف ولا يُوقف ولا يتغير دوره');
      const actions = np.locator('[data-testid=account-actions]');
      await actions.waitFor();
      const text = await actions.textContent();
      assert(text.includes('تغيير البريد'), 'email change offered');
      for (const bad of ['إيقاف الحساب', 'حذف الحساب', 'إعادة التفعيل'])
        assert(!text.includes(bad), `shows ${bad}`);
      assert(
        (await np.locator('fieldset:has(legend:text-is("تغيير الدور"))').count()) === 0,
        'no role control',
      );
      const codes = [];
      for (const [m, p, body] of [
        ['POST', `/admin/users/${sysUserId}/suspend`, {}],
        ['DELETE', `/admin/users/${sysUserId}`, undefined],
        ['PATCH', `/admin/users/${sysUserId}/role`, { role: 'ADMIN' }],
      ]) {
        const r = await call(p, { token: newAdminToken, method: m, body });
        assert(
          r.status === 403 && r.json.code === 'SYSTEM_ACCOUNT_PROTECTED',
          `${m} ${p} ${r.status} ${r.json && r.json.code}`,
        );
        codes.push(`${m} ${r.status}`);
      }
      const still = await call(`/admin/users/${sysUserId}`, { token: newAdminToken });
      assert(still.json.status === 'ACTIVE' && still.json.role === 'SUPER_ADMIN', 'unchanged');
      return `${codes.join(', ')} SYSTEM_ACCOUNT_PROTECTED`;
    },
  );

  await check('A super admin can suspend and delete a regular admin account', async () => {
    const r = await call('/admin/admins', {
      token: sys.accessToken,
      body: { name: 'x', email: `x.${ts}@example.com`, role: 'ADMIN' },
    });
    assert(r.status === 201 || r.status === 200, `super admin create ${r.status}`);
    const plain = await call(`/admin/users/${r.json.id}/suspend`, { token: newAdminToken, body: {} });
    assert(plain.status < 300, `super admin suspends an admin ${plain.status}`);
    const del = await call(`/admin/users/${r.json.id}`, { token: newAdminToken, method: 'DELETE' });
    assert(del.status < 300, `delete ${del.status}`);
    return `create ${r.status}, suspend ${plain.status}, delete ${del.status}`;
  });

  await check("The new super admin changes the system admin's email (password re-confirmed)", async () => {
    const started = Date.now() - 2000;
    await np.getByRole('button', { name: 'تغيير البريد' }).click();
    const dlg = np.getByRole('dialog');
    await np.fill('#ce-email', sysTempEmail);
    await np.fill('#ce-pw', 'wrong-password-1');
    await dlg.getByRole('button', { name: 'حفظ' }).click();
    await dlg.locator('[role=alert]:not(:empty)').first().waitFor();
    await np.fill('#ce-pw', newAdmin.password);
    await dlg.getByRole('button', { name: 'حفظ' }).click();
    await np.waitForSelector('text=تغيّر بريد الدخول.');
    await np.waitForSelector(`main >> text=${sysTempEmail}`);
    await mailFor(ADMIN_EMAIL, started);
    const s = await login(sysTempEmail, ADMIN_NEW_PASSWORD);
    assert(s && s.user.isSystemAccount !== false, 'system admin signs in with the new email');
  });

  await check('"My account": the system admin changes its email back with a code', async () => {
    const started = Date.now() - 2000;
    // The system admin's session is still valid after another admin changed its email.
    await ap.getByRole('link', { name: 'حسابي' }).first().click();
    await ap.waitForURL(/\/ar\/account$/);
    await ap.waitForSelector(`[data-testid=account-email]:text-is("${sysTempEmail}")`);
    await ap.waitForSelector('main >> text=حساب النظام');
    await ap.fill('#ac-email', ADMIN_EMAIL);
    await ap.fill('#ac-pw', ADMIN_NEW_PASSWORD);
    // A code sent to this account in the last minute (an earlier run) means a short wait.
    for (let i = 0; i < 8; i++) {
      await ap.getByRole('button', { name: 'إرسال رمز التحقق' }).click();
      const where = await Promise.race([
        ap.waitForSelector(`text=أرسلنا رمزاً إلى ${ADMIN_EMAIL}`).then(() => 'sent'),
        ap.waitForSelector('main [role=alert]:has-text("انتظر قليلاً")').then(() => 'wait'),
      ]);
      if (where === 'sent') break;
      await wait(10000);
    }
    await ap.waitForSelector(`text=أرسلنا رمزاً إلى ${ADMIN_EMAIL}`);
    await ap.fill('#ac-code', await codeFor(ADMIN_EMAIL, started));
    await ap.getByRole('button', { name: 'تأكيد التغيير' }).click();
    await ap.waitForSelector(`[data-testid=account-email]:text-is("${ADMIN_EMAIL}")`);
    await mailFor(sysTempEmail, started);
    sys = await login(ADMIN_EMAIL, ADMIN_NEW_PASSWORD);
    assert(sys, 'signs in with the original email again');
  });

  await check('"My account" for the seeker and the employer', async () => {
    for (const [page, email] of [
      [sp, seeker.email],
      [ep, emp.email],
    ]) {
      await page.goto(`${BASE}/ar/account`);
      await page.waitForSelector(`[data-testid=account-email]:text-is("${email}")`);
      await page.getByRole('link', { name: 'حسابي' }).first().waitFor();
    }
  });

  await check('S-20: seeker detail with the ID masked, revealed on request (VIEW_SENSITIVE)', async () => {
    await ap.goto(`${BASE}/ar/admin/users`);
    await ap.fill('#uq', seeker.email);
    await ap.getByRole('button', { name: 'تطبيق' }).click();
    await ap
      .getByRole('link', { name: /عرض وتعديل/ })
      .first()
      .click();
    await ap.waitForURL(/\/ar\/admin\/users\/[0-9a-f-]+$/);
    await ap.waitForSelector('h1:has-text("فهد ناصر علي الدوسري")');
    assert(!(await ap.textContent('main')).includes(seeker.idNumber), 'ID masked before reveal');
    await ap.getByRole('button', { name: 'إظهار الرقم' }).click();
    await ap.waitForSelector(`[data-testid=revealed-id]:text-is("${seeker.idNumber}")`);
  });

  await check('S-21: filter the audit log by action and table', async () => {
    await ap.goto(`${BASE}/ar/admin/audit`);
    await ap.waitForSelector('h1:has-text("سجل التدقيق")');
    await ap.selectOption('#aa', 'APPROVE');
    await ap.waitForSelector('#ae option[value=employers]', { state: 'attached' });
    await ap.selectOption('#ae', 'employers');
    await ap.getByRole('button', { name: 'تطبيق' }).click();
    await ap.waitForFunction(
      (id) => [...document.querySelectorAll('main td code')].some((c) => c.textContent === id),
      employerId,
    );
    const badges = await ap.locator('main td[data-label="العملية"] span').allTextContents();
    assert(badges.length && badges.every((b) => b.trim() === 'اعتماد'), `actions ${badges.join(',')}`);
    await ap.selectOption('#aa', 'VIEW_SENSITIVE');
    await ap.selectOption('#ae', '');
    await ap.fill('#au', ADMIN_EMAIL);
    await ap.getByRole('button', { name: 'تطبيق' }).click();
    await ap.waitForSelector('main td >> text=اطلاع على بيانات حساسة');
    const api = await call('/admin/audit?action=VIEW_SENSITIVE&entity=seeker_profiles&pageSize=5', {
      token: sys.accessToken,
    });
    assert(api.json.total >= 1, 'reveal audited');
    return `approve rows ${badges.length}, reveal rows ${api.json.total}`;
  });

  let fullFile;
  await check('Full export: wrong password refused; right password downloads an .xlsx', async () => {
    await ap.goto(`${BASE}/ar/admin`);
    await ap.locator('[data-export=full]').click();
    const dlg = ap.getByRole('dialog');
    await ap.fill('#export-full-pw', 'Wrong-Pass-123');
    await dlg.getByRole('button', { name: 'تصدير' }).click();
    await dlg.locator('[role=alert]:has-text("كلمة المرور الحالية غير صحيحة")').waitFor();
    await ap.fill('#export-full-pw', ADMIN_NEW_PASSWORD);
    const [download] = await Promise.all([
      ap.waitForEvent('download', { timeout: 60000 }),
      dlg.getByRole('button', { name: 'تصدير' }).click(),
    ]);
    await ap.waitForSelector('text=جُهّز ملف Excel');
    fullFile = path.join(OUT_DIR, download.suggestedFilename());
    await download.saveAs(fullFile);
    assert(
      /^sanad-full-\d{4}-\d{2}-\d{2}\.xlsx$/.test(download.suggestedFilename()),
      download.suggestedFilename(),
    );
    return `${download.suggestedFilename()} ${fs.statSync(fullFile).size} bytes`;
  });

  await check(
    'Workbook (ar): 7 RTL sheets, bold frozen filtered header, dates, ID and phone as text',
    async () => {
      const wb = await readWorkbook(fullFile);
      const names = wb.worksheets.map((w) => w.name);
      const want = [
        'الباحثون',
        'أصحاب العمل',
        'الفرص',
        'طلبات الاهتمام',
        'التوظيف',
        'المستخدمون',
        'سجل التدقيق',
      ];
      assert(JSON.stringify(names) === JSON.stringify(want), `sheets ${names.join(', ')}`);
      for (const ws of wb.worksheets) {
        const v = ws.views[0] || {};
        assert(v.rightToLeft === true, `${ws.name} RTL`);
        assert(v.state === 'frozen' && v.ySplit === 1, `${ws.name} frozen header`);
        assert(ws.getRow(1).getCell(1).font && ws.getRow(1).getCell(1).font.bold, `${ws.name} bold header`);
        assert(ws.autoFilter, `${ws.name} auto filter`);
      }
      const seekers = wb.getWorksheet('الباحثون');
      const header = headerOf(seekers).join(' | ');
      const mine = rowsWhere(seekers, 'بريد الدخول', seeker.email);
      assert(mine.length === 1, `seeker row (${header})`);
      const idCell = mine[0].getCell(colOf(seekers, 'رقم الهوية'));
      assert(
        idCell.value === seeker.idNumber && idCell.numFmt === '@',
        `id ${idCell.value} ${idCell.numFmt}`,
      );
      const phoneCell = mine[0].getCell(colOf(seekers, 'الجوال'));
      assert(phoneCell.value === seeker.mobile && phoneCell.numFmt === '@', `mobile ${phoneCell.value}`);
      const birth = mine[0].getCell(colOf(seekers, 'تاريخ الميلاد')).value;
      assert(birth instanceof Date && birth.toISOString().startsWith('1996-07-21'), `birth ${birth}`);
      const employers = wb.getWorksheet('أصحاب العمل');
      const er = rowsWhere(employers, 'البريد الإلكتروني', emp.email);
      assert(er.length === 1, 'employer row');
      assert(
        er[0].getCell(colOf(employers, 'رقم التواصل')).value === emp.phoneLocal,
        'employer phone as text',
      );
      const users = wb.getWorksheet('المستخدمون');
      assert(rowsWhere(users, 'بريد الدخول', newAdmin.email).length === 1, 'new admin in users');
      const audit = wb.getWorksheet('سجل التدقيق');
      assert(audit.rowCount > 10, `audit rows ${audit.rowCount}`);
      return `${names.length} sheets; seekers ${seekers.rowCount - 1} rows; audit ${audit.rowCount - 1} rows`;
    },
  );

  await check('Export via the API in English: English sheets, left to right; audited as EXPORT', async () => {
    const tok = await call('/admin/export/token', {
      token: sys.accessToken,
      body: { password: ADMIN_NEW_PASSWORD },
    });
    assert(tok.status === 200, `token ${tok.status}`);
    const r = await call('/admin/export/full', {
      token: sys.accessToken,
      body: { token: tok.json.token, locale: 'en' },
    });
    assert(r.status === 200, `export ${r.status}`);
    assert(/spreadsheetml/.test(r.headers.get('content-type')), r.headers.get('content-type'));
    const file = path.join(OUT_DIR, 'full-en.xlsx');
    fs.writeFileSync(file, r.buf);
    const wb = await readWorkbook(file);
    const names = wb.worksheets.map((w) => w.name);
    assert(names[0] === 'Seekers' && names.length === 7, names.join(', '));
    assert(!wb.worksheets[0].views[0].rightToLeft, 'en is LTR');
    const bad = await call('/admin/export/full', {
      token: sys.accessToken,
      body: { token: 'nope', locale: 'en' },
    });
    assert(bad.status === 403 && bad.json.code === 'EXPORT_TOKEN_INVALID', `bad token ${bad.status}`);
    const wrong = await call('/admin/export/token', {
      token: sys.accessToken,
      body: { password: 'Wrong-Pass-123' },
    });
    assert(wrong.status === 403 && wrong.json.code === 'AUTH_WRONG_PASSWORD', `wrong pw ${wrong.status}`);
    const audit = await call('/admin/audit?action=EXPORT&pageSize=5', { token: sys.accessToken });
    assert(audit.json.total >= 2, `EXPORT rows ${audit.json.total}`);
    return `${names.join(', ')}; EXPORT rows ${audit.json.total}`;
  });

  await check('Per-screen export: users filtered by role -> only super admins in the file', async () => {
    await ap.goto(`${BASE}/ar/admin/users`);
    await ap.selectOption('#ur', 'SUPER_ADMIN');
    await ap.getByRole('button', { name: 'تطبيق' }).click();
    await ap.waitForSelector('main td >> text=حساب النظام');
    await ap.locator('[data-export=users]').click();
    await ap.waitForSelector('text=يشمل الملف النتائج حسب التصفية الحالية.');
    await ap.fill('#export-users-pw', ADMIN_NEW_PASSWORD);
    const [download] = await Promise.all([
      ap.waitForEvent('download', { timeout: 60000 }),
      ap.getByRole('dialog').getByRole('button', { name: 'تصدير' }).click(),
    ]);
    const file = path.join(OUT_DIR, download.suggestedFilename());
    await download.saveAs(file);
    const ws = (await readWorkbook(file)).worksheets[0];
    const roles = [];
    ws.eachRow((row, n) => n > 1 && roles.push(row.getCell(colOf(ws, 'الدور')).value));
    assert(roles.length >= 2 && roles.every((r) => r === 'مدير أعلى'), `roles ${roles.join(',')}`);
    return `${roles.length} rows`;
  });

  await check('Per-screen export: audit filtered by action -> only that action', async () => {
    await ap.goto(`${BASE}/ar/admin/audit`);
    await ap.selectOption('#aa', 'APPROVE');
    await ap.getByRole('button', { name: 'تطبيق' }).click();
    await ap.waitForSelector('main td >> text=اعتماد');
    await ap.locator('[data-export=audit]').click();
    await ap.fill('#export-audit-pw', ADMIN_NEW_PASSWORD);
    const [download] = await Promise.all([
      ap.waitForEvent('download', { timeout: 60000 }),
      ap.getByRole('dialog').getByRole('button', { name: 'تصدير' }).click(),
    ]);
    const file = path.join(OUT_DIR, download.suggestedFilename());
    await download.saveAs(file);
    const ws = (await readWorkbook(file)).worksheets[0];
    const acts = [];
    ws.eachRow((row, n) => n > 1 && acts.push(row.getCell(colOf(ws, 'الإجراء')).value));
    assert(acts.length >= 1 && acts.every((a) => a === 'APPROVE'), `actions ${[...new Set(acts)].join(',')}`);
    return `${acts.length} rows`;
  });

  await check('Employer and seeker get 403 on the export (token and file)', async () => {
    const adminTok = (
      await call('/admin/export/token', { token: sys.accessToken, body: { password: ADMIN_NEW_PASSWORD } })
    ).json.token;
    const out = [];
    for (const [who, token, password] of [
      ['employer', empToken, emp.password],
      ['seeker', seekerToken, seeker.password],
    ]) {
      const t = await call('/admin/export/token', { token, body: { password } });
      const f = await call('/admin/export/full', { token, body: { token: adminTok, locale: 'ar' } });
      assert(t.status === 403 && f.status === 403, `${who}: token ${t.status}, file ${f.status}`);
      out.push(`${who} ${t.status}/${f.status}`);
    }
    // In the UI the export button is not there for them either.
    await ep.goto(`${BASE}/ar/admin`);
    await ep.waitForURL(/\/ar\/employer$/);
    return out.join(', ');
  });

  await check('Settings: weights must total 100; a valid save is accepted', async () => {
    await ap.goto(`${BASE}/ar/admin/settings`);
    await ap.waitForSelector('#w-sector');
    const before = await ap.inputValue('#w-sector');
    await ap.fill('#w-sector', String(Number(before) + 5));
    await ap.waitForSelector('#w-sum.text-danger');
    await ap.locator('main form button[type=submit]').click();
    await ap.waitForSelector('main [role=alert]:not(:empty)');
    const r = await call('/admin/settings/matching', {
      token: sys.accessToken,
      method: 'PUT',
      body: {
        weights: { sector: 50, education: 30, experience: 30, keywords: 10 },
        thresholds: { suitable: 70, near: 50 },
      },
    });
    assert(r.status === 400, `api sum 120 -> ${r.status}`);
    await ap.fill('#w-sector', before);
    await ap.locator('main form button[type=submit]').click();
    await ap.waitForSelector('text=حُفظت الإعدادات');
    return `api ${r.status} ${r.json.code}`;
  });

  await check('English: admin pages and my account', async () => {
    for (const [p, h] of [
      ['/en/admin', 'Admin overview'],
      ['/en/admin/approvals', 'Employer approvals'],
      ['/en/admin/lookups', 'Lookup lists'],
      ['/en/admin/users', 'Users'],
      ['/en/admin/audit', 'Audit log'],
      ['/en/admin/settings', 'Matching settings'],
      ['/en/account', 'My account'],
    ]) {
      await ap.goto(`${BASE}${p}`);
      await ap.waitForSelector(`h1:has-text("${h}")`);
    }
    await ap.goto(`${BASE}/en/admin/lookups`);
    await ap.getByRole('tab', { name: 'Business classification' }).click();
    await ap.waitForSelector(`main td >> text=${lk.btype.en}`);
  });

  // ---- 375px ----
  const adminPaths = [
    '/ar/admin',
    '/ar/admin/approvals',
    '/ar/admin/lookups',
    '/ar/admin/users',
    `/ar/admin/users/${sysUserId}`,
    `/ar/admin/users/${newAdminId}`,
    '/ar/admin/audit',
    '/ar/admin/settings',
    '/ar/account',
    '/en/admin',
    '/en/admin/users',
    '/en/admin/audit',
    '/en/account',
  ];
  for (const [ctxName, ctx, paths] of [
    ['admin', adminCtx, adminPaths],
    ['seeker', seekCtx, ['/ar/account', '/en/account']],
    ['employer', empCtx, ['/ar/account']],
  ]) {
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 375, height: 740 });
    watch(m, `${ctxName}-375`);
    for (const p of paths) {
      await check(`375px, no horizontal scroll: ${ctxName} ${p}`, async () => {
        await m.goto(`${BASE}${p}`);
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
              'main button, main a, main select, main summary, main input:not([type=checkbox]):not([type=radio])',
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
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  console.log(`\nemployer: ${emp.email}\nseeker: ${seeker.email}\nadmin: ${newAdmin.email}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
