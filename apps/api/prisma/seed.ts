/**
 * Seed script: منصة ربط الكفاءات المهنية
 *
 * يملأ القوائم المرجعية والصلاحيات والإعدادات الافتراضية وحساب المدير.
 * Idempotent: كل الإدخالات upsert بمفتاح ثابت (code / key / email).
 * لا يكتب فوق تعديلات المدير: القيم الموجودة لا تُحدَّث (update: {})،
 * إلا حساب المدير الذي يُضمن دوره وحالته فقط.
 *
 * متغيرات البيئة:
 *   DATABASE_URL            (إلزامي)
 *   ADMIN_EMAIL             بريد حساب المدير الأعلى. إن غاب لا يُنشأ الحساب.
 *   ADMIN_PASSWORD          كلمة مروره (12 حرفاً على الأقل). لا تُحفظ في المستودع.
 *   ADMIN_RESET_PASSWORD    "true" لإعادة تعيين كلمة مرور حساب موجود.
 *   SEED_SAMPLE_TRIBE_DATA  "false" لتخطي الديار والأفخاذ التجريبية (افتراضياً تُضاف).
 *
 * التشغيل: npx prisma db seed  (مع "prisma": {"seed": "tsx prisma/seed.ts"} في package.json)
 */
import { PrismaClient, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Permissions (fine-grained, FR-2.4.1)
// ---------------------------------------------------------------------------

type PermissionDef = { code: string; ar: string; en: string; roles: UserRole[] };

const ADMINS: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

const PERMISSIONS: PermissionDef[] = [
  { code: 'profile.self.read', ar: 'قراءة الملف الشخصي', en: 'Read own profile', roles: [UserRole.SEEKER, UserRole.EMPLOYER] },
  { code: 'profile.self.update', ar: 'تعديل الملف الشخصي', en: 'Update own profile', roles: [UserRole.SEEKER, UserRole.EMPLOYER] },
  { code: 'jobs.browse', ar: 'تصفح الفرص المتاحة', en: 'Browse open jobs', roles: [UserRole.SEEKER] },
  { code: 'interests.create', ar: 'رفع طلب اهتمام', en: 'Submit interest request', roles: [UserRole.SEEKER] },
  { code: 'jobs.own.manage', ar: 'إدارة فرصه', en: 'Manage own jobs', roles: [UserRole.EMPLOYER] },
  { code: 'interests.own.read', ar: 'قراءة طلبات الاهتمام على فرصه', en: 'Read interest requests on own jobs', roles: [UserRole.EMPLOYER] },
  { code: 'reports.general.read', ar: 'قراءة التقارير المجمّعة العامة', en: 'Read general aggregate reports', roles: [UserRole.EMPLOYER, ...ADMINS] },
  { code: 'seekers.read', ar: 'قراءة ملفات الباحثين', en: 'Read seeker profiles', roles: ADMINS },
  { code: 'seekers.update', ar: 'تعديل ملفات الباحثين', en: 'Update seeker profiles', roles: ADMINS },
  { code: 'seekers.id_number.reveal', ar: 'إظهار رقم الهوية', en: 'Reveal ID number', roles: ADMINS },
  { code: 'employers.read', ar: 'قراءة بيانات أصحاب العمل', en: 'Read employer data', roles: ADMINS },
  { code: 'employers.update', ar: 'تعديل بيانات أصحاب العمل', en: 'Update employer data', roles: ADMINS },
  { code: 'employers.approve', ar: 'اعتماد أصحاب العمل', en: 'Approve employers', roles: ADMINS },
  { code: 'jobs.manage', ar: 'إدارة كل الفرص', en: 'Manage all jobs', roles: ADMINS },
  { code: 'interests.read', ar: 'قراءة كل طلبات الاهتمام', en: 'Read all interest requests', roles: ADMINS },
  { code: 'lookups.manage', ar: 'إدارة القوائم المرجعية', en: 'Manage lookup lists', roles: ADMINS },
  { code: 'reports.all.read', ar: 'قراءة كل التقارير', en: 'Read all reports', roles: ADMINS },
  { code: 'audit.read', ar: 'قراءة سجل التدقيق', en: 'Read audit log', roles: ADMINS },
  { code: 'settings.manage', ar: 'إدارة الإعدادات', en: 'Manage settings', roles: ADMINS },
  { code: 'users.manage', ar: 'إدارة الحسابات', en: 'Manage user accounts', roles: ADMINS },
  { code: 'records.hard_delete', ar: 'الحذف النهائي', en: 'Hard delete records', roles: [UserRole.SUPER_ADMIN] },
  { code: 'admins.manage', ar: 'إدارة حسابات المدراء', en: 'Manage admin accounts', roles: [UserRole.SUPER_ADMIN] },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

type Lookup = { code: string; ar: string; en: string };

const SECTORS: Lookup[] = [
  { code: 'IT', ar: 'تقنية المعلومات والاتصالات', en: 'Information & Communications Technology' },
  { code: 'HEALTH', ar: 'الصحة والرعاية الطبية', en: 'Healthcare' },
  { code: 'EDUCATION', ar: 'التعليم والتدريب', en: 'Education & Training' },
  { code: 'FINANCE', ar: 'المالية والمصارف والتأمين', en: 'Finance, Banking & Insurance' },
  { code: 'ENGINEERING', ar: 'الهندسة والإنشاءات', en: 'Engineering & Construction' },
  { code: 'ENERGY', ar: 'الطاقة والنفط والغاز', en: 'Energy, Oil & Gas' },
  { code: 'MANUFACTURING', ar: 'الصناعة والتصنيع', en: 'Industry & Manufacturing' },
  { code: 'RETAIL', ar: 'التجزئة والتجارة', en: 'Retail & Trade' },
  { code: 'LOGISTICS', ar: 'النقل والخدمات اللوجستية', en: 'Transport & Logistics' },
  { code: 'HOSPITALITY', ar: 'السياحة والضيافة', en: 'Tourism & Hospitality' },
  { code: 'GOVERNMENT', ar: 'القطاع الحكومي والخدمات العامة', en: 'Government & Public Services' },
  { code: 'MILITARY_SECURITY', ar: 'القطاع العسكري والأمني', en: 'Military & Security' },
  { code: 'LEGAL', ar: 'القانون والاستشارات', en: 'Legal & Consulting' },
  { code: 'MARKETING_MEDIA', ar: 'التسويق والإعلام', en: 'Marketing & Media' },
  { code: 'HR_ADMIN', ar: 'الموارد البشرية والإدارة', en: 'Human Resources & Administration' },
  { code: 'AGRICULTURE', ar: 'الزراعة والبيئة والمياه', en: 'Agriculture, Environment & Water' },
  { code: 'REAL_ESTATE', ar: 'العقارات', en: 'Real Estate' },
  { code: 'NONPROFIT', ar: 'القطاع غير الربحي', en: 'Non-profit' },
];

/** rank: الأعلى يعني مؤهلاً أعلى. المطابقة تقارن rank. */
const EDUCATION_LEVELS: (Lookup & { rank: number })[] = [
  { code: 'BELOW_SECONDARY', ar: 'أقل من الثانوي', en: 'Below secondary', rank: 10 },
  { code: 'SECONDARY', ar: 'ثانوي', en: 'Secondary (high school)', rank: 20 },
  { code: 'DIPLOMA', ar: 'دبلوم', en: 'Diploma', rank: 30 },
  { code: 'BACHELOR', ar: 'بكالوريوس', en: "Bachelor's degree", rank: 40 },
  { code: 'HIGHER_DIPLOMA', ar: 'دبلوم عالٍ', en: 'Higher diploma', rank: 45 },
  { code: 'MASTER', ar: 'ماجستير', en: "Master's degree", rank: 50 },
  { code: 'DOCTORATE', ar: 'دكتوراه', en: 'Doctorate (PhD)', rank: 60 },
];

/** iso: ISO 3166-1 alpha-2. السعودية ثم الخليج أولاً. */
const COUNTRIES: { iso: string; ar: string; en: string }[] = [
  { iso: 'SA', ar: 'المملكة العربية السعودية', en: 'Saudi Arabia' },
  { iso: 'AE', ar: 'الإمارات العربية المتحدة', en: 'United Arab Emirates' },
  { iso: 'KW', ar: 'الكويت', en: 'Kuwait' },
  { iso: 'QA', ar: 'قطر', en: 'Qatar' },
  { iso: 'BH', ar: 'البحرين', en: 'Bahrain' },
  { iso: 'OM', ar: 'عُمان', en: 'Oman' },
  { iso: 'YE', ar: 'اليمن', en: 'Yemen' },
  { iso: 'JO', ar: 'الأردن', en: 'Jordan' },
  { iso: 'EG', ar: 'مصر', en: 'Egypt' },
  { iso: 'IQ', ar: 'العراق', en: 'Iraq' },
  { iso: 'SY', ar: 'سوريا', en: 'Syria' },
  { iso: 'LB', ar: 'لبنان', en: 'Lebanon' },
  { iso: 'PS', ar: 'فلسطين', en: 'Palestine' },
  { iso: 'SD', ar: 'السودان', en: 'Sudan' },
  { iso: 'LY', ar: 'ليبيا', en: 'Libya' },
  { iso: 'TN', ar: 'تونس', en: 'Tunisia' },
  { iso: 'DZ', ar: 'الجزائر', en: 'Algeria' },
  { iso: 'MA', ar: 'المغرب', en: 'Morocco' },
  { iso: 'TR', ar: 'تركيا', en: 'Turkey' },
  { iso: 'PK', ar: 'باكستان', en: 'Pakistan' },
  { iso: 'IN', ar: 'الهند', en: 'India' },
  { iso: 'MY', ar: 'ماليزيا', en: 'Malaysia' },
  { iso: 'GB', ar: 'المملكة المتحدة', en: 'United Kingdom' },
  { iso: 'IE', ar: 'أيرلندا', en: 'Ireland' },
  { iso: 'DE', ar: 'ألمانيا', en: 'Germany' },
  { iso: 'FR', ar: 'فرنسا', en: 'France' },
  { iso: 'US', ar: 'الولايات المتحدة', en: 'United States' },
  { iso: 'CA', ar: 'كندا', en: 'Canada' },
  { iso: 'AU', ar: 'أستراليا', en: 'Australia' },
  { iso: 'NZ', ar: 'نيوزيلندا', en: 'New Zealand' },
];

/** بيانات تجريبية فقط: يستبدلها المدير بالديار والأفخاذ الحقيقية من لوحة الإدارة. */
const SAMPLE_DARS: Lookup[] = [
  { code: 'SAMPLE_DAR_1', ar: 'دار تجريبية ١ (تجريبي)', en: 'Sample Dar 1 (sample)' },
  { code: 'SAMPLE_DAR_2', ar: 'دار تجريبية ٢ (تجريبي)', en: 'Sample Dar 2 (sample)' },
  { code: 'SAMPLE_DAR_3', ar: 'دار تجريبية ٣ (تجريبي)', en: 'Sample Dar 3 (sample)' },
];

const SAMPLE_FAKHDHS: (Lookup & { darCode: string | null })[] = [
  { code: 'SAMPLE_FAKHDH_1A', darCode: 'SAMPLE_DAR_1', ar: 'فخذ تجريبي ١-أ (تجريبي)', en: 'Sample Fakhdh 1-A (sample)' },
  { code: 'SAMPLE_FAKHDH_1B', darCode: 'SAMPLE_DAR_1', ar: 'فخذ تجريبي ١-ب (تجريبي)', en: 'Sample Fakhdh 1-B (sample)' },
  { code: 'SAMPLE_FAKHDH_2A', darCode: 'SAMPLE_DAR_2', ar: 'فخذ تجريبي ٢-أ (تجريبي)', en: 'Sample Fakhdh 2-A (sample)' },
  { code: 'SAMPLE_FAKHDH_3A', darCode: 'SAMPLE_DAR_3', ar: 'فخذ تجريبي ٣-أ (تجريبي)', en: 'Sample Fakhdh 3-A (sample)' },
  { code: 'SAMPLE_FAKHDH_X', darCode: null, ar: 'فخذ تجريبي غير مرتبط بدار (تجريبي)', en: 'Sample Fakhdh without Dar (sample)' },
];

// ---------------------------------------------------------------------------
// Settings (architecture sections 6, 7, 8). Env vars override feature flags at runtime.
// ---------------------------------------------------------------------------

const SETTINGS: { key: string; value: Prisma.InputJsonValue; ar: string; en: string }[] = [
  {
    key: 'matching.weights',
    value: { sector: 40, education: 25, experience: 25, keywords: 10 },
    ar: 'أوزان عوامل المطابقة (المجموع 100)',
    en: 'Matching factor weights (sum to 100)',
  },
  {
    key: 'matching.thresholds',
    value: { suitable: 70, near: 45 },
    ar: 'حدود شارتي "مناسبة" و"مقاربة"',
    en: 'Thresholds for "suitable" and "near" badges',
  },
  { key: 'features.smsEnabled', value: false, ar: 'تفعيل رسائل SMS', en: 'Enable SMS' },
  { key: 'features.cvAnalysisEnabled', value: false, ar: 'تفعيل تحليل السير الذاتية', en: 'Enable CV analysis' },
  { key: 'cvAnalysis.model', value: 'claude-opus-5-5', ar: 'نموذج تحليل السير', en: 'CV analysis model' },
  {
    key: 'reports.minGroupSize',
    value: 5,
    ar: 'أقل عدد لعرض فئة في التقارير',
    en: 'Minimum group size shown in reports',
  },
];

// ---------------------------------------------------------------------------

async function seedPermissions() {
  for (const p of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { code: p.code },
      create: { code: p.code, descriptionAr: p.ar, descriptionEn: p.en },
      update: { descriptionAr: p.ar, descriptionEn: p.en },
    });
    for (const role of p.roles) {
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role, permissionId: perm.id } },
        create: { role, permissionId: perm.id },
        update: {},
      });
    }
  }
}

