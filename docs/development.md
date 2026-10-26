# دليل المطورين

هذا الملف للمطورين. دليل التشغيل لغير التقنيين في [README.md](../README.md).

## البنية

| المجلد            | المحتوى                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `apps/api`        | الخادم: NestJS 11 + Prisma 6 + PostgreSQL 16، والعامل (worker) لنفس الصورة     |
| `apps/web`        | الواجهة: Next.js 15 (standalone) + next-intl + Tailwind                       |
| `packages/shared` | أنواع وثوابت مشتركة (DTOs، الصلاحيات، الأدوار، أنواع التصدير، أنواع التقارير) |
| `e2e`             | اختبارات متصفح (Playwright) تعمل على المنصة وهي قائمة                         |
| `docs`            | المتطلبات والمعمارية وقاعدة البيانات والتصميم                                 |

الخدمات في `docker-compose.yml`: `postgres` و`redis` و`minio` (+ `minio-init`) و`mailpit` و`api` و`worker` و`web`. المنفذان المنشوران فقط `3000` (الواجهة) و`8025` (Mailpit). الـ API غير منشور، ويصل إليه المتصفح عبر الوكيل `apps/web/src/app/api/[...path]/route.ts` على نفس الأصل. كل التخزين وحدات Docker مسماة (`pgdata` و`redisdata` و`miniodata` و`secrets`)، ولا يوجد أي ربط لمجلدات الجهاز (bind mount).

## الأوامر

من جذر المستودع، بـ Node.js 22 وnpm:

```
npm ci
npm test            # اختبارات الوحدات + فحص الترجمات + الأنواع + lint للواجهة
npm run test:int    # تكامل على PostgreSQL 16 (العنوان في TEST_DATABASE_ADMIN_URL)
npm run build
```

قبل `tsc` في `apps/api` شغّل `npx prisma generate`، وإلا تكون أنواع Prisma عامة وتفوت الأخطاء.

## اختبارات المتصفح

على المنصة وهي تعمل (`docker compose up -d`)، وتحتاج حزمة `playwright`:

```
ADMIN_PASSWORD="$(docker compose exec -T api cat /app/secrets/admin-initial-password.txt)" \
BASE_URL=http://localhost:3000 MAILPIT_URL=http://localhost:8025 node e2e/batch4-admin.cjs
```

| الملف                   | يغطي                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `e2e/batch1-smoke.cjs`   | الرئيسية، التسجيل برمز البريد، الدخول، نسيان كلمة المرور، حساب المدير الأول            |
| `e2e/batch2-profile.cjs` | معالج ملف الباحث والسيرة                                                                 |
| `e2e/batch3-jobs.cjs`    | صاحب العمل، الفرص، المطابقة، طلبات الاهتمام، إخفاء هوية صاحب العمل                      |
| `e2e/batch4-admin.cjs`   | منطقة المدير، التدقيق، "حسابي"، تصدير Excel                                              |
| `e2e/batch5-reports.cjs` | التقارير والإخفاء، تصدير التقارير، تقارير صاحب العمل، حسابات العرض، بقاء الجلسة          |

ترتيب التشغيل من قاعدة جديدة (`docker compose down -v`): 1 ثم 2 ثم 3 ثم 4 ثم 5. الملف 4 يغيّر كلمة مرور المدير إلى `ADMIN_NEW_PASSWORD` (الافتراضي `Sanad-Admin-2026`)، والملف 5 يستخدمها. الملف 5 يضيف بيانات العرض بنفسه إن لم تكن موجودة.

## الواجهات البرمجية المهمة

- **التصدير**: `POST /api/admin/export/token` بكلمة المرور يعطي رمزاً صالحاً 5 دقائق، ثم `POST /api/admin/export/<full|users|audit|reports>` مع `{"token": "...", "locale": "ar"}` يعيد ملف xlsx. لمدراء النظام فقط (`data.export`)، ويُسجّل في سجل التدقيق. نوع `reports` يقبل أيضاً `"reports": {"from","to","sectorId","countryId"}`.
- **التقارير**: `GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&sectorId=&countryId=`.
  - المدير (`reports.all.read`): كل التقارير مع المرشحات.
  - صاحب العمل (`reports.general.read`): التقارير العامة دون مرشحات، وأرقام فرصه هو (`own`).
  - الباحث: 403.
  - الإخفاء على الخادم في `apps/api/src/reports/suppress.ts`: أي فئة أقل من `max(5, settings.reports.minGroupSize)` تصبح `null`، وإن خُفيت فئة واحدة فقط في توزيع تُخفى معها أصغر فئة ظاهرة حتى لا تُستنتج بالطرح، والأزواج (بخبرة/بدونها، متاحة/غير متاحة) تُخفى معاً.
