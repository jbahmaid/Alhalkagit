import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PasswordService } from '../auth/password.service';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { CryptoService } from '../crypto/crypto.service';
import { FILE_STORAGE, FileStorage } from '../files/file-storage';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEMO_DOMAIN,
  DEMO_EMPLOYERS,
  DEMO_JOBS,
  DEMO_PASSWORD,
  DEMO_SAMPLE_CV,
  DEMO_SEEKERS,
  demoEmail,
} from './demo-data';
import { makePdf } from './pdf';

const DAY = 86_400_000;
const daysAgo = (n: number, now: number) => new Date(now - n * DAY);
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** The demo actor in the audit log (no user: a system job). */
const ACTOR = { userId: null, role: null, ip: null, userAgent: 'demo-seed' };

export const DEMO_ADMIN_EMAIL = demoEmail('admin');

/**
 * Opt-in demo data (SEED_DEMO=true, or `node dist/demo.js seed`). Idempotent: when the demo
 * admin exists nothing is written. Every row goes through the audited client, so the audit log
 * records it like any other change (actor: system, user agent "demo-seed").
 * `remove()` deletes every account on @demo.sanad.local and everything that hangs off them.
 */
@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger('Demo');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly matching: MatchingService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async seed(now = Date.now()): Promise<'seeded' | 'present'> {
    return this.prisma.runAs(ACTOR, async () => {
      if (await this.db.user.findFirst({ where: { email: DEMO_ADMIN_EMAIL, deletedAt: undefined } })) {
        this.logger.log('Demo data is already present: nothing to do.');
        return 'present';
      }
      const lk = await this.lookups();
      const hash = await this.passwords.hash(DEMO_PASSWORD);

      // CV files go to storage first; if the transaction fails they are removed again.
      const cvs = new Map<number, { key: string; name: string; body: Buffer }>();
      for (const [i, s] of DEMO_SEEKERS.entries()) {
        if (!s.cv) continue;
        const body = makePdf(DEMO_SAMPLE_CV(s.name.join(' '), s.positions[0]?.title ?? s.field));
        const key = `cv/demo/${randomUUID()}.pdf`;
        await this.storage.put(key, body, 'application/pdf');
        cvs.set(i, { key, name: `cv-demo-${pad(i + 1)}.pdf`, body });
      }

      try {
        await this.prisma.tx(async (tx) => this.write(tx as any, lk, hash, cvs, now), { timeout: 180_000 });
      } catch (err) {
        for (const cv of cvs.values()) await this.storage.remove(cv.key).catch(() => undefined);
        throw err;
      }

      // Scores for the open jobs, as the worker would compute them after real edits.
      const changed = await this.matching.recomputeAll();
      this.logger.log(
        `Demo data added: 1 admin, ${DEMO_EMPLOYERS.length} employers, ${DEMO_SEEKERS.length} seekers, ` +
          `${DEMO_JOBS.length} jobs; ${changed} match scores.`,
      );
      this.logger.warn(
        `Demo accounts (all @${DEMO_DOMAIN}) share the password "${DEMO_PASSWORD}". ` +
          'Demo use only: never enable SEED_DEMO on a real installation.',
      );
      return 'seeded';
    });
  }

  private async lookups() {
    const byCode = async <T extends { id: string; code: string }>(rows: Promise<T[]>) =>
      new Map((await rows).map((r) => [r.code, r.id]));
    const need = (map: Map<string, string>, code: string, what: string) => {
      const id = map.get(code);
      if (!id) throw new Error(`demo data: ${what} "${code}" is missing from the reference lists`);
      return id;
    };
    const sel = { id: true, code: true } as const;
    const [sectors, levels, countries, btypes, dars, fakhdhs] = await Promise.all([
      byCode(this.db.sector.findMany({ select: sel })),
      byCode(this.db.educationLevel.findMany({ select: sel })),
      byCode(
        this.db.country
          .findMany({ select: { id: true, isoCode: true } })
          .then((xs) => xs.map((x) => ({ id: x.id, code: x.isoCode }))),
      ),
      byCode(this.db.businessType.findMany({ select: sel })),
      this.db.dar.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      }),
      this.db.fakhdh.findMany({ where: { isActive: true }, select: { id: true, darId: true } }),
    ]);
    return {
      sector: (c: string) => need(sectors, c, 'sector'),
      level: (c: string) => need(levels, c, 'education level'),
      country: (c: string) => need(countries, c, 'country'),
      btype: (c: string) => need(btypes, c, 'business type'),
      dars: dars.map((d) => d.id),
      fakhdhs,
    };
  }

  private async write(
    tx: PrismaService['db'],
    lk: Awaited<ReturnType<DemoSeedService['lookups']>>,
    hash: string,
    cvs: Map<number, { key: string; name: string; body: Buffer }>,
    now: number,
  ): Promise<void> {
    const user = (email: string, role: 'SEEKER' | 'EMPLOYER' | 'ADMIN', created: Date, extra = {}) =>
      tx.user.create({
        data: {
          email,
          passwordHash: hash,
          role,
          status: 'ACTIVE',
          emailVerifiedAt: created,
          createdAt: created,
          ...extra,
        },
      });

    const admin = await user(DEMO_ADMIN_EMAIL, 'ADMIN', daysAgo(200, now), {
      username: 'demo.admin',
      displayName: 'مدير العرض التجريبي',
    });

    // Employers
    const employers = new Map<string, string>();
    for (const e of DEMO_EMPLOYERS) {
      const created = daysAgo(e.monthsAgo * 30 + 3, now);
      const u = await user(demoEmail(e.key), 'EMPLOYER', created);
      const row = await tx.employer.create({
        data: {
          userId: u.id,
          contactName: e.contactName,
          organizationName: e.organizationName,
          sectorId: lk.sector(e.sector),
          businessTypeId: lk.btype(e.businessType),
          email: demoEmail(e.key),
          phone: e.phone,
          approvalStatus: e.approved ? 'APPROVED' : 'PENDING',
          approvedById: e.approved ? admin.id : null,
          approvedAt: e.approved ? new Date(created.getTime() + DAY) : null,
          createdAt: created,
        },
      });
      employers.set(e.key, row.id);
    }

    // Seekers: account, person, profile, education, positions, optional CV
    const seekers: { id: string; sectors: Set<string> }[] = [];
    for (const [i, s] of DEMO_SEEKERS.entries()) {
      const created = daysAgo(6 + i * 4, now);
      const email = demoEmail(`seeker${pad(i + 1)}`);
      const u = await user(email, 'SEEKER', created, { locale: s.locale ?? 'ar' });
      const saudi = s.nationality === 'SA';
      const idType = saudi ? 'NATIONAL_ID' : 'PASSPORT';
      const idNumber = saudi ? `19000000${pad(i + 1)}` : `DM${pad(i + 1, 6)}`;
      const birth = new Date(now);
      birth.setUTCFullYear(birth.getUTCFullYear() - s.age);
      birth.setUTCDate(birth.getUTCDate() - ((i * 37) % 300) - 1);
      const dar = lk.dars.length ? lk.dars[i % lk.dars.length] : null;
      const fakhdh =
        lk.fakhdhs.find((x) => x.darId === dar) ?? lk.fakhdhs.find((x) => x.darId === null) ?? null;
      const person = await tx.person.create({
        data: {
          userId: u.id,
          firstName: s.name[0],
          fatherName: s.name[1],
          grandfatherName: s.name[2],
          familyName: s.name[3],
          idType,
          ...this.crypto.protectIdNumber(idType, idNumber),
          gender: s.gender,
          birthDate: new Date(birth.toISOString().slice(0, 10)),
          nationalityId: lk.country(s.nationality),
          hasSpecialNeeds: i % 13 === 5,
          darId: dar,
          fakhdhId: dar ? (fakhdh?.id ?? null) : null,
          mobile: `+9665099${pad(i + 1, 5)}`,
          email,
          createdAt: created,
        },
      });
      const profile = await tx.seekerProfile.create({
        data: {
          userId: u.id,
          personId: person.id,
          completionStep: 'COMPLETED',
          completedAt: new Date(created.getTime() + DAY),
          hasExperience: s.years > 0,
          yearsOfExperience: s.years > 0 ? s.years : null,
          shareConsentAt: created,
          createdAt: created,
        },
      });
      await tx.seekerEducation.create({
        data: {
          seekerId: profile.id,
          educationLevelId: lk.level(s.education),
          graduationYear: new Date(now).getUTCFullYear() - Math.max(1, s.years + 1),
          institution: s.institution,
          countryId: lk.country(s.nationality),
          fieldOfStudy: s.field,
        },
      });
      const sectors = new Set<string>();
      let start = s.years;
      for (const [k, p] of s.positions.entries()) {
        const span =
          k === 0 ? Math.max(1, Math.ceil(s.years * 0.6)) : Math.max(1, s.years - Math.ceil(s.years * 0.6));
        const from = new Date(now - start * 365 * DAY);
        start -= span;
        await tx.experiencePosition.create({
          data: {
            seekerId: profile.id,
            title: p.title,
            organization: p.org,
            sectorId: lk.sector(p.sector),
            startDate: new Date(from.toISOString().slice(0, 10)),
            endDate:
              k === 0
                ? null
                : new Date(new Date(now - (start + span) * 365 * DAY + 30 * DAY).toISOString().slice(0, 10)),
            sortOrder: k,
          },
        });
        sectors.add(p.sector);
      }
      const cv = cvs.get(i);
      if (cv) {
        const file = await tx.uploadedFile.create({
          data: {
            ownerUserId: u.id,
            purpose: 'CV',
            bucket: this.config.s3.bucket,
            storageKey: cv.key,
            originalName: cv.name,
            mimeType: 'application/pdf',
            sizeBytes: cv.body.length,
            sha256: this.crypto.sha256(cv.body),
          },
        });
        await tx.seekerProfile.update({ where: { id: profile.id }, data: { currentCvFileId: file.id } });
        await tx.cvAnalysis.create({ data: { seekerId: profile.id, fileId: file.id, status: 'SKIPPED' } });
      }
      seekers.push({ id: profile.id, sectors });
    }

    // Jobs, interest requests and outcomes
    let pick = 0;
    for (const [j, d] of DEMO_JOBS.entries()) {
      const published = daysAgo(d.daysAgo, now);
      const job = await tx.job.create({
        data: {
          employerId: employers.get(d.employer)!,
          title: d.title,
          description: d.description,
          sectorId: lk.sector(d.sector),
          city: d.city,
          countryId: lk.country(d.country),
          requiredEducationLevelId: d.education ? lk.level(d.education) : null,
          minYearsExperience: d.minYears,
          employmentType: d.type,
          publishedAt: published,
          createdAt: published,
        },
      });
      // Two to three applicants: people from the job's sector first, then anyone.
      const same = seekers.filter((s) => s.sectors.has(d.sector));
      const chosen = new Set<string>();
      for (const s of same.slice(j % 2, (j % 2) + 2)) chosen.add(s.id);
      chosen.add(seekers[(pick += 7) % seekers.length].id);
      const ids = [...chosen];
      for (const [k, seekerId] of ids.entries()) {
        const at = new Date(published.getTime() + (k + 1) * DAY);
        const status =
          d.outcome === 'hired'
            ? k === 0
              ? 'HIRED'
              : 'NOT_SELECTED'
            : d.outcome === 'closed'
              ? 'NOT_SELECTED'
              : (['SUBMITTED', 'VIEWED', 'CONTACTED'] as const)[(j + k) % 3];
        await tx.interestRequest.create({
          data: {
            jobId: job.id,
            seekerId,
            status,
            consentAt: at,
            employerViewedAt: status === 'SUBMITTED' ? null : new Date(at.getTime() + DAY / 2),
            statusChangedAt: status === 'SUBMITTED' ? null : new Date(at.getTime() + DAY),
            createdAt: at,
          },
        });
      }
      if (d.outcome !== 'open') {
        await tx.job.update({
          where: { id: job.id },
          data: {
            status: 'UNAVAILABLE',
            closedOutcome: d.outcome === 'hired' ? 'HIRED_VIA_PLATFORM' : 'CLOSED_WITHOUT_HIRING',
            hiredSeekerId: d.outcome === 'hired' ? ids[0] : null,
            closedAt: new Date(published.getTime() + 10 * DAY),
          },
        });
      }
    }
  }

  /**
   * Removes the demo data: every account on @demo.sanad.local with its profile, jobs, requests,
   * scores and files. Real accounts are never touched. Each deletion is audited (HARD_DELETE /
   * DELETE); the audit rows themselves stay, as the audit log is append-only.
   */
  async remove(): Promise<number> {
    return this.prisma.runAs(ACTOR, async () => {
      const users = await this.db.user.findMany({
        where: { email: { endsWith: `@${DEMO_DOMAIN}` }, deletedAt: undefined },
        select: { id: true },
      });
      if (!users.length) {
        this.logger.log('No demo data found.');
        return 0;
      }
      const userIds = users.map((u) => u.id);
      const del = { deletedAt: undefined } as const;
      const profiles = (
        await this.db.seekerProfile.findMany({
          where: { userId: { in: userIds }, ...del },
          select: { id: true },
        })
      ).map((p) => p.id);
      const employers = (
        await this.db.employer.findMany({ where: { userId: { in: userIds }, ...del }, select: { id: true } })
      ).map((e) => e.id);
      const jobs = (
        await this.db.job.findMany({ where: { employerId: { in: employers }, ...del }, select: { id: true } })
      ).map((j) => j.id);
      const files = await this.db.uploadedFile.findMany({
        where: { ownerUserId: { in: userIds }, ...del },
        select: { id: true, storageKey: true },
      });

      await this.prisma.tx(
        async () =>
          this.prisma.hardDelete(async (db) => {
            const seekerOrJob = { OR: [{ seekerId: { in: profiles } }, { jobId: { in: jobs } }] };
            await db.interestRequest.deleteMany({ where: seekerOrJob });
            await db.matchScore.deleteMany({ where: seekerOrJob });
            await db.job.updateMany({
              where: { hiredSeekerId: { in: profiles } },
              data: { hiredSeekerId: null },
            });
            await db.job.deleteMany({ where: { id: { in: jobs }, ...del } });
            await db.cvAnalysis.deleteMany({ where: { seekerId: { in: profiles } } });
            await db.experienceContact.deleteMany({ where: { seekerId: { in: profiles }, ...del } });
            await db.experiencePosition.deleteMany({ where: { seekerId: { in: profiles }, ...del } });
            await db.seekerEducation.deleteMany({ where: { seekerId: { in: profiles }, ...del } });
            await db.seekerProfile.deleteMany({ where: { id: { in: profiles }, ...del } });
            await db.uploadedFile.deleteMany({ where: { ownerUserId: { in: userIds }, ...del } });
            await db.person.deleteMany({ where: { userId: { in: userIds }, ...del } });
            await db.employer.deleteMany({ where: { id: { in: employers }, ...del } });
            await db.emailVerificationCode.deleteMany({ where: { userId: { in: userIds } } });
            await db.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
            await db.userPermission.deleteMany({ where: { userId: { in: userIds } } });
            await db.user.deleteMany({ where: { id: { in: userIds }, ...del } });
          }),
        { timeout: 180_000 },
      );
      for (const f of files) await this.storage.remove(f.storageKey).catch(() => undefined);
      this.logger.log(
        `Demo data removed: ${users.length} accounts, ${jobs.length} jobs, ${files.length} files.`,
      );
      return users.length;
    });
  }
}
