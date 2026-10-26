import { Injectable } from '@nestjs/common';
import { AuditAction, Employer, Job } from '@prisma/client';
import {
  ageFrom,
  ApplicantProfileDto,
  ApplicantsDto,
  ApplicantSummaryDto,
  EmployerAccountDto,
  EmployerDashboardDto,
  EmployerJobDto,
  FieldErrorDetail,
  FileLinkDto,
} from '@sanad/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app-exception';
import { FileLinksService } from '../files/file-links.service';
import { MatchingEventsService } from '../matching/matching-events.service';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import { changedFields } from '../seekers/profile.service';
import { CloseJobDto, JobInputDto } from './dto/jobs.dto';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Employer side (S-11..S-16, FR-2.2.x, FR-2.3.1, FR-2.3.4, FR-2.3.5). Every method starts from
 * the signed-in user's own employer row, so an employer can only reach their own jobs and the
 * people who expressed interest in them.
 */
@Injectable()
export class EmployersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly events: MatchingEventsService,
    private readonly links: FileLinksService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async employerOf(userId: string): Promise<Employer> {
    const employer = await this.db.employer.findFirst({ where: { userId } });
    if (!employer) throw Errors.notFound('EMPLOYER_NOT_FOUND');
    return employer;
  }

  /** Unapproved employers cannot post or change jobs (FR-2.2.2, enforced here). */
  private requireApproved(employer: Employer): void {
    if (employer.approvalStatus !== 'APPROVED') {
      throw Errors.forbidden('EMPLOYER_NOT_APPROVED', { approvalStatus: employer.approvalStatus });
    }
  }

  private async ownJob(employer: Employer, jobId: string): Promise<Job> {
    const job = await this.db.job.findFirst({ where: { id: jobId, employerId: employer.id } });
    if (!job) throw Errors.notFound('JOB_NOT_FOUND');
    return job;
  }

  async account(userId: string): Promise<EmployerAccountDto> {
    const employer = await this.employerOf(userId);
    const user = await this.db.user.findFirst({ where: { id: userId }, select: { emailVerifiedAt: true } });
    return toAccountDto(employer, user?.emailVerifiedAt ?? null);
  }

  async dashboard(userId: string): Promise<EmployerDashboardDto> {
    const account = await this.account(userId);
    const employer = await this.employerOf(userId);
    const jobs = await this.db.job.findMany({ where: { employerId: employer.id }, orderBy: { publishedAt: 'desc' } });
    const counts = await this.applicantCounts(jobs.map((j) => j.id));
    const list = jobs.map((j) => toJobDto(j, counts.get(j.id) ?? 0));
    return {
      account,
      stats: {
        openJobs: jobs.filter((j) => j.status === 'OPEN').length,
        interestRequests: [...counts.values()].reduce((a, b) => a + b, 0),
        hiredViaPlatform: jobs.filter((j) => j.closedOutcome === 'HIRED_VIA_PLATFORM').length,
      },
      jobs: list,
    };
  }

  private async applicantCounts(jobIds: string[]): Promise<Map<string, number>> {
    if (!jobIds.length) return new Map();
    const rows = await this.db.interestRequest.groupBy({
      by: ['jobId'],
      where: { jobId: { in: jobIds }, status: { not: 'WITHDRAWN' } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.jobId, r._count._all]));
  }

  private async validateJob(dto: JobInputDto): Promise<void> {
    const errors: FieldErrorDetail[] = [];
    const [sector, country, level] = await Promise.all([
      this.db.sector.count({ where: { id: dto.sectorId, isActive: true } }),
      this.db.country.count({ where: { id: dto.countryId, isActive: true } }),
      dto.requiredEducationLevelId
        ? this.db.educationLevel.count({ where: { id: dto.requiredEducationLevelId, isActive: true } })
        : Promise.resolve(1),
    ]);
    if (!sector) errors.push({ field: 'sectorId', errors: ['LOOKUP_INVALID'] });
    if (!country) errors.push({ field: 'countryId', errors: ['LOOKUP_INVALID'] });
    if (!level) errors.push({ field: 'requiredEducationLevelId', errors: ['LOOKUP_INVALID'] });
    if (errors.length) throw Errors.validation(errors);
  }

  private jobData(dto: JobInputDto) {
    return {
      title: dto.title,
      description: dto.description,
      sectorId: dto.sectorId,
      city: dto.city,
      countryId: dto.countryId,
      requiredEducationLevelId: dto.requiredEducationLevelId ?? null,
      minYearsExperience: dto.minYearsExperience,
      employmentType: dto.employmentType,
    };
  }

  async getJob(userId: string, jobId: string): Promise<EmployerJobDto> {
    const employer = await this.employerOf(userId);
    const job = await this.ownJob(employer, jobId);
    return toJobDto(job, (await this.applicantCounts([job.id])).get(job.id) ?? 0);
  }

  async createJob(userId: string, dto: JobInputDto): Promise<EmployerJobDto> {
    const employer = await this.employerOf(userId);
    this.requireApproved(employer);
    await this.validateJob(dto);
    const job = await this.db.job.create({ data: { ...this.jobData(dto), employerId: employer.id } });
    await this.events.jobChanged(job.id);
    return toJobDto(job, 0);
  }

  async updateJob(userId: string, jobId: string, dto: JobInputDto): Promise<EmployerJobDto> {
    const employer = await this.employerOf(userId);
    this.requireApproved(employer);
    const job = await this.ownJob(employer, jobId);
    if (job.status !== 'OPEN') throw Errors.conflict('JOB_CLOSED');
    await this.validateJob(dto);
    const changes = changedFields(job, this.jobData(dto));
    const saved = Object.keys(changes).length
      ? await this.db.job.update({ where: { id: job.id }, data: changes })
      : job;
    if (Object.keys(changes).length) await this.events.jobChanged(job.id);
    return toJobDto(saved, (await this.applicantCounts([job.id])).get(job.id) ?? 0);
  }

  /** S-16. "Hired via platform" needs one of this job's applicants. The job becomes unavailable. */
  async closeJob(userId: string, jobId: string, dto: CloseJobDto): Promise<EmployerJobDto> {
    const employer = await this.employerOf(userId);
    this.requireApproved(employer);
    const job = await this.ownJob(employer, jobId);
    if (job.status !== 'OPEN') throw Errors.conflict('JOB_CLOSED');
    let hiredSeekerId: string | null = null;
    let hiredInterestId: string | null = null;
    if (dto.outcome === 'HIRED_VIA_PLATFORM') {
      const interest = dto.hiredInterestId
        ? await this.db.interestRequest.findFirst({
            where: { id: dto.hiredInterestId, jobId: job.id, status: { not: 'WITHDRAWN' } },
          })
        : null;
      if (!interest) throw Errors.badRequest('HIRED_APPLICANT_INVALID');
      hiredSeekerId = interest.seekerId;
      hiredInterestId = interest.id;
    }
    const closed = await this.prisma.tx(async () => {
      const updated = await this.db.job.update({
        where: { id: job.id },
        data: { status: 'UNAVAILABLE', closedOutcome: dto.outcome, hiredSeekerId, closedAt: new Date() },
      });
      if (hiredInterestId) {
        await this.db.interestRequest.update({
          where: { id: hiredInterestId },
          data: { status: 'HIRED', statusChangedAt: new Date() },
        });
      }
      return updated;
    });
    return toJobDto(closed, (await this.applicantCounts([job.id])).get(job.id) ?? 0);
  }

  /** S-14: only people who expressed interest in this employer's job. */
  async applicants(userId: string, jobId: string): Promise<ApplicantsDto> {
    const employer = await this.employerOf(userId);
    const job = await this.ownJob(employer, jobId);
    const reqs = await this.db.interestRequest.findMany({
      where: { jobId: job.id, status: { not: 'WITHDRAWN' } },
      orderBy: { createdAt: 'desc' },
    });
    const seekerIds = reqs.map((r) => r.seekerId);
    const [people, scores] = await Promise.all([
      this.peopleOf(seekerIds),
      this.matching.scoresForJob(job, seekerIds),
    ]);
    const applicants: ApplicantSummaryDto[] = reqs.map((r) => {
      const p = people.get(r.seekerId);
      const m = scores.get(r.seekerId);
      return {
        interestId: r.id,
        fullName: p?.fullName ?? '',
        age: p?.age ?? null,
        gender: p?.gender ?? null,
        educationLevelId: p?.educationLevelId ?? null,
        yearsOfExperience: p?.years ?? null,
        match: { score: m?.score ?? 0, label: m?.label ?? 'NONE' },
        status: r.status,
        requestedAt: r.createdAt.toISOString(),
      };
    });
    applicants.sort((a, b) => b.match.score - a.match.score);
    return { job: toJobDto(job, applicants.length), applicants };
  }

  /** Name, age, gender, best education and years for the S-14 rows (no ID, dar or fakhdh). */
  private async peopleOf(seekerIds: string[]) {
    const out = new Map<
      string,
      { fullName: string; age: number | null; gender: 'MALE' | 'FEMALE'; educationLevelId: string | null; years: number | null }
    >();
    if (!seekerIds.length) return out;
    const profiles = await this.db.seekerProfile.findMany({
      where: { id: { in: seekerIds } },
      select: { id: true, personId: true, hasExperience: true, yearsOfExperience: true },
    });
    const persons = await this.db.person.findMany({
      where: { id: { in: profiles.map((p) => p.personId).filter((x): x is string => !!x) } },
      select: PERSON_SAFE_SELECT,
    });
    const eds = await this.db.seekerEducation.findMany({
      where: { seekerId: { in: seekerIds } },
      select: { seekerId: true, educationLevelId: true, educationLevel: { select: { rank: true } } },
    });
    for (const pr of profiles) {
      const person = persons.find((x) => x.id === pr.personId);
      if (!person) continue;
      const best = eds
        .filter((e) => e.seekerId === pr.id)
        .sort((a, b) => b.educationLevel.rank - a.educationLevel.rank)[0];
      out.set(pr.id, {
        fullName: fullName(person),
        age: ageFrom(dateOnly(person.birthDate)),
        gender: person.gender,
        educationLevelId: best?.educationLevelId ?? null,
        years: pr.hasExperience === false ? 0 : pr.yearsOfExperience,
      });
    }
    return out;
  }

  /** The interest request, only if it is on one of this employer's jobs (404 otherwise). */
  private async ownInterest(employer: Employer, interestId: string) {
    const interest = await this.db.interestRequest.findFirst({ where: { id: interestId } });
    const job = interest ? await this.db.job.findFirst({ where: { id: interest.jobId, employerId: employer.id } }) : null;
    if (!interest || !job || interest.status === 'WITHDRAWN') throw Errors.notFound('APPLICANT_NOT_FOUND');
    return { interest, job };
  }

  /** S-15. Never selects the ID number, dar or fakhdh. Marks the request as viewed. */
  async applicant(userId: string, interestId: string): Promise<ApplicantProfileDto> {
    const employer = await this.employerOf(userId);
    const { interest, job } = await this.ownInterest(employer, interestId);
    const profile = await this.db.seekerProfile.findFirstOrThrow({ where: { id: interest.seekerId } });
    const [person, education, positions, verifier, cvFile, analysis, scores] = await Promise.all([
      profile.personId
        ? this.db.person.findFirst({ where: { id: profile.personId }, select: PERSON_SAFE_SELECT })
        : Promise.resolve(null),
      this.db.seekerEducation.findFirst({ where: { seekerId: profile.id }, orderBy: { sortOrder: 'asc' } }),
      this.db.experiencePosition.findMany({ where: { seekerId: profile.id }, orderBy: { sortOrder: 'asc' } }),
      this.db.experienceContact.findFirst({ where: { seekerId: profile.id, positionId: null } }),
      profile.currentCvFileId
        ? this.db.uploadedFile.findFirst({ where: { id: profile.currentCvFileId } })
        : Promise.resolve(null),
      profile.currentCvFileId
        ? this.db.cvAnalysis.findFirst({ where: { fileId: profile.currentCvFileId }, orderBy: { createdAt: 'desc' } })
        : Promise.resolve(null),
      this.matching.scoresForJob(job, [profile.id]),
    ]);

    let status = interest.status;
    if (interest.status === 'SUBMITTED') {
      await this.db.interestRequest.update({
        where: { id: interest.id },
        data: { status: 'VIEWED', employerViewedAt: new Date(), statusChangedAt: new Date() },
      });
      status = 'VIEWED';
    }
    await this.audit.record(AuditAction.VIEW_SENSITIVE, 'seeker_profiles', profile.id, {
      via: 'interest_request',
      interestId: interest.id,
      jobId: job.id,
    });

    const m = scores.get(profile.id);
    return {
      interestId: interest.id,
      jobId: job.id,
      jobTitle: job.title,
      status,
      requestedAt: interest.createdAt.toISOString(),
      match: { score: m?.score ?? 0, label: m?.label ?? 'NONE' },
      fullName: person ? fullName(person) : '',
      age: person ? ageFrom(dateOnly(person.birthDate)) : null,
      gender: person?.gender ?? null,
      nationalityId: person?.nationalityId ?? null,
      hasSpecialNeeds: person?.hasSpecialNeeds ?? null,
      mobile: person?.mobile ?? null,
      email: person?.email ?? null,
      education: education
        ? {
            educationLevelId: education.educationLevelId,
            graduationYear: education.graduationYear,
            institution: education.institution,
            countryId: education.countryId,
            fieldOfStudy: education.fieldOfStudy,
          }
        : null,
      hasExperience: profile.hasExperience,
      yearsOfExperience: profile.yearsOfExperience,
      positions: positions.map((p) => ({
        title: p.title,
        organization: p.organization,
        startDate: dateOnly(p.startDate)!,
        endDate: dateOnly(p.endDate),
      })),
      verifier: verifier ? { name: verifier.name, phone: verifier.phone, email: verifier.email } : null,
      cv: cvFile ? { originalName: cvFile.originalName, sizeBytes: cvFile.sizeBytes, uploadedAt: cvFile.createdAt.toISOString() } : null,
      cvAnalysisStatus: analysis?.status ?? null,
    };
  }

  /** 5-minute signed CV link, only for an applicant of this employer's job. */
  async applicantCvLink(userId: string, interestId: string): Promise<FileLinkDto> {
    const employer = await this.employerOf(userId);
    const { interest } = await this.ownInterest(employer, interestId);
    const profile = await this.db.seekerProfile.findFirstOrThrow({ where: { id: interest.seekerId } });
    if (!profile.currentCvFileId) throw Errors.notFound('CV_NOT_FOUND');
    await this.audit.record(AuditAction.VIEW_SENSITIVE, 'uploaded_files', profile.currentCvFileId, {
      via: 'interest_request',
      interestId: interest.id,
    });
    return this.links.issue(profile.currentCvFileId, userId);
  }
}

