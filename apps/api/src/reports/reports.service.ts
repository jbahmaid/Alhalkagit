import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AGE_BANDS,
  REPORT_MIN_GROUP,
  type JobReportDto,
  type OwnJobsReportDto,
  type ReportFilters,
  type ReportRow,
  type ReportsDto,
  type SeekerReportDto,
} from '@sanad/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hideSmall, suppressBreakdown, suppressPair } from './suppress';

/** One aggregate row from the report queries: dimension, category key, count. */
interface Agg {
  dim: string;
  key: string | null;
  n: number;
}

type Named = { id: string; nameAr: string; nameEn: string; sortOrder: number; rank?: number };

/**
 * S-22 (FR-2.5.1 to FR-2.5.3). Read-only aggregate queries over the same population as the
 * `v_report_*` views of migration 0001 (active, not deleted), extended with the nationality and
 * sector breakdowns and the admin filters. Every count is suppressed here, on the server.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  async minGroupSize(): Promise<number> {
    const row = await this.db.setting.findFirst({ where: { key: 'reports.minGroupSize' } });
    const v = typeof row?.value === 'number' ? row.value : REPORT_MIN_GROUP;
    // The setting may raise the threshold, never take it under the documented 5.
    return Math.max(REPORT_MIN_GROUP, Math.floor(v));
  }

  /** Admins: everything, with filters. Employers: the general reports and their own jobs. */
  async report(
    scope: 'all' | 'general',
    filters: ReportFilters,
    employerUserId?: string,
  ): Promise<ReportsDto> {
    const f = scope === 'all' ? filters : {};
    const [min, seekerAgg, jobAgg, lookups] = await Promise.all([
      this.minGroupSize(),
      this.seekerAggregates(f),
      this.jobAggregates(f),
      this.lookups(),
    ]);
    const own = employerUserId ? await this.ownJobs(employerUserId) : null;
    return {
      scope,
      minGroupSize: min,
      filters: f,
      seekers: this.seekerReport(seekerAgg, lookups, min),
      jobs: this.jobReport(jobAgg, lookups, min),
      own,
      generatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Riyadh calendar days, inclusive of `to`. */
  private range(column: Prisma.Sql, f: ReportFilters): Prisma.Sql[] {
    const out: Prisma.Sql[] = [];
    if (f.from) out.push(Prisma.sql`${column} >= (${f.from}::date)::timestamp AT TIME ZONE 'Asia/Riyadh'`);
    if (f.to) out.push(Prisma.sql`${column} < ((${f.to}::date) + 1)::timestamp AT TIME ZONE 'Asia/Riyadh'`);
    return out;
  }

  async seekerAggregates(f: ReportFilters): Promise<Agg[]> {
    const where: Prisma.Sql[] = [
      Prisma.sql`sp.deleted_at IS NULL`,
      Prisma.sql`p.deleted_at IS NULL`,
      Prisma.sql`u.deleted_at IS NULL`,
      Prisma.sql`u.status = 'ACTIVE'`,
      ...this.range(Prisma.sql`sp.created_at`, f),
    ];
    if (f.countryId) where.push(Prisma.sql`p.nationality_id = ${f.countryId}::uuid`);
    if (f.sectorId)
      where.push(Prisma.sql`EXISTS (SELECT 1 FROM experience_positions x
        WHERE x.seeker_id = sp.id AND x.deleted_at IS NULL AND x.sector_id = ${f.sectorId}::uuid)`);
    return this.db.$queryRaw<Agg[]>(Prisma.sql`
      WITH base AS (
        SELECT sp.id, p.gender, p.nationality_id, sp.has_experience,
               date_part('year', age(CURRENT_DATE, p.birth_date))::int AS age
        FROM seeker_profiles sp
        JOIN users u ON u.id = sp.user_id
        JOIN persons p ON p.id = sp.person_id
        WHERE ${Prisma.join(where, ' AND ')}
      )
      SELECT 'total' AS dim, NULL AS key, count(*)::int AS n FROM base
      UNION ALL
      SELECT 'age', CASE WHEN age < 18 THEN 'UNDER_18' WHEN age < 25 THEN '18_24'
                         WHEN age < 35 THEN '25_34' WHEN age < 45 THEN '35_44'
                         WHEN age < 55 THEN '45_54' ELSE '55_PLUS' END, count(*)::int
        FROM base GROUP BY 2
      UNION ALL
      SELECT 'gender', gender::text, count(*)::int FROM base GROUP BY gender
      UNION ALL
      SELECT 'experience', CASE WHEN has_experience IS NULL THEN 'UNSPECIFIED'
                                WHEN has_experience THEN 'YES' ELSE 'NO' END, count(*)::int
        FROM base GROUP BY 2
      UNION ALL
      SELECT 'nationality', nationality_id::text, count(*)::int FROM base GROUP BY nationality_id
      UNION ALL
      SELECT 'education', COALESCE(top.id::text, 'UNSPECIFIED'), count(*)::int
        FROM base b
        LEFT JOIN LATERAL (
          SELECT l.id FROM seeker_educations e
          JOIN education_levels l ON l.id = e.education_level_id
          WHERE e.seeker_id = b.id AND e.deleted_at IS NULL
          ORDER BY l.rank DESC LIMIT 1
        ) top ON TRUE
        GROUP BY 2
      UNION ALL
      SELECT 'sector', x.sector_id::text, count(DISTINCT b.id)::int
        FROM base b
        JOIN experience_positions x ON x.seeker_id = b.id AND x.deleted_at IS NULL
        WHERE x.sector_id IS NOT NULL
        GROUP BY x.sector_id
    `);
  }

  async jobAggregates(f: ReportFilters, employerId?: string): Promise<Agg[]> {
    const where: Prisma.Sql[] = [
      Prisma.sql`j.deleted_at IS NULL`,
      Prisma.sql`e.deleted_at IS NULL`,
      ...this.range(Prisma.sql`j.published_at`, f),
    ];
    if (f.sectorId) where.push(Prisma.sql`j.sector_id = ${f.sectorId}::uuid`);
    if (f.countryId) where.push(Prisma.sql`j.country_id = ${f.countryId}::uuid`);
    if (employerId) where.push(Prisma.sql`j.employer_id = ${employerId}::uuid`);
    return this.db.$queryRaw<Agg[]>(Prisma.sql`
      WITH jb AS (
        SELECT j.id, j.sector_id, j.status, j.closed_outcome
        FROM jobs j JOIN employers e ON e.id = j.employer_id
        WHERE ${Prisma.join(where, ' AND ')}
      )
      SELECT 'total' AS dim, NULL AS key, count(*)::int AS n FROM jb
      UNION ALL
      SELECT 'status', CASE WHEN status = 'OPEN' THEN 'OPEN'
                            ELSE COALESCE(closed_outcome::text, 'CLOSED_WITHOUT_HIRING') END, count(*)::int
        FROM jb GROUP BY 2
      UNION ALL
      SELECT 'sector', sector_id::text, count(*)::int FROM jb GROUP BY sector_id
      UNION ALL
      SELECT 'interests', NULL, count(*)::int
        FROM interest_requests ir JOIN jb ON jb.id = ir.job_id
        WHERE ir.status <> 'WITHDRAWN'
    `);
  }

  private async lookups() {
    const pick = { id: true, nameAr: true, nameEn: true, sortOrder: true } as const;
    // Deactivated items still label existing data (deletedAt undefined: soft-deleted too).
    const [sectors, countries, levels] = await Promise.all([
      this.db.sector.findMany({ where: { deletedAt: undefined }, select: pick }),
      this.db.country.findMany({ where: { deletedAt: undefined }, select: pick }),
      this.db.educationLevel.findMany({ where: { deletedAt: undefined }, select: { ...pick, rank: true } }),
    ]);
    const map = (xs: Named[]) => new Map(xs.map((x) => [x.id, x]));
    return { sectors: map(sectors), countries: map(countries), levels: map(levels) };
  }

  // -------------------------------------------------------------------------
  // Shaping and suppression
  // -------------------------------------------------------------------------

  private static of(agg: Agg[], dim: string) {
    return agg.filter((a) => a.dim === dim && a.n > 0);
  }

  private static scalar(agg: Agg[], dim: string, key: string | null = null): number {
    return agg.find((a) => a.dim === dim && a.key === key)?.n ?? 0;
  }

  /** Rows for fixed keys, in the given order. */
  private static fixed(agg: Agg[], dim: string, order: readonly string[], min: number): ReportRow[] {
    const rows = ReportsService.of(agg, dim)
      .map((a) => ({ key: a.key ?? '', count: a.n }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return suppressBreakdown(rows, min);
  }

  /** Rows keyed by a lookup id, named in both languages, biggest first (ties by list order). */
  private static named(
    agg: Agg[],
    dim: string,
    names: Map<string, Named>,
    min: number,
    order: 'count' | 'rank' = 'count',
  ): ReportRow[] {
    const rows = ReportsService.of(agg, dim).map((a) => {
      const l = a.key ? names.get(a.key) : undefined;
      return {
        key: a.key ?? 'UNSPECIFIED',
        ...(l ? { nameAr: l.nameAr, nameEn: l.nameEn } : {}),
        count: a.n,
        sort: order === 'rank' ? -(l?.rank ?? -1) : (l?.sortOrder ?? 1e9),
      };
    });
    rows.sort((a, b) => (order === 'rank' ? a.sort - b.sort : b.count - a.count || a.sort - b.sort));
    return suppressBreakdown(rows, min).map(({ sort: _sort, ...r }) => r);
  }

  seekerReport(
    agg: Agg[],
    lk: { sectors: Map<string, Named>; countries: Map<string, Named>; levels: Map<string, Named> },
    min: number,
  ): SeekerReportDto {
    const total = ReportsService.scalar(agg, 'total');
    const [withExperience, withoutExperience] = suppressPair(
      ReportsService.scalar(agg, 'experience', 'YES'),
      ReportsService.scalar(agg, 'experience', 'NO'),
      min,
    );
    return {
      total: hideSmall(total, min),
      withExperience,
      withoutExperience,
      byAge: ReportsService.fixed(agg, 'age', AGE_BANDS, min),
      byGender: ReportsService.fixed(agg, 'gender', ['MALE', 'FEMALE'], min),
      byEducation: ReportsService.named(agg, 'education', lk.levels, min, 'rank'),
      byExperience: ReportsService.fixed(agg, 'experience', ['YES', 'NO', 'UNSPECIFIED'], min),
      bySector: ReportsService.named(agg, 'sector', lk.sectors, min),
      byNationality: ReportsService.named(agg, 'nationality', lk.countries, min),
    };
  }

  jobReport(agg: Agg[], lk: { sectors: Map<string, Named> }, min: number): JobReportDto {
    const open = ReportsService.scalar(agg, 'status', 'OPEN');
    const hired = ReportsService.scalar(agg, 'status', 'HIRED_VIA_PLATFORM');
    const closed = ReportsService.scalar(agg, 'status', 'CLOSED_WITHOUT_HIRING');
    const byStatus = ReportsService.fixed(
      agg,
      'status',
      ['OPEN', 'HIRED_VIA_PLATFORM', 'CLOSED_WITHOUT_HIRING'],
      min,
    );
    const shown = (k: string) => {
      const row = byStatus.find((r) => r.key === k);
      return row ? row.count : 0;
    };
    const [openShown, unavailable] = suppressPair(open, hired + closed, min);
    return {
      total: hideSmall(ReportsService.scalar(agg, 'total'), min),
      open: openShown === null ? null : shown('OPEN'),
      unavailable,
      hiredViaPlatform: shown('HIRED_VIA_PLATFORM'),
      closedWithoutHiring: shown('CLOSED_WITHOUT_HIRING'),
      interestRequests: hideSmall(ReportsService.scalar(agg, 'interests'), min),
      bySector: ReportsService.named(agg, 'sector', lk.sectors, min),
      byStatus,
    };
  }

  /** The employer's own jobs: their own data, nothing hidden, no person named. */
  async ownJobs(userId: string): Promise<OwnJobsReportDto> {
    const employer = await this.db.employer.findFirst({ where: { userId }, select: { id: true } });
    const empty: OwnJobsReportDto = {
      total: 0,
      open: 0,
      unavailable: 0,
      hiredViaPlatform: 0,
      closedWithoutHiring: 0,
      interestRequests: 0,
      jobs: [],
    };
    if (!employer) return empty;
    const jobs = await this.db.job.findMany({
      where: { employerId: employer.id },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, title: true, status: true, closedOutcome: true },
    });
    const counts = jobs.length
      ? await this.db.interestRequest.groupBy({
          by: ['jobId'],
          where: { jobId: { in: jobs.map((j) => j.id) }, status: { not: 'WITHDRAWN' } },
          _count: { _all: true },
        })
      : [];
    const n = new Map(counts.map((c) => [c.jobId, c._count._all]));
    const rows = jobs.map((j) => ({ ...j, interestRequests: n.get(j.id) ?? 0 }));
    return {
      total: rows.length,
      open: rows.filter((j) => j.status === 'OPEN').length,
      unavailable: rows.filter((j) => j.status === 'UNAVAILABLE').length,
      hiredViaPlatform: rows.filter((j) => j.closedOutcome === 'HIRED_VIA_PLATFORM').length,
      closedWithoutHiring: rows.filter((j) => j.closedOutcome === 'CLOSED_WITHOUT_HIRING').length,
      interestRequests: rows.reduce((s, j) => s + j.interestRequests, 0),
      jobs: rows,
    };
  }
}
