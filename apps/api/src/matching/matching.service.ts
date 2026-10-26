import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MatchDto } from '@sanad/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  JobFacts,
  MatchResult,
  MatchSettings,
  parseMatchSettings,
  scoreMatch,
  SeekerFacts,
  seekerFacts,
} from './scoring';

type JobRow = {
  id: string;
  sectorId: string;
  requiredEducationLevelId: string | null;
  minYearsExperience: number;
  title: string;
};

/**
 * Loads the inputs of matching from the database and stores the results in match_scores
 * (architecture section 6). Used by the worker (recompute after profile / job changes) and by
 * the API (scores for pairs the worker has not stored yet).
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger('Matching');

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  /** Weights and thresholds from the settings table (defaults when missing or invalid). */
  async settings(): Promise<MatchSettings> {
    const rows = await this.db.setting.findMany({
      where: { key: { in: ['matching.weights', 'matching.thresholds'] } },
    });
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    return parseMatchSettings(get('matching.weights'), get('matching.thresholds'));
  }

  /** Facts for the given seeker profiles (separate queries so soft-deleted rows stay out). */
  async seekerFacts(seekerIds: string[]): Promise<Map<string, SeekerFacts>> {
    const out = new Map<string, SeekerFacts>();
    if (!seekerIds.length) return out;
    const [profiles, educations, positions, levels] = await Promise.all([
      this.db.seekerProfile.findMany({
        where: { id: { in: seekerIds } },
        select: { id: true, hasExperience: true, yearsOfExperience: true, currentCvFileId: true },
      }),
      this.db.seekerEducation.findMany({
        where: { seekerId: { in: seekerIds } },
        select: { seekerId: true, educationLevelId: true, fieldOfStudy: true },
      }),
      this.db.experiencePosition.findMany({
        where: { seekerId: { in: seekerIds } },
        select: { seekerId: true, title: true, sectorId: true },
      }),
      this.db.educationLevel.findMany({ select: { id: true, rank: true } }),
    ]);
    const rank = new Map(levels.map((l) => [l.id, l.rank]));
    const cvIds = profiles.map((p) => p.currentCvFileId).filter((x): x is string => !!x);
    const analyses = cvIds.length
      ? await this.db.cvAnalysis.findMany({
          where: { fileId: { in: cvIds }, status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          select: {
            fileId: true,
            suggestedSectorId: true,
            correctedSectorId: true,
            skills: true,
            inferredYears: true,
          },
        })
      : [];

    for (const p of profiles) {
      const eds = educations.filter((e) => e.seekerId === p.id);
      // Several qualifications are allowed; the highest rank counts (schema comment).
      const best = eds.reduce<{ rank: number | null; field: string | null }>(
        (acc, e) => {
          const r = rank.get(e.educationLevelId) ?? null;
          return r !== null && (acc.rank === null || r > acc.rank) ? { rank: r, field: e.fieldOfStudy } : acc;
        },
        { rank: null, field: null },
      );
      const pos = positions.filter((x) => x.seekerId === p.id);
      const a = analyses.find((x) => x.fileId === p.currentCvFileId);
      out.set(
        p.id,
        seekerFacts({
          analysisSectorId: a ? (a.correctedSectorId ?? a.suggestedSectorId) : null,
          positionSectorIds: pos.map((x) => x.sectorId),
          educationRank: best.rank,
          hasExperience: p.hasExperience,
          yearsOfExperience: p.yearsOfExperience,
          inferredYears: a?.inferredYears ?? null,
          positionTitles: pos.map((x) => x.title),
          fieldOfStudy:
            eds
              .map((e) => e.fieldOfStudy)
              .filter(Boolean)
              .join(' ') || best.field,
          skills: Array.isArray(a?.skills)
            ? (a!.skills as unknown[]).filter((s): s is string => typeof s === 'string')
            : [],
        }),
      );
    }
    return out;
  }

  async jobFacts(jobs: JobRow[]): Promise<Map<string, JobFacts>> {
    const levels = await this.db.educationLevel.findMany({ select: { id: true, rank: true } });
    const rank = new Map(levels.map((l) => [l.id, l.rank]));
    return new Map(
      jobs.map((j) => [
        j.id,
        {
          sectorId: j.sectorId,
          requiredEducationRank: j.requiredEducationLevelId
            ? (rank.get(j.requiredEducationLevelId) ?? null)
            : null,
          minYearsExperience: j.minYearsExperience,
          title: j.title,
        },
      ]),
    );
  }

  private static readonly JOB_SELECT = {
    id: true,
    sectorId: true,
    requiredEducationLevelId: true,
    minYearsExperience: true,
    title: true,
  } as const;

  /** Scores for one seeker against the given jobs: stored rows first, computed for the rest. */
  async scoresForSeeker(seekerId: string, jobs: JobRow[]): Promise<Map<string, MatchDto>> {
    const out = new Map<string, MatchDto>();
    if (!jobs.length) return out;
    const stored = await this.db.matchScore.findMany({
      where: { seekerId, jobId: { in: jobs.map((j) => j.id) } },
    });
    for (const s of stored) out.set(s.jobId, toMatchDto(s));
    const missing = jobs.filter((j) => !out.has(j.id));
    if (missing.length) {
      const [facts, jf, settings] = await Promise.all([
        this.seekerFacts([seekerId]),
        this.jobFacts(missing),
        this.settings(),
      ]);
      const sf = facts.get(seekerId);
      for (const j of missing) {
        const r = sf ? scoreMatch(sf, jf.get(j.id)!, settings) : emptyResult();
        out.set(j.id, r);
      }
    }
    return out;
  }

  /** Scores for many seekers against one job (employer applicants list). */
  async scoresForJob(job: JobRow, seekerIds: string[]): Promise<Map<string, MatchDto>> {
    const out = new Map<string, MatchDto>();
    if (!seekerIds.length) return out;
    const stored = await this.db.matchScore.findMany({
      where: { jobId: job.id, seekerId: { in: seekerIds } },
    });
    for (const s of stored) out.set(s.seekerId, toMatchDto(s));
    const missing = seekerIds.filter((id) => !out.has(id));
    if (missing.length) {
      const [facts, jf, settings] = await Promise.all([
        this.seekerFacts(missing),
        this.jobFacts([job]),
        this.settings(),
      ]);
      for (const id of missing) {
        const sf = facts.get(id);
        out.set(id, sf ? scoreMatch(sf, jf.get(job.id)!, settings) : emptyResult());
      }
    }
    return out;
  }

  /** Worker: recompute one seeker against every open job. Returns how many rows changed. */
  async recomputeSeeker(seekerId: string): Promise<number> {
    const jobs = await this.db.job.findMany({
      where: { status: 'OPEN' },
      select: MatchingService.JOB_SELECT,
    });
    const [facts, jf, settings] = await Promise.all([
      this.seekerFacts([seekerId]),
      this.jobFacts(jobs),
      this.settings(),
    ]);
    const sf = facts.get(seekerId);
    if (!sf) return 0;
    const results = jobs.map((j) => ({ seekerId, jobId: j.id, r: scoreMatch(sf, jf.get(j.id)!, settings) }));
    return this.store(results, { seekerId });
  }

  /** Worker: recompute one job against every seeker who has started a profile. */
  async recomputeJob(jobId: string): Promise<number> {
    const job = await this.db.job.findFirst({
      where: { id: jobId, status: 'OPEN' },
      select: MatchingService.JOB_SELECT,
    });
    if (!job) return 0;
    const seekers = await this.db.seekerProfile.findMany({
      where: { personId: { not: null } },
      select: { id: true },
    });
    const ids = seekers.map((s) => s.id);
    const [facts, jf, settings] = await Promise.all([
      this.seekerFacts(ids),
      this.jobFacts([job]),
      this.settings(),
    ]);
    const results = ids
      .filter((id) => facts.has(id))
      .map((id) => ({ seekerId: id, jobId, r: scoreMatch(facts.get(id)!, jf.get(jobId)!, settings) }));
    return this.store(results, { jobId });
  }

  /**
   * Writes only rows whose score, label or breakdown changed, so unchanged pairs add nothing
   * to the audit log (match_scores is audited like every table).
   */
  private async store(
    results: { seekerId: string; jobId: string; r: MatchResult }[],
    scope: { seekerId?: string; jobId?: string },
  ): Promise<number> {
    const existing = await this.db.matchScore.findMany({ where: scope });
    const byPair = new Map(existing.map((e) => [`${e.seekerId}:${e.jobId}`, e]));
    let changed = 0;
    for (const { seekerId, jobId, r } of results) {
      const cur = byPair.get(`${seekerId}:${jobId}`);
      const breakdown = r.breakdown as unknown as Prisma.InputJsonValue;
      if (cur && cur.score === r.score && cur.label === r.label && sameJson(cur.breakdown, r.breakdown))
        continue;
      changed += 1;
      if (cur) {
        await this.db.matchScore.update({
          where: { id: cur.id },
          data: { score: r.score, label: r.label, breakdown, computedAt: new Date() },
        });
      } else {
        await this.db.matchScore.create({
          data: { seekerId, jobId, score: r.score, label: r.label, breakdown },
        });
      }
    }
    if (changed) this.logger.debug(`match_scores: ${changed} row(s) updated for ${JSON.stringify(scope)}`);
    return changed;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  if (!a || typeof a !== 'object' || !b || typeof b !== 'object') return a === b;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  return (
    ka.length === kb.length &&
    ka.every((k, i) => k === kb[i] && (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
  );
}

function emptyResult(): MatchResult {
  return {
    score: 0,
    label: 'NONE',
    breakdown: {
      sector: 0,
      education: 0,
      experience: 0,
      keywords: 0,
      sectorMatch: false,
      educationMet: false,
      experienceMet: false,
      keywordShare: 0,
    },
  };
}

export function toMatchDto(row: { score: number; label: string; breakdown: unknown }): MatchDto {
  const b = (row.breakdown ?? {}) as Partial<MatchResult['breakdown']>;
  return {
    score: row.score,
    label: row.label as MatchDto['label'],
    breakdown: {
      sector: b.sector ?? 0,
      education: b.education ?? 0,
      experience: b.experience ?? 0,
      keywords: b.keywords ?? 0,
      sectorMatch: !!b.sectorMatch,
      educationMet: !!b.educationMet,
      experienceMet: !!b.experienceMet,
      keywordShare: b.keywordShare ?? 0,
    },
  };
}
