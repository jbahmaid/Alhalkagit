/**
 * Batch 5 journey: reports (S-22), the reports export, demo data and session hardening, against
 * a running stack.
 *
 *   BASE_URL=http://localhost:3000 node e2e/batch5-reports.cjs
 *
 * Needs the `playwright` package; the workbook is read with the repo's `exceljs`. If the demo
 * data is not there yet (SEED_DEMO=false) it is added with `docker compose exec api node
 * dist/demo.js seed`; set COMPOSE_DIR when running from another folder.
 *
 * The demo admin, a demo employer and a demo seeker sign in. The admin's reports show the charts
 * (role=img with a text alternative), small groups as "hidden (fewer than 5)" and never a count
 * under 5, the same numbers as the API, and working filters. The reports export needs the
 * password, downloads a workbook with the hidden wording, and is audited. The employer sees the
 * general reports plus their own jobs, no filters and no export button; employers and seekers
 * are refused the admin report and the export, and seekers the reports. Two tabs that load at
 * once (one refresh token used twice) stay signed in. Then the demo data is removed (logins fail)
 * and added back. English, 375px, no console errors.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const ExcelJS = require(path.join(__dirname, '..', 'node_modules', 'exceljs'));

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const COMPOSE_DIR = process.env.COMPOSE_DIR || path.join(__dirname, '..');
const DEMO_PASSWORD = 'Demo-Sanad-2026';
const DEMO = {
  admin: 'admin@demo.sanad.local',
  employer: 'employer1@demo.sanad.local',
  pending: 'employer7@demo.sanad.local',
  seeker: 'seeker01@demo.sanad.local',
};
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sanad-b5-'));
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(p, opts = {}) {
  // Login and email routes are rate limited per IP; wait and retry instead of failing.
  for (let i = 0; ; i++) {
    const r = await callOnce(p, opts);
    if (r.status !== 429 || i >= 15) return r;
    await wait(5000);
  }
}
async function callOnce(p, { token, method, body } = {}) {
  const res = await fetch(`${BASE}/api${p}`, {
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
function demoCli(cmd) {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'node', 'dist/demo.js', cmd], {
    cwd: COMPOSE_DIR,
    encoding: 'utf8',
    timeout: 180000,
  });
  assert(r.status === 0, `demo ${cmd}: exit ${r.status} ${r.stderr || r.stdout}`);
  return `${r.stdout}${r.stderr}`;
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

/** Every count anywhere in a report: none may be 1-4 (0 means "no group", null means hidden). */
function smallCounts(obj, out = []) {
  if (Array.isArray(obj)) obj.forEach((x) => smallCounts(x, out));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && v > 0 && v < 5 && k !== 'minGroupSize') out.push(`${k}=${v}`);
      else smallCounts(v, out);
    }
  }
  return out;
}
const CHARTS = {
  byAge: (d) => d.seekers.byAge,
  byGender: (d) => d.seekers.byGender,
  byEducation: (d) => d.seekers.byEducation,
  byExperience: (d) => d.seekers.byExperience,
  bySectorSeekers: (d) => d.seekers.bySector,
  byNationality: (d) => d.seekers.byNationality,
  bySectorJobs: (d) => d.jobs.bySector,
  byStatus: (d) => d.jobs.byStatus,
};
const STATS = {
  seekersTotal: (d) => d.seekers.total,
  withExperience: (d) => d.seekers.withExperience,
  withoutExperience: (d) => d.seekers.withoutExperience,
  jobsTotal: (d) => d.jobs.total,
  open: (d) => d.jobs.open,
  unavailable: (d) => d.jobs.unavailable,
  hiredViaPlatform: (d) => d.jobs.hiredViaPlatform,
  closedWithoutHiring: (d) => d.jobs.closedWithoutHiring,
  interestRequests: (d) => d.jobs.interestRequests,
};
const digits = (s) =>
  Number(
    String(s)
      .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
      .replace(/[^\d]/g, ''),
  );