/** Person columns an employer may see (S-15). Deliberately no id number, dar or fakhdh. */
const PERSON_SAFE_SELECT = {
  id: true,
  firstName: true,
  fatherName: true,
  grandfatherName: true,
  familyName: true,
  gender: true,
  birthDate: true,
  nationalityId: true,
  hasSpecialNeeds: true,
  mobile: true,
  email: true,
} as const;

function fullName(p: { firstName: string; fatherName: string; grandfatherName: string; familyName: string }) {
  return [p.firstName, p.fatherName, p.grandfatherName, p.familyName].join(' ');
}

export function toAccountDto(e: Employer, emailVerifiedAt: Date | null): EmployerAccountDto {
  return {
    contactName: e.contactName,
    organizationName: e.organizationName,
    sectorId: e.sectorId,
    businessTypeId: e.businessTypeId,
    email: e.email,
    phone: e.phone,
    approvalStatus: e.approvalStatus,
    rejectionReason: e.rejectionReason,
    createdAt: e.createdAt.toISOString(),
    emailVerifiedAt: iso(emailVerifiedAt),
    approvedAt: iso(e.approvedAt),
  };
}

export function toJobDto(j: Job, applicantCount: number): EmployerJobDto {
  return {
    id: j.id,
    title: j.title,
    description: j.description,
    sectorId: j.sectorId,
    city: j.city,
    countryId: j.countryId,
    requiredEducationLevelId: j.requiredEducationLevelId,
    minYearsExperience: j.minYearsExperience,
    employmentType: j.employmentType,
    status: j.status,
    closedOutcome: j.closedOutcome,
    closedAt: iso(j.closedAt),
    publishedAt: j.publishedAt.toISOString(),
    applicantCount,
  };
}