async function seedLookups(includeSampleTribe: boolean) {
  for (const [i, s] of SECTORS.entries()) {
    await prisma.sector.upsert({
      where: { code: s.code },
      create: { code: s.code, nameAr: s.ar, nameEn: s.en, sortOrder: (i + 1) * 10 },
      update: {},
    });
  }
  for (const [i, e] of EDUCATION_LEVELS.entries()) {
    await prisma.educationLevel.upsert({
      where: { code: e.code },
      create: { code: e.code, nameAr: e.ar, nameEn: e.en, rank: e.rank, sortOrder: (i + 1) * 10 },
      update: {},
    });
  }
  for (const [i, c] of COUNTRIES.entries()) {
    await prisma.country.upsert({
      where: { isoCode: c.iso },
      create: { isoCode: c.iso, nameAr: c.ar, nameEn: c.en, sortOrder: (i + 1) * 10 },
      update: {},
    });
  }
  if (!includeSampleTribe) return;

  const darIds = new Map<string, string>();
  for (const [i, d] of SAMPLE_DARS.entries()) {
    const dar = await prisma.dar.upsert({
      where: { code: d.code },
      create: { code: d.code, nameAr: d.ar, nameEn: d.en, sortOrder: (i + 1) * 10 },
      update: {},
    });
    darIds.set(d.code, dar.id);
  }
  for (const [i, f] of SAMPLE_FAKHDHS.entries()) {
    await prisma.fakhdh.upsert({
      where: { code: f.code },
      create: {
        code: f.code,
        nameAr: f.ar,
        nameEn: f.en,
        sortOrder: (i + 1) * 10,
        darId: f.darCode ? darIds.get(f.darCode) ?? null : null,
      },
      update: {},
    });
  }
}