/** The page shows the API's numbers: every stat tile and every chart row, hidden ones as text. */
async function compareWithApi(page, data, hiddenText) {
  for (const [key, get] of Object.entries(STATS)) {
    const text = (await page.locator(`[data-stat=${key}]`).first().innerText()).trim();
    const want = get(data);
    if (want === null) assert(text.includes(hiddenText), `${key}: "${text}" should be hidden`);
    else assert(digits(text) === want, `${key}: page "${text}" vs api ${want}`);
  }
  let hidden = 0;
  for (const [id, get] of Object.entries(CHARTS)) {
    const fig = page.locator(`[data-chart=${id}]`);
    const img = fig.locator('[role=img]');
    assert((await img.count()) === 1, `${id}: role=img`);
    const label = await img.getAttribute('aria-labelledby');
    const desc = await img.getAttribute('aria-describedby');
    assert(label && desc, `${id}: aria-labelledby/-describedby`);
    const altText = (await page.locator(`[id="${desc}"]`).textContent()).trim();
    assert(altText.length > 0, `${id}: text alternative`);
    const rows = get(data);
    for (const r of rows) {
      const row = fig.locator(`[data-row="${r.key}"]`);
      const shown = await row.getAttribute('data-count');
      if (r.count === null) {
        hidden++;
        assert(shown === 'hidden', `${id}/${r.key}: ${shown} should be hidden`);
        assert((await row.innerText()).includes(hiddenText), `${id}/${r.key}: hidden wording`);
        assert(altText.includes(hiddenText), `${id}: text alternative mentions the hidden row`);
      } else {
        assert(Number(shown) === r.count, `${id}/${r.key}: ${shown} vs ${r.count}`);
      }
    }
  }
  return hidden;
}