- **المطابقة**: الأوزان (القطاع 40، المؤهل 25، الخبرة 25، الكلمات 10) والحدود (مناسبة 70 فأكثر، مقاربة 45 فأكثر) في `settings` بالمفتاحين `matching.weights` و`matching.thresholds`. يعيد العامل الحساب بعد تعديل الملف أو الفرصة أو الإعدادات بثوانٍ.

## بيانات العرض

- الكود: `apps/api/src/demo/` والأمر `apps/api/src/demo.ts`.
- تُضاف عند التشغيل إذا كان `SEED_DEMO=true`، أو يدوياً: `docker compose exec api node dist/demo.js seed`. الإضافة لا تتكرر (تتحقق من وجود `admin@demo.sanad.local`).
- الحذف: `docker compose exec api node dist/demo.js remove`. يحذف كل حسابات `@demo.sanad.local` وبياناتها وملفات سيرها، ويُسجّل في سجل التدقيق. أوقف `SEED_DEMO` قبل الحذف وإلا عادت البيانات عند التشغيل التالي.
- كل حسابات العرض بكلمة المرور `Demo-Sanad-2026`، للعرض فقط.
- المحتوى: مدير عرض، و7 أصحاب عمل (6 معتمدون وواحد بانتظار الاعتماد)، و40 باحثاً بأسماء عربية وإنجليزية (6 منهم بسير ذاتية)، و20 فرصة (10 متاحة، 5 بتوظيف عبر المنصة، 5 مغلقة دون توظيف)، وطلبات اهتمام. الأعداد مختارة لتظهر في التقارير فئات ظاهرة وأخرى مخفية.

## عنوان العميل وحدود الطلبات

- Next.js لا يضع `X-Forwarded-For` من عنوان الاتصال إلا إذا لم يرسله المتصفح، فكان يمكن تزوير العنوان. لذلك تُحمّل صورة الواجهة `apps/web/client-ip.cjs` قبل الخادم، فتحذف `X-Forwarded-For` و`X-Real-IP` و`Forwarded` القادمة من المتصفح، ويضع Next عنوان الاتصال الفعلي. الوكيل يمرر هذا العنوان فقط، والـ API يثق بالشبكات الداخلية (`trust proxy: loopback, linklocal, uniquelocal`).
- `TRUST_PROXY_HEADERS=true` فقط خلف وكيل عكسي خاص بكم يضع `X-Forwarded-For` بنفسه.
- في Docker Desktop (ويندوز وماك) تصل كل أجهزة الشبكة بعنوان واحد غالباً، فتشترك في حد واحد. `THROTTLE_FACTOR` (1 إلى 100) يضاعف كل الحدود للعروض الجماعية. قفل الحساب بعد كلمات مرور خاطئة يبقى كما هو.
- الحدود الأساسية في الدقيقة لكل عنوان: 300 عامة، 10 للدخول والتحقق، 5 لما يرسل بريداً.

## تجديد الجلسة

رمز التجديد يدور مع كل استخدام. إذا وصل طلبان بنفس الرمز معاً (تنقلان سريعان، تبويبان)، يُقبل الثاني خلال 30 ثانية ويُعطى رمزاً شقيقاً من نفس العائلة ما دامت العائلة نشطة. إعادة الاستخدام بعد ذلك تُعتبر سرقة وتُلغي العائلة كلها.

## البناء خلف وكيل يفحص TLS

لا يلزم في الحالة العادية. إذا كانت الشبكة تفحص TLS بشهادة خاصة، مرّر الشهادة سراً عند البناء (لا تُحفظ في الصورة):

```
docker build --secret id=extra_ca,src=/path/to/ca.pem -f apps/api/Dockerfile -t sanad-api:local .
docker build --secret id=extra_ca,src=/path/to/ca.pem -f apps/web/Dockerfile -t sanad-web:local .
docker compose up -d --no-build
```

## التبعيات و npm audit

- Next.js على 15.5.28 (الإصلاحات الأمنية)، و`overrides` في `package.json` الجذري تثبت النسخ المصححة من `multer` و`uuid` و`postcss` و`zod` و`next`.
- المتبقي: `deepmerge-ts` عبر `@prisma/config` ← `prisma` (3 عالية). الإصلاح في Prisma 7 فقط، وهي ترقية كبرى. الحزمة تُستخدم في أداة سطر أوامر Prisma لقراءة الإعدادات وقت الترحيل، ولا تصل إليها أي مدخلات من المستخدمين.

## نهايات الأسطر

`.gitattributes` يفرض LF لكل الملفات النصية، فالبناء يعمل من نسخة ويندوز. لا توجد سكربتات shell في الصور: نقطة البداية `node dist/start.js`.
