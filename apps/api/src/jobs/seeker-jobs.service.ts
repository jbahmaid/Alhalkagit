import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MyInterestDto, SeekerJobDto, SeekerJobListDto } from '@sanad/shared';
import { Errors } from '../common/app-exception';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { MatchingService } from '../matching/matching.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { InterestDto, JobsQueryDto } from './dto/jobs.dto';
import { SEEKER_JOB_SELECT, SeekerJobRow, SeekerJobView } from './seeker-job.view';

/**
 * Seeker side of employment: S-07 jobs list, S-08 detail, interest requests, S-09 my requests
 * (FR-2.3.2, FR-2.3.3). Every job read here uses SEEKER_JOB_SELECT, so nothing about the
 * employer is loaded, let alone returned.
 */
@Injectable()
export class SeekerJobsService {
  private readonly logger = new Logger('SeekerJobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly email: EmailQueueService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private async profileOf(userId: string) {
    const profile = await this.db.seekerProfile.findFirst({ where: { userId } });
    if (!profile) throw Errors.notFound('PROFILE_NOT_FOUND');
    return profile;
  }

  async list(userId: string, q: JobsQueryDto): Promise<SeekerJobListDto> {
    const profile = await this.profileOf(userId);
    const where: Prisma.JobWhereInput = { status: 'OPEN' };
    if (q.q) where.title = { contains: q.q, mode: 'insensitive' };
    if (q.sectorId) where.sectorId = q.sectorId;
    if (q.city) where.city = { equals: q.city, mode: 'insensitive' };
    const [rows, cityRows, settings] = await Promise.all([
      this.db.job.findMany({ where, select: SEEKER_JOB_SELECT, orderBy: { publishedAt: 'desc' } }),
      this.db.job.findMany({ where: { status: 'OPEN' }, select: { city: true }, distinct: ['city'] }),
      this.matching.settings(),
    ]);
    const jobs = rows as SeekerJobRow[];
    const [scores, interests] = await Promise.all([
      this.matching.scoresForSeeker(profile.id, jobs),
      this.interestsFor(
        profile.id,
        jobs.map((j) => j.id),
      ),
    ]);
    let items = jobs.map((j) => new SeekerJobView(j, scores.get(j.id)!, interests.get(j.id)));
    if (q.fit) items = items.filter((j) => j.match.label !== 'NONE');
    // Best fit first; newer first among equal scores (rows are already newest first).
    items = items
      .map((j, i) => ({ j, i }))
      .sort((a, b) => b.j.match.score - a.j.match.score || a.i - b.i)
      .map((x) => x.j);
    const cities = [...new Set(cityRows.map((c) => c.city))].sort((a, b) => a.localeCompare(b, 'ar'));
    return { items, cities, thresholds: settings.thresholds };
  }

  /** S-08. A closed job stays visible only to seekers who expressed interest in it. */
  async detail(userId: string, jobId: string): Promise<SeekerJobDto> {
    const profile = await this.profileOf(userId);
    const job = (await this.db.job.findFirst({
      where: { id: jobId },
      select: SEEKER_JOB_SELECT,
    })) as SeekerJobRow | null;
    const interest = job ? (await this.interestsFor(profile.id, [job.id])).get(job.id) : undefined;
    if (!job || (job.status !== 'OPEN' && !interest)) throw Errors.notFound('JOB_NOT_AVAILABLE');
    const scores = await this.matching.scoresForSeeker(profile.id, [job]);
    return new SeekerJobView(job, scores.get(job.id)!, interest);
  }

  /**
   * Interest request with explicit consent (FR-2.3.3). The employer gets an email in their own
   * language with the job title and a link: no seeker ID number, dar or fakhdh.
   */
  async expressInterest(userId: string, jobId: string, dto: InterestDto): Promise<SeekerJobDto> {
    if (dto.consent !== true) throw Errors.badRequest('INTEREST_CONSENT_REQUIRED');
    const profile = await this.profileOf(userId);
    if (!profile.completedAt) throw Errors.conflict('PROFILE_INCOMPLETE');
    const job = await this.db.job.findFirst({ where: { id: jobId }, select: { id: true, status: true } });
    if (!job) throw Errors.notFound('JOB_NOT_AVAILABLE');
    if (job.status !== 'OPEN') throw Errors.conflict('JOB_CLOSED');
    const existing = await this.db.interestRequest.findFirst({ where: { jobId, seekerId: profile.id } });
    if (existing) throw Errors.conflict('INTEREST_EXISTS');

    try {
      await this.db.interestRequest.create({
        data: { jobId, seekerId: profile.id, status: 'SUBMITTED', consentAt: new Date() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('INTEREST_EXISTS');
      }
      throw err;
    }
    await this.notifyEmployer(jobId).catch((e: Error) =>
      this.logger.error(`Could not queue the new-interest email for job ${jobId}: ${e.message}`),
    );
    return this.detail(userId, jobId);
  }

  /** Employer-side lookup kept inside this method: nothing from it reaches the seeker. */
  private async notifyEmployer(jobId: string): Promise<void> {
    const job = await this.db.job.findFirst({
      where: { id: jobId },
      select: { title: true, employerId: true },
    });
    if (!job) return;
    const employer = await this.db.employer.findFirst({
      where: { id: job.employerId },
      select: { email: true, user: { select: { locale: true } } },
    });
    if (!employer) return;
    const locale = employer.user.locale === 'en' ? 'en' : 'ar';
    await this.email.enqueue({
      template: 'newInterest',
      to: employer.email,
      locale,
      vars: {
        jobTitle: job.title,
        link: `${this.config.publicUrl}/${locale}/employer/jobs/${jobId}/applicants`,
      },
    });
  }

  /** S-09. Seekers cannot withdraw in v1. */
  async myInterests(userId: string): Promise<MyInterestDto[]> {
    const profile = await this.profileOf(userId);
    const reqs = await this.db.interestRequest.findMany({
      where: { seekerId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!reqs.length) return [];
    const jobs = await this.db.job.findMany({
      where: { id: { in: reqs.map((r) => r.jobId) }, deletedAt: undefined },
      select: { id: true, title: true, sectorId: true, city: true, status: true, deletedAt: true },
    });
    const byId = new Map(jobs.map((j) => [j.id, j]));
    return reqs
      .filter((r) => byId.has(r.jobId))
      .map((r) => {
        const j = byId.get(r.jobId)!;
        return {
          id: r.id,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          jobAvailable: j.status === 'OPEN' && !j.deletedAt,
          job: { id: j.id, title: j.title, sectorId: j.sectorId, city: j.city },
        };
      });
  }

  private async interestsFor(seekerId: string, jobIds: string[]) {
    if (!jobIds.length) return new Map<string, { status: MyInterestDto['status']; createdAt: Date }>();
    const rows = await this.db.interestRequest.findMany({
      where: { seekerId, jobId: { in: jobIds } },
      select: { jobId: true, status: true, createdAt: true },
    });
    return new Map(rows.map((r) => [r.jobId, { status: r.status, createdAt: r.createdAt }]));
  }
}