(async () => {
  const [sa] = await Promise.all([
    call('/lookups/countries').then((r) => r.json.find((c) => c.code === 'SA')),
  ]);
  assert(sa, 'SA in countries');

  // ---- Demo data ----
  let seededHere = false;
  await check('Demo data is present (seeded by SEED_DEMO or by the one-off command)', async () => {
    if (!(await login(DEMO.admin, DEMO_PASSWORD))) {
      const out = demoCli('seed');
      seededHere = true;
      assert(/Demo data added/.test(out), out.slice(0, 200));
      assert(/Demo-Sanad-2026/.test(out) && /never/i.test(out), 'password warning in the log');
    }
    const again = demoCli('seed');
    assert(/already present/.test(again), 'second seed is a no-op');
    return seededHere ? 'seeded now, then a no-op' : 'already there; seed again is a no-op';
  });

  let demoAdmin;
  let demoEmp;
  let demoSeeker;
  await check(
    'Demo logins: admin, approved employer and seeker sign in; the pending employer waits',
    async () => {
      demoAdmin = await login(DEMO.admin, DEMO_PASSWORD);
      demoEmp = await login(DEMO.employer, DEMO_PASSWORD);
      demoSeeker = await login(DEMO.seeker, DEMO_PASSWORD);
      assert(demoAdmin && demoAdmin.user.role === 'ADMIN', 'demo admin');
      assert(demoEmp && demoEmp.user.role === 'EMPLOYER', 'demo employer');
      assert(demoSeeker && demoSeeker.user.role === 'SEEKER', 'demo seeker');
      for (const s of [demoAdmin, demoEmp, demoSeeker])
        assert(!s.user.mustChangePassword, 'no forced change');
      const pending = await login(DEMO.pending, DEMO_PASSWORD);
      assert(pending, 'pending employer can sign in');
      const acc = await call('/employer/account', { token: pending.accessToken });
      assert(
        acc.json && acc.json.approvalStatus === 'PENDING',
        `pending employer ${acc.json?.approvalStatus}`,
      );
      return 'admin, employer1, seeker01 in; employer7 pending';
    },
  );

  // ---- API: reports, scope and suppression ----
  let adminReport;
  await check('API: admin report has every section, and no count anywhere is 1-4', async () => {
    const r = await call('/reports', { token: demoAdmin.accessToken });
    assert(r.status === 200, `reports ${r.status}`);
    adminReport = r.json;
    assert(adminReport.scope === 'all' && adminReport.minGroupSize >= 5, 'scope all');
    assert(adminReport.seekers.total >= 40 && adminReport.jobs.total >= 20, 'demo totals');
    const small = smallCounts(adminReport);
    assert(small.length === 0, `small counts sent: ${small.join(', ')}`);
    const nat = adminReport.seekers.byNationality;
    assert(
      nat.some((x) => x.count === null),
      'a small nationality is hidden',
    );
    assert(
      adminReport.jobs.bySector.some((x) => x.count === null),
      'a small job sector is hidden',
    );
    return `seekers ${adminReport.seekers.total}, jobs ${adminReport.jobs.total}, nationality ${nat
      .map((x) => `${x.nameEn}:${x.count}`)
      .join(' ')}`;
  });

  await check(
    'API: filters (country, sector, a future date range) are applied and still suppressed',
    async () => {
      const t = demoAdmin.accessToken;
      const bySa = (await call(`/reports?countryId=${sa.id}`, { token: t })).json;
      assert(bySa.filters.countryId === sa.id, 'country filter echoed');
      assert(bySa.seekers.total !== null && bySa.seekers.total < adminReport.seekers.total, 'fewer seekers');
      assert(smallCounts(bySa).length === 0, 'suppressed with filters');
      const it = adminReport.seekers.bySector[0];
      const bySector = (await call(`/reports?sectorId=${it.key}`, { token: t })).json;
      assert(
        bySector.jobs.bySector.every((x) => x.key === it.key || !x.count),
        'sector filter on jobs',
      );
      const future = (await call('/reports?from=2999-01-01&to=2999-12-31', { token: t })).json;
      assert(future.seekers.total === null && future.jobs.total === null, 'nothing in the future (hidden)');
      const bad = await call('/reports?from=yesterday', { token: t });
      assert(bad.status === 400, `bad date ${bad.status}`);
      return `SA seekers ${bySa.seekers.total}; sector jobs ${bySector.jobs.total}`;
    },
  );

  await check('API: employer gets the general report plus own jobs; filters ignored; refusals', async () => {
    const r = await call(`/reports?countryId=${sa.id}`, { token: demoEmp.accessToken });
    assert(r.status === 200, `employer reports ${r.status}`);
    assert(r.json.scope === 'general', `scope ${r.json.scope}`);
    assert(!r.json.filters.countryId, 'employer filters ignored');
    assert(r.json.own && Array.isArray(r.json.own.jobs) && r.json.own.jobs.length > 0, 'own jobs');
    const s = JSON.stringify(r.json);
    for (const leak of ['email', 'phone', 'idNumber', 'firstName', 'familyName', 'seekerId', 'userId'])
      assert(!s.includes(`"${leak}"`), `no ${leak}`);
    assert(smallCounts({ seekers: r.json.seekers, jobs: r.json.jobs }).length === 0, 'suppressed');
    const seeker = await call('/reports', { token: demoSeeker.accessToken });
    assert(seeker.status === 403, `seeker reports ${seeker.status}`);
    const anon = await call('/reports');
    assert(anon.status === 401, `anonymous reports ${anon.status}`);
    for (const tok of [demoEmp, demoSeeker]) {
      const t = await call('/admin/export/token', {
        token: tok.accessToken,
        body: { password: DEMO_PASSWORD },
      });
      assert(t.status === 403, `${tok.user.role} export token ${t.status}`);
      const e = await call('/admin/export/reports', {
        token: tok.accessToken,
        body: { token: 'x', locale: 'ar' },
      });
      assert(e.status === 403, `${tok.user.role} export ${e.status}`);
    }
    return `own jobs ${r.json.own.jobs.length}; seeker 403, anonymous 401, export 403`;
  });

  const browser = await chromium.launch();
  const adminCtx = await browser.newContext({ acceptDownloads: true });
  const empCtx = await browser.newContext();
  const seekCtx = await browser.newContext();
  const ap = await adminCtx.newPage();
  const ep = await empCtx.newPage();
  const sp = await seekCtx.newPage();
  watch(ap, 'admin');
  watch(ep, 'employer');
  watch(sp, 'seeker');

  // ---- Admin UI ----
  await check(
    'Admin: reports in the menu; charts and tiles show the API numbers; hidden rows labelled',
    async () => {
      await uiLogin(ap, 'ar', DEMO.admin, DEMO_PASSWORD, /\/ar\/admin$/);
      await ap.locator('nav a:has-text("التقارير")').first().click();
      await ap.waitForURL(/\/ar\/admin\/reports$/);
      await ap.waitForSelector('h1:has-text("التقارير")');
      await ap.waitForSelector('[data-chart=byNationality] [data-row]');
      const fresh = (await call('/reports', { token: demoAdmin.accessToken })).json;
      const hidden = await compareWithApi(ap, fresh, 'مخفية (أقل من 5)');
      assert(hidden > 0, 'some rows hidden');
      assert((await ap.locator('#rf-from').count()) === 1, 'filters for the admin');
      assert((await ap.locator('[data-export=reports]').count()) === 1, 'export for the admin');
      return `${Object.keys(CHARTS).length} charts, ${hidden} hidden rows`;
    },
  );

  await check('Admin: a country filter changes the numbers to the filtered API report', async () => {
    await ap.selectOption('#rf-country', sa.id);
    await ap.getByRole('button', { name: 'تطبيق' }).click();
    const filtered = (await call(`/reports?countryId=${sa.id}`, { token: demoAdmin.accessToken })).json;
    await ap.waitForFunction((n) => {
      const el = document.querySelector('[data-stat=seekersTotal]');
      return el && el.textContent.replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).includes(String(n));
    }, filtered.seekers.total);
    await compareWithApi(ap, filtered, 'مخفية (أقل من 5)');
    await ap.fill('#rf-from', '2999-01-01');
    await ap.getByRole('button', { name: 'تطبيق' }).click();
    await ap.waitForFunction(() =>
      (document.querySelector('[data-stat=seekersTotal]')?.textContent || '').includes('مخفية'),
    );
    await ap.getByRole('button', { name: 'مسح التصفية' }).click();
    await ap.waitForFunction(
      (n) =>
        (document.querySelector('[data-stat=seekersTotal]')?.textContent || '')
          .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
          .includes(String(n)),
      adminReport.seekers.total,
    );
    return `SA seekers ${filtered.seekers.total}; future range hidden; cleared`;
  });

  let reportFile;
  await check('Admin: reports export needs the password, downloads, and is audited', async () => {
    const before = (await call('/admin/audit?action=EXPORT&pageSize=1', { token: demoAdmin.accessToken }))
      .json.total;
    await ap.locator('[data-export=reports]').click();
    const dlg = ap.getByRole('dialog');
    await ap.fill('#export-reports-pw', 'Wrong-Pass-123');
    await dlg.locator('form button[type=submit]').click();
    await dlg.locator('[role=alert]:not(:empty)').waitFor();
    await ap.fill('#export-reports-pw', DEMO_PASSWORD);
    const [download] = await Promise.all([
      ap.waitForEvent('download', { timeout: 60000 }),
      dlg.locator('form button[type=submit]').click(),
    ]);
    assert(
      /^sanad-reports-\d{4}-\d{2}-\d{2}\.xlsx$/.test(download.suggestedFilename()),
      download.suggestedFilename(),
    );
    reportFile = path.join(OUT_DIR, download.suggestedFilename());
    await download.saveAs(reportFile);
    const audit = await call('/admin/audit?action=EXPORT&pageSize=5', { token: demoAdmin.accessToken });
    assert(audit.json.total === before + 1, `EXPORT rows ${before} -> ${audit.json.total}`);
    assert(JSON.stringify(audit.json.items[0]).includes('reports'), 'audit names the reports kind');
    return `${download.suggestedFilename()} ${fs.statSync(reportFile).size} bytes`;
  });

  await check('Workbook: report sheets, RTL, hidden wording, no count 1-4', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(reportFile);
    const names = wb.worksheets.map((w) => w.name);
    assert(
      JSON.stringify(names) === JSON.stringify(['تقرير الباحثين', 'تقرير الفرص', 'معلومات التقرير']),
      names.join(', '),
    );
    let hidden = 0;
    for (const ws of wb.worksheets.slice(0, 2)) {
      assert(ws.views[0] && ws.views[0].rightToLeft, `${ws.name} RTL`);
      const header = ws.getRow(1).values.slice(1);
      const c = header.indexOf('العدد') + 1;
      assert(c > 0, `${ws.name}: count column (${header.join(' | ')})`);
      ws.eachRow((row, n) => {
        if (n === 1) return;
        const v = row.getCell(c).value;
        if (typeof v === 'number') assert(v === 0 || v >= 5, `${ws.name} row ${n}: ${v}`);
        else if (String(v).includes('مخفية (أقل من 5)')) hidden++;
      });
    }
    assert(hidden > 0, 'hidden rows in the file');
    return `${names.join(', ')}; ${hidden} hidden cells`;
  });

  // ---- Employer UI ----
  await check('Employer: general reports plus own jobs; no filters, no export button', async () => {
    await uiLogin(ep, 'ar', DEMO.employer, DEMO_PASSWORD, /\/ar\/employer$/);
    await ep.locator('nav a:has-text("التقارير")').first().click();
    await ep.waitForURL(/\/ar\/employer\/reports$/);
    await ep.waitForSelector('[data-own]');
    const r = (await call('/reports', { token: demoEmp.accessToken })).json;
    await compareWithApi(ep, r, 'مخفية (أقل من 5)');
    const own = {
      ownTotal: r.own.total,
      ownOpen: r.own.open,
      ownInterest: r.own.interestRequests,
      ownHired: r.own.hiredViaPlatform,
      ownClosed: r.own.closedWithoutHiring,
    };
    for (const [k, v] of Object.entries(own)) {
      const text = await ep.locator(`[data-stat=${k}]`).innerText();
      assert(digits(text) === v, `${k}: ${text} vs ${v}`);
    }
    const rows = await ep.locator('[data-own] ~ * tbody tr, main table tbody tr').count();
    assert(rows === r.own.jobs.length, `own job rows ${rows} vs ${r.own.jobs.length}`);
    assert((await ep.locator('[data-export]').count()) === 0, 'no export button');
    assert((await ep.locator('#rf-from').count()) === 0, 'no filters');
    await ep.goto(`${BASE}/ar/admin/reports`);
    await ep.waitForURL((u) => !/\/admin\/reports/.test(u.pathname));
    return `own jobs ${r.own.jobs.length}; admin page sends the employer away`;
  });

  // ---- Seeker: no reports; two tabs refreshing at once stay signed in ----
  await check('Seeker: no reports entry, and the reports page sends them away', async () => {
    await uiLogin(sp, 'ar', DEMO.seeker, DEMO_PASSWORD, /\/ar\/seeker(\/.*)?$/);
    assert((await sp.locator('nav a:has-text("التقارير")').count()) === 0, 'no reports link');
    await sp.goto(`${BASE}/ar/employer/reports`);
    await sp.waitForURL((u) => !/\/reports/.test(u.pathname));
  });

  await check(
    'Session: two quick navigations and two tabs at once (one refresh token) stay signed in',
    async () => {
      // Each full page load refreshes the session from the cookie. Two loads at once send the same
      // refresh token twice; the second inside the grace window must not end the session.
      // A page starts loading (and refreshing its session), and the user clicks on before it ends.
      await sp.goto(`${BASE}/ar/seeker/jobs`, { waitUntil: 'commit' });
      await sp.goto(`${BASE}/ar/seeker/requests`);
      assert(/\/ar\/seeker\/requests$/.test(sp.url()), `landed on ${sp.url()}`);
      await sp.waitForSelector('main h1');
      // The same race without the browser's help: two refreshes with one cookie.
      const pair = await sp.evaluate(() =>
        Promise.all(
          [0, 1].map(() =>
            fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' }).then((r) => r.status),
          ),
        ),
      );
      assert(
        pair.every((x) => x === 200),
        `two refreshes at once: ${pair}`,
      );
      const second = await seekCtx.newPage();
      watch(second, 'seeker-tab2');
      await Promise.all([sp.goto(`${BASE}/ar/seeker/jobs`), second.goto(`${BASE}/ar/seeker/requests`)]);
      await Promise.all([sp.waitForSelector('main h1'), second.waitForSelector('main h1')]);
      for (const p of [sp, second]) {
        await p.reload();
        await p.waitForSelector('main h1');
        assert(/\/ar\/seeker\//.test(new URL(p.url()).pathname), `still in: ${p.url()}`);
      }
      const status = await sp.evaluate(async () => {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
        return r.status;
      });
      assert(status === 200, `refresh after the race ${status}`);
      await second.close();
      return 'still signed in in both tabs; refresh 200';
    },
  );

  // ---- English ----
  await check('English: admin and employer reports with English wording', async () => {
    await ap.goto(`${BASE}/en/admin/reports`);
    await ap.waitForSelector('h1:has-text("Reports")');
    await ap.waitForSelector('[data-chart=byNationality] [data-row]');
    const hidden = await compareWithApi(
      ap,
      (await call('/reports', { token: demoAdmin.accessToken })).json,
      'Hidden (fewer than 5)',
    );
    assert(hidden > 0, 'hidden rows in English');
    await ep.goto(`${BASE}/en/employer/reports`);
    await ep.waitForSelector('h2:has-text("My jobs in numbers")');
    const tok = await call('/admin/export/token', {
      token: demoAdmin.accessToken,
      body: { password: DEMO_PASSWORD },
    });
    const r = await call('/admin/export/reports', {
      token: demoAdmin.accessToken,
      body: { token: tok.json.token, locale: 'en', reports: { countryId: sa.id } },
    });
    assert(r.status === 200, `en export ${r.status}`);
    const file = path.join(OUT_DIR, 'reports-en.xlsx');
    fs.writeFileSync(file, r.buf);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    assert(wb.worksheets[0].name === 'Seekers report', wb.worksheets[0].name);
    return `${hidden} hidden rows; English workbook ${wb.worksheets.map((w) => w.name).join(', ')}`;
  });

  // ---- 375px ----
  for (const [ctxName, ctx, paths] of [
    ['admin', adminCtx, ['/ar/admin/reports', '/en/admin/reports']],
    ['employer', empCtx, ['/ar/employer/reports', '/en/employer/reports']],
  ]) {
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 375, height: 740 });
    watch(m, `${ctxName}-375`);
    for (const p of paths) {
      await check(`375px, no horizontal scroll, 44px targets: ${ctxName} ${p}`, async () => {
        await m.goto(`${BASE}${p}`);
        await m.waitForSelector('[data-chart=byStatus] [data-row]');
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
    await m.close();
  }

  // ---- Removal and re-seed ----
  await check('Demo removal: every demo account is gone, then the seed adds it back', async () => {
    const out = demoCli('remove');
    assert(/Demo data removed: \d+ accounts/.test(out), out.slice(0, 200));
    assert((await login(DEMO.seeker, DEMO_PASSWORD)) === null, 'demo seeker gone');
    assert((await login(DEMO.admin, DEMO_PASSWORD)) === null, 'demo admin gone');
    const back = demoCli('seed');
    assert(/Demo data added/.test(back), 'seeded again');
    assert(await login(DEMO.employer, DEMO_PASSWORD), 'demo employer back');
    return out.trim().split('\n').pop();
  });

  step('No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  await browser.close();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
