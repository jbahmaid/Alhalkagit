import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, UserRole } from '@prisma/client';
import {
  EXPORT_AUDIT_LIMIT,
  localSaudiMobile,
  type ExportKind,
  type ReportRow,
  type ReportsDto,
} from '@sanad/shared';
import type { Writable } from 'node:stream';
import { AuditService } from '../../audit/audit.service';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../../reports/reports.service';
import { completionOf } from '../../seekers/profile-completion';
import { AdminAuditService } from '../admin-audit.service';
import { AdminUsersService } from '../admin-users.service';
import { AuditFiltersDto, ReportFiltersDto, UserFiltersDto } from '../dto/admin.dto';
import { chunked, EXPORT_DICT, ExportDict, ExportLocale, SheetSpec, writeWorkbook } from './workbook';

type Named = { nameAr: string; nameEn: string };
type Names = Map<string, Named>;
type PersonName = { firstName: string; fatherName: string; grandfatherName: string; familyName: string };

export interface ExportRequest {
  kind: ExportKind;
  locale: ExportLocale;
  users?: UserFiltersDto;
  audit?: AuditFiltersDto;
  reports?: ReportFiltersDto;
}

/** One line of a report sheet: the report, the category and its (possibly hidden) count. */
interface ReportLine {
  report: string;
  category: string;
  count: number | string;
}

/** What one export contains: its sheets and the filters behind them (for the audit row). */
export interface ExportPlan {
  sheets: SheetSpec[];
  filters: Record<string, unknown>;
}