async function seedSettings() {
  for (const s of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value, descriptionAr: s.ar, descriptionEn: s.en },
      update: { descriptionAr: s.ar, descriptionEn: s.en }, // القيمة لا تُستبدل
    });
  }
}

async function seedAdmin(): Promise<string | null> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set: skipping admin account.');
    return null;
  }
  if (password.length < 12) {
    throw new Error('[seed] ADMIN_PASSWORD must be at least 12 characters.');
  }

  const hash = () => argon2.hash(password, { type: argon2.argon2id });
  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hash(),
        role: UserRole.SUPER_ADMIN,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        locale: 'ar',
      },
    });
    return user.id;
  }

  // الحساب موجود: نضمن الدور والحالة فقط، ولا نغيّر كلمة المرور إلا بطلب صريح.
  const resetPassword = process.env.ADMIN_RESET_PASSWORD === 'true';
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: UserRole.SUPER_ADMIN,
      status: 'ACTIVE',
      emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      deletedAt: null,
      ...(resetPassword ? { passwordHash: await hash() } : {}),
    },
  });
  return existing.id;
}

async function main() {
  const includeSampleTribe = process.env.SEED_SAMPLE_TRIBE_DATA !== 'false';

  await seedPermissions();
  await seedLookups(includeSampleTribe);
  await seedSettings();
  const adminId = await seedAdmin();

  // كل تغيير يُسجّل: قيد واحد يلخص تشغيل البذر (لا يحتوي أسراراً).
  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      actorRole: null,
      action: 'CREATE',
      entity: 'seed',
      after: {
        permissions: PERMISSIONS.length,
        sectors: SECTORS.length,
        educationLevels: EDUCATION_LEVELS.length,
        countries: COUNTRIES.length,
        sampleDars: includeSampleTribe ? SAMPLE_DARS.length : 0,
        sampleFakhdhs: includeSampleTribe ? SAMPLE_FAKHDHS.length : 0,
        settings: SETTINGS.map((s) => s.key),
        adminUserId: adminId,
      },
    },
  });

  console.log('[seed] done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