const fullName = (p: PersonName | null | undefined) =>
  p ? [p.firstName, p.fatherName, p.grandfatherName, p.familyName].join(' ') : null;
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const clean = (o: object | undefined) =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/**
 * Excel export (FR-2.5.4, architecture §8). Each sheet is a `SheetSpec` built by a small method
 * here, so later reports (batch 5) add a builder and a kind. The file is streamed into the
 * response and never stored; the caller audits every export (EXPORT) before it starts.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly users: AdminUsersService,
    private readonly auditLog: AdminAuditService,
    private readonly reports: ReportsService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /** Builds the sheets for a kind (lookups loaded once, rows streamed in chunks). */
  async plan(req: ExportRequest): Promise<ExportPlan> {
    const t = EXPORT_DICT[req.locale];
    const names = await this.lookupNames();
    const nm = (id: string | null | undefined) => {
      const n = id ? names.get(id) : undefined;
      return n ? (req.locale === 'ar' ? n.nameAr : n.nameEn) : null;
    };
    switch (req.kind) {
      case 'users':
        return { sheets: [await this.usersSheet(t, req.users ?? {})], filters: { users: clean(req.users) } };
      case 'audit':
        return { sheets: [await this.auditSheet(t, req.audit ?? {})], filters: { audit: clean(req.audit) } };
      case 'reports': {
        const filters = clean(req.reports);
        const data = await this.reports.report('all', filters);
        return { sheets: this.reportSheets(t, req.locale, data, nm), filters: { reports: filters } };
      }
      case 'full':
        return {
          sheets: [
            await this.seekersSheet(t, nm),
            this.employersSheet(t, nm),
            this.jobsSheet(t, nm),
            this.interestsSheet(t),
            this.hiresSheet(t),
            await this.usersSheet(t, req.users ?? {}),
            await this.auditSheet(t, req.audit ?? {}),
          ],
          filters: { users: clean(req.users), audit: clean(req.audit), auditLimit: EXPORT_AUDIT_LIMIT },
        };
    }
  }

  /** Plans and audits an export (EXPORT: kind, sheets, filters). Nothing is written yet. */
  async prepare(req: ExportRequest): Promise<ExportPlan> {
    const plan = await this.plan(req);
    await this.audit.record(AuditAction.EXPORT, 'export', null, {
      kind: req.kind,
      locale: req.locale,
      sheets: plan.sheets.map((s) => s.key),
      filters: plan.filters,
    });
    return plan;
  }

  /** Streams the workbook into `out` (the HTTP response). Returns the rows per sheet. */
  write(plan: ExportPlan, locale: ExportLocale, out: Writable): Promise<Record<string, number>> {
    return writeWorkbook(out, locale, plan.sheets);
  }

  // ---------------------------------------------------------------------------
  // Shared lookups
  // ---------------------------------------------------------------------------

  private async lookupNames(): Promise<Names> {
    const sel = { id: true, nameAr: true, nameEn: true } as const;
    const all = await Promise.all([
      this.db.country.findMany({ select: sel, where: { deletedAt: undefined } }),
      this.db.sector.findMany({ select: sel, where: { deletedAt: undefined } }),
      this.db.educationLevel.findMany({ select: sel, where: { deletedAt: undefined } }),
      this.db.dar.findMany({ select: sel, where: { deletedAt: undefined } }),
      this.db.fakhdh.findMany({ select: sel, where: { deletedAt: undefined } }),
      this.db.businessType.findMany({ select: sel, where: { deletedAt: undefined } }),
    ]);
    return new Map(all.flat().map((r) => [r.id, r]));
  }

  private yesNo(t: ExportDict, v: boolean | null | undefined): string | null {
    return v === null || v === undefined ? null : v ? t.values.yes : t.values.no;
  }

  /** Seeker names by profile id. */
  private async seekerNames(
    profileIds: string[],
  ): Promise<Map<string, { name: string | null; mobile: string | null; email: string | null }>> {
    if (!profileIds.length) return new Map();
    const profiles = await this.db.seekerProfile.findMany({
      where: { id: { in: profileIds }, deletedAt: undefined },
      select: { id: true, personId: true, userId: true },
    });
    const personIds = profiles.map((p) => p.personId).filter((x): x is string => !!x);
    const [people, users] = await Promise.all([
      this.db.person.findMany({ where: { id: { in: personIds }, deletedAt: undefined } }),
      this.db.user.findMany({
        where: { id: { in: profiles.map((p) => p.userId) }, deletedAt: undefined },
        select: { id: true, email: true },
      }),
    ]);
    return new Map(
      profiles.map((p) => {
        const person = people.find((x) => x.id === p.personId);
        const user = users.find((u) => u.id === p.userId);
        return [
          p.id,
          {
            name: fullName(person) ?? user?.email ?? null,
            mobile: person?.mobile ? localSaudiMobile(person.mobile) : null,
            email: person?.email ?? user?.email ?? null,
          },
        ];
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Sheets
  // ---------------------------------------------------------------------------

  /** Every seeker with the full profile, including the decrypted ID number. */
  private async seekersSheet(
    t: ExportDict,
    nm: (id: string | null | undefined) => string | null,
  ): Promise<SheetSpec> {
    // Completion needs to know whether dars / fakhdhs are required (any active ones).
    const [darCount, fakhdhs] = await Promise.all([
      this.db.dar.count({ where: { isActive: true } }),
      this.db.fakhdh.findMany({ where: { isActive: true }, select: { darId: true } }),
    ]);
    const fakhdhRequired = (darId: string | null) =>
      fakhdhs.some((f) => f.darId === null || f.darId === darId);

    type Row = Awaited<ReturnType<typeof load>>[number];
    const load = async (skip: number, take: number) => {
      const profiles = await this.db.seekerProfile.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      });
      const ids = profiles.map((p) => p.id);
      const [users, people, educations, positions, verifiers, files] = await Promise.all([
        this.db.user.findMany({ where: { id: { in: profiles.map((p) => p.userId) }, deletedAt: undefined } }),
        this.db.person.findMany({
          where: { id: { in: profiles.map((p) => p.personId).filter((x): x is string => !!x) } },
        }),
        this.db.seekerEducation.findMany({
          where: { seekerId: { in: ids } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        this.db.experiencePosition.findMany({
          where: { seekerId: { in: ids } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        this.db.experienceContact.findMany({ where: { seekerId: { in: ids }, positionId: null } }),
        this.db.uploadedFile.findMany({
          where: { id: { in: profiles.map((p) => p.currentCvFileId).filter((x): x is string => !!x) } },
          select: { id: true, originalName: true },
        }),
      ]);
      return profiles.map((p) => {
        const person = people.find((x) => x.id === p.personId) ?? null;
        const edu = educations.find((e) => e.seekerId === p.id) ?? null;
        const pos = positions.filter((x) => x.seekerId === p.id);
        const { percent } = completionOf({
          hasPerson: !!person,
          darId: person?.darId ?? null,
          fakhdhId: person?.fakhdhId ?? null,
          darRequired: darCount > 0,
          fakhdhRequired: fakhdhRequired(person?.darId ?? null),
          mobile: person?.mobile ?? null,
          email: person?.email ?? null,
          hasEducation: !!edu,
          hasExperience: p.hasExperience,
          yearsOfExperience: p.yearsOfExperience,
          positionCount: pos.length,
          hasCv: !!p.currentCvFileId,
          completedAt: p.completedAt,
        });
        return {
          p,
          user: users.find((u) => u.id === p.userId) ?? null,
          person,
          idNumber: person ? this.crypto.decrypt(person.idNumberEncrypted) : null,
          edu,
          pos,
          verifier: verifiers.find((v) => v.seekerId === p.id) ?? null,
          cv: files.find((f) => f.id === p.currentCvFileId)?.originalName ?? null,
          percent,
        };
      });
    };
    const positionsText = (r: Row) =>
      r.pos
        .map((x) => {
          const where = [x.organization, nm(x.sectorId)].filter(Boolean).join('، ');
          const span = `${ymd(x.startDate)} → ${x.endDate ? ymd(x.endDate) : t.values.present}`;
          return `${x.title}${where ? ` (${where})` : ''}: ${span}`;
        })
        .join('\n');

    const sheet: SheetSpec<Row> = {
      key: 'seekers',
      rows: () => chunked(load, 200),
      columns: [
        { key: 'firstName', value: (r) => r.person?.firstName },
        { key: 'fatherName', value: (r) => r.person?.fatherName },
        { key: 'grandfatherName', value: (r) => r.person?.grandfatherName },
        { key: 'familyName', value: (r) => r.person?.familyName },
        { key: 'idType', value: (r) => (r.person ? t.enums.idType[r.person.idType] : null) },
        { key: 'idNumber', width: 16, value: (r) => r.idNumber },
        { key: 'gender', width: 10, value: (r) => (r.person ? t.enums.gender[r.person.gender] : null) },
        { key: 'birthDate', type: 'date', value: (r) => r.person?.birthDate },
        { key: 'nationality', value: (r) => nm(r.person?.nationalityId) },
        { key: 'specialNeeds', width: 12, value: (r) => this.yesNo(t, r.person?.hasSpecialNeeds) },
        { key: 'dar', value: (r) => nm(r.person?.darId) },
        { key: 'fakhdh', value: (r) => nm(r.person?.fakhdhId) },
        { key: 'mobile', width: 14, value: (r) => localSaudiMobile(r.person?.mobile) },
        { key: 'contactEmail', width: 28, value: (r) => r.person?.email },
        { key: 'loginEmail', width: 28, value: (r) => r.user?.email },
        { key: 'educationLevel', value: (r) => nm(r.edu?.educationLevelId) },
        { key: 'institution', width: 28, value: (r) => r.edu?.institution },
        { key: 'fieldOfStudy', value: (r) => r.edu?.fieldOfStudy },
        { key: 'graduationYear', type: 'number', value: (r) => r.edu?.graduationYear },
        { key: 'educationCountry', value: (r) => nm(r.edu?.countryId) },
        { key: 'hasExperience', width: 12, value: (r) => this.yesNo(t, r.p.hasExperience) },
        { key: 'yearsOfExperience', type: 'number', value: (r) => r.p.yearsOfExperience },
        { key: 'positions', width: 50, value: positionsText },
        { key: 'verifierName', value: (r) => r.verifier?.name },
        {
          key: 'verifierPhone',
          width: 16,
          value: (r) => (r.verifier?.phone ? localSaudiMobile(r.verifier.phone) : null),
        },
        { key: 'verifierEmail', width: 26, value: (r) => r.verifier?.email },
        { key: 'cvFile', width: 28, value: (r) => r.cv },
        { key: 'completion', type: 'percent', value: (r) => r.percent },
        { key: 'completedAt', type: 'datetime', value: (r) => r.p.completedAt },
        { key: 'accountStatus', value: (r) => (r.user ? t.enums.userStatus[r.user.status] : null) },
        { key: 'registeredAt', type: 'datetime', value: (r) => r.user?.createdAt ?? r.p.createdAt },
      ],
    };
    return sheet;
  }

  private employersSheet(t: ExportDict, nm: (id: string | null | undefined) => string | null): SheetSpec {
    const load = async (skip: number, take: number) => {
      const employers = await this.db.employer.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      });
      const users = await this.db.user.findMany({
        where: { id: { in: employers.map((e) => e.userId) }, deletedAt: undefined },
      });
      return employers.map((e) => ({ e, user: users.find((u) => u.id === e.userId) ?? null }));
    };
    type Row = Awaited<ReturnType<typeof load>>[number];
    const sheet: SheetSpec<Row> = {
      key: 'employers',
      rows: () => chunked(load),
      columns: [
        { key: 'contactName', value: (r) => r.e.contactName },
        { key: 'organization', width: 28, value: (r) => r.e.organizationName },
        { key: 'sector', value: (r) => nm(r.e.sectorId) },
        { key: 'businessType', value: (r) => nm(r.e.businessTypeId) },
        { key: 'email', width: 28, value: (r) => r.e.email },
        { key: 'phone', width: 16, value: (r) => localSaudiMobile(r.e.phone) },
        { key: 'loginEmail', width: 28, value: (r) => r.user?.email },
        { key: 'emailVerifiedAt', type: 'datetime', value: (r) => r.user?.emailVerifiedAt },
        { key: 'approvalStatus', value: (r) => t.enums.approval[r.e.approvalStatus] },
        { key: 'approvedAt', type: 'datetime', value: (r) => r.e.approvedAt },
        { key: 'rejectionReason', width: 30, value: (r) => r.e.rejectionReason },
        { key: 'accountStatus', value: (r) => (r.user ? t.enums.userStatus[r.user.status] : null) },
        { key: 'registeredAt', type: 'datetime', value: (r) => r.e.createdAt },
      ],
    };
    return sheet;
  }

  private jobsSheet(t: ExportDict, nm: (id: string | null | undefined) => string | null): SheetSpec {
    const load = async (skip: number, take: number) => {
      const jobs = await this.db.job.findMany({
        orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      });
      const [employers, counts, hired] = await Promise.all([
        this.db.employer.findMany({
          where: { id: { in: [...new Set(jobs.map((j) => j.employerId))] }, deletedAt: undefined },
          select: { id: true, organizationName: true },
        }),
        jobs.length
          ? this.db.interestRequest.groupBy({
              by: ['jobId'],
              where: { jobId: { in: jobs.map((j) => j.id) }, status: { not: 'WITHDRAWN' } },
              _count: { _all: true },
            })
          : Promise.resolve([] as { jobId: string; _count: { _all: number } }[]),
        this.seekerNames(jobs.map((j) => j.hiredSeekerId).filter((x): x is string => !!x)),
      ]);
      return jobs.map((j) => ({
        j,
        org: employers.find((e) => e.id === j.employerId)?.organizationName ?? null,
        count: counts.find((c) => c.jobId === j.id)?._count._all ?? 0,
        hired: j.hiredSeekerId ? (hired.get(j.hiredSeekerId)?.name ?? null) : null,
      }));
    };
    type Row = Awaited<ReturnType<typeof load>>[number];
    const sheet: SheetSpec<Row> = {
      key: 'jobs',
      rows: () => chunked(load),
      columns: [
        { key: 'jobTitle', width: 28, value: (r) => r.j.title },
        { key: 'organization', width: 28, value: (r) => r.org },
        { key: 'sector', value: (r) => nm(r.j.sectorId) },
        { key: 'city', value: (r) => r.j.city },
        { key: 'country', value: (r) => nm(r.j.countryId) },
        { key: 'requiredEducation', value: (r) => nm(r.j.requiredEducationLevelId) },
        { key: 'minYears', type: 'number', value: (r) => r.j.minYearsExperience },
        { key: 'employmentType', value: (r) => t.enums.employmentType[r.j.employmentType] },
        { key: 'jobStatus', value: (r) => t.enums.jobStatus[r.j.status] },
        { key: 'outcome', value: (r) => (r.j.closedOutcome ? t.enums.outcome[r.j.closedOutcome] : null) },
        { key: 'hiredSeeker', value: (r) => r.hired },
        { key: 'interestCount', type: 'number', value: (r) => r.count },
        { key: 'publishedAt', type: 'datetime', value: (r) => r.j.publishedAt },
        { key: 'closedAt', type: 'datetime', value: (r) => r.j.closedAt },
      ],
    };
    return sheet;
  }

  private interestsSheet(t: ExportDict): SheetSpec {
    const load = async (skip: number, take: number) => {
      const reqs = await this.db.interestRequest.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      });
      const jobs = await this.db.job.findMany({
        where: { id: { in: [...new Set(reqs.map((r) => r.jobId))] }, deletedAt: undefined },
        select: { id: true, title: true, employerId: true },
      });
      const [employers, seekers] = await Promise.all([
        this.db.employer.findMany({
          where: { id: { in: [...new Set(jobs.map((j) => j.employerId))] }, deletedAt: undefined },
          select: { id: true, organizationName: true },
        }),
        this.seekerNames([...new Set(reqs.map((r) => r.seekerId))]),
      ]);
      return reqs.map((r) => {
        const job = jobs.find((j) => j.id === r.jobId);
        return {
          r,
          title: job?.title ?? null,
          org: employers.find((e) => e.id === job?.employerId)?.organizationName ?? null,
          seeker: seekers.get(r.seekerId),
        };
      });
    };
    type Row = Awaited<ReturnType<typeof load>>[number];
    const sheet: SheetSpec<Row> = {
      key: 'interests',
      rows: () => chunked(load),
      columns: [
        { key: 'jobTitle', width: 28, value: (r) => r.title },
        { key: 'organization', width: 28, value: (r) => r.org },
        { key: 'seekerName', width: 30, value: (r) => r.seeker?.name },
        { key: 'mobile', width: 14, value: (r) => r.seeker?.mobile },
        { key: 'email', width: 28, value: (r) => r.seeker?.email },
        { key: 'interestStatus', value: (r) => t.enums.interest[r.r.status] },
        { key: 'requestedAt', type: 'datetime', value: (r) => r.r.createdAt },
        { key: 'viewedAt', type: 'datetime', value: (r) => r.r.employerViewedAt },
        { key: 'statusChangedAt', type: 'datetime', value: (r) => r.r.statusChangedAt },
      ],
    };
    return sheet;
  }

  /** Jobs closed as "hired via the platform" (FR-2.3.5). */
  private hiresSheet(_t: ExportDict): SheetSpec {
    const load = async (skip: number, take: number) => {
      const jobs = await this.db.job.findMany({
        where: { closedOutcome: 'HIRED_VIA_PLATFORM' },
        orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      });
      const [employers, seekers] = await Promise.all([
        this.db.employer.findMany({
          where: { id: { in: [...new Set(jobs.map((j) => j.employerId))] }, deletedAt: undefined },
          select: { id: true, organizationName: true },
        }),
        this.seekerNames(jobs.map((j) => j.hiredSeekerId).filter((x): x is string => !!x)),
      ]);
      return jobs.map((j) => ({
        j,
        org: employers.find((e) => e.id === j.employerId)?.organizationName ?? null,
        seeker: j.hiredSeekerId ? seekers.get(j.hiredSeekerId) : undefined,
      }));
    };
    type Row = Awaited<ReturnType<typeof load>>[number];
    const sheet: SheetSpec<Row> = {
      key: 'hires',
      rows: () => chunked(load),
      columns: [
        { key: 'jobTitle', width: 28, value: (r) => r.j.title },
        { key: 'organization', width: 28, value: (r) => r.org },
        { key: 'seekerName', width: 30, value: (r) => r.seeker?.name },
        { key: 'mobile', width: 14, value: (r) => r.seeker?.mobile },
        { key: 'email', width: 28, value: (r) => r.seeker?.email },
        { key: 'hiredAt', type: 'datetime', value: (r) => r.j.closedAt },
      ],
    };
    return sheet;
  }

  /** Accounts, with the same filters as S-20. */
  private async usersSheet(t: ExportDict, filters: UserFiltersDto): Promise<SheetSpec> {
    const where = this.users.where(filters);
    const load = async (skip: number, take: number) => {
      const users = await this.db.user.findMany({
        where,
        orderBy: [{ isSystemAccount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      });
      const names = await this.users.rows(users);
      return users.map((u, i) => ({ u, name: names[i].name }));
    };
    type Row = Awaited<ReturnType<typeof load>>[number];
    const sheet: SheetSpec<Row> = {
      key: 'users',
      rows: () => chunked(load),
      columns: [
        { key: 'name', width: 30, value: (r) => r.name },
        { key: 'loginEmail', width: 28, value: (r) => r.u.email },
        { key: 'username', value: (r) => r.u.username },
        { key: 'role', value: (r) => t.enums.role[r.u.role] },
        { key: 'accountStatus', value: (r) => t.enums.userStatus[r.u.status] },
        { key: 'systemAccount', width: 12, value: (r) => this.yesNo(t, r.u.isSystemAccount) },
        { key: 'emailVerifiedAt', type: 'datetime', value: (r) => r.u.emailVerifiedAt },
        { key: 'lastLoginAt', type: 'datetime', value: (r) => r.u.lastLoginAt },
        { key: 'registeredAt', type: 'datetime', value: (r) => r.u.createdAt },
      ],
    };
    return sheet;
  }

  /** The latest EXPORT_AUDIT_LIMIT entries (newest first), with the same filters as S-21. */
  private async auditSheet(t: ExportDict, filters: AuditFiltersDto): Promise<SheetSpec> {
    const where: Prisma.AuditLogWhereInput = await this.auditLog.where(filters);
    const load = async (skip: number, take: number) =>
      this.auditLog.toDtos(
        await this.db.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
        }),
      );
    type Row = Awaited<ReturnType<typeof load>>[number];
    const sheet: SheetSpec<Row> = {
      key: 'audit',
      rows: () => chunked(load, 500, EXPORT_AUDIT_LIMIT),
      columns: [
        { key: 'time', type: 'datetime', value: (r) => new Date(r.createdAt) },
        { key: 'actor', width: 26, value: (r) => r.actorLabel },
        { key: 'actorRole', value: (r) => (r.actorRole ? t.enums.role[r.actorRole as UserRole] : null) },
        { key: 'action', width: 16, value: (r) => r.action },
        { key: 'entity', width: 22, value: (r) => r.entity },
        { key: 'entityId', width: 38, value: (r) => r.entityId },
        { key: 'ip', width: 16, value: (r) => r.ip },
        { key: 'before', width: 50, value: (r) => json(r.before) },
        { key: 'after', width: 50, value: (r) => json(r.after) },
      ],
    };
    return sheet;
  }

  /**
   * S-22 in Excel: the same aggregates and the same suppression as the screen (a hidden group
   * is written as "hidden (fewer than 5)"), plus the filters and the time it was made.
   */
  private reportSheets(
    t: ExportDict,
    locale: ExportLocale,
    r: ReportsDto,
    nm: (id: string | null | undefined) => string | null,
  ): SheetSpec[] {
    const tr = t.reports;
    const hidden = tr.hidden.replace('{min}', String(r.minGroupSize));
    const count = (n: number | null): number | string => (n === null ? hidden : n);
    const named = (row: ReportRow) => (locale === 'ar' ? row.nameAr : row.nameEn) ?? tr.unspecified;
    const lines = (report: string, rows: ReportRow[], label: (row: ReportRow) => string): ReportLine[] =>
      rows.map((row) => ({ report, category: label(row), count: count(row.count) }));
    const one = (report: string, n: number | null): ReportLine => ({
      report,
      category: tr.all,
      count: count(n),
    });
    const s = tr.sections;
    const ageLabel = (row: ReportRow) => tr.ageBands[row.key as keyof typeof tr.ageBands] ?? row.key;
    const seekers: ReportLine[] = [
      one(s.seekersTotal, r.seekers.total),
      one(s.withExperience, r.seekers.withExperience),
      one(s.withoutExperience, r.seekers.withoutExperience),
      ...lines(s.byAge, r.seekers.byAge, ageLabel),
      ...lines(s.byGender, r.seekers.byGender, (x) => t.enums.gender[x.key as 'MALE' | 'FEMALE'] ?? x.key),
      ...lines(s.byEducation, r.seekers.byEducation, named),
      ...lines(
        s.byExperience,
        r.seekers.byExperience,
        (x) => tr.experience[x.key as keyof typeof tr.experience] ?? x.key,
      ),
      ...lines(s.bySector, r.seekers.bySector, named),
      ...lines(s.byNationality, r.seekers.byNationality, named),
    ];
    const jobs: ReportLine[] = [
      one(s.jobsTotal, r.jobs.total),
      one(s.open, r.jobs.open),
      one(s.unavailable, r.jobs.unavailable),
      one(s.hiredViaPlatform, r.jobs.hiredViaPlatform),
      one(s.closedWithoutHiring, r.jobs.closedWithoutHiring),
      one(s.interestRequests, r.jobs.interestRequests),
      ...lines(s.jobsBySector, r.jobs.bySector, named),
      ...lines(s.jobsByStatus, r.jobs.byStatus, (x) => tr.status[x.key as keyof typeof tr.status] ?? x.key),
    ];
    const i = tr.info;
    const info: { item: string; value: string | number | Date }[] = [
      { item: i.generatedAt, value: new Date(r.generatedAt) },
      { item: i.minGroupSize, value: r.minGroupSize },
      { item: i.from, value: r.filters.from ?? tr.all },
      { item: i.to, value: r.filters.to ?? tr.all },
      { item: i.sector, value: nm(r.filters.sectorId) ?? tr.all },
      { item: i.country, value: nm(r.filters.countryId) ?? tr.all },
      { item: i.note, value: '' },
    ];
    const once = <T>(rows: T[]) =>
      async function* () {
        yield rows;
      };
    const reportCols = [
      { key: 'report' as const, width: 30, value: (x: ReportLine) => x.report },
      { key: 'category' as const, width: 34, value: (x: ReportLine) => x.category },
      { key: 'count' as const, type: 'count' as const, value: (x: ReportLine) => x.count },
    ];
    return [
      { key: 'reportSeekers', columns: reportCols, rows: once(seekers) },
      { key: 'reportJobs', columns: reportCols, rows: once(jobs) },
      {
        key: 'reportInfo',
        rows: once(info),
        columns: [
          { key: 'item', width: 34, value: (x: (typeof info)[number]) => x.item },
          {
            key: 'value',
            width: 30,
            type: 'count',
            value: (x: (typeof info)[number]) =>
              x.value instanceof Date
                ? x.value.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })
                : x.value,
          },
        ],
      },
    ];
  }
}
