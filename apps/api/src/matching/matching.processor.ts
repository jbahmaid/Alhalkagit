import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  JOB_UPDATED_JOB,
  JobUpdatedJob,
  PROFILE_UPDATED_JOB,
  ProfileUpdatedJob,
  QUEUES,
} from '../common/queues';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from './matching.service';

const SYSTEM_ACTOR = { userId: null, role: null, ip: null, userAgent: 'worker:matching', requestId: null };

/**
 * Recomputes match_scores (architecture section 6):
 *  - profile.updated: one seeker against every open job;
 *  - job.updated: one job against every seeker.
 * Both are debounced by the producers (delayed job with a stable id).
 */
@Processor(QUEUES.matching, { concurrency: 2 })
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger('Matching');

  constructor(
    private readonly matching: MatchingService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<ProfileUpdatedJob | JobUpdatedJob>): Promise<number> {
    return this.prisma.runAs(SYSTEM_ACTOR, async () => {
      if (job.name === PROFILE_UPDATED_JOB) {
        const { seekerId } = job.data as ProfileUpdatedJob;
        const n = await this.matching.recomputeSeeker(seekerId);
        this.logger.log(`profile.updated seeker=${seekerId}: ${n} score(s) changed`);
        return n;
      }
      if (job.name === JOB_UPDATED_JOB) {
        const { jobId } = job.data as JobUpdatedJob;
        const n = await this.matching.recomputeJob(jobId);
        this.logger.log(`job.updated job=${jobId}: ${n} score(s) changed`);
        return n;
      }
      this.logger.warn(`Unknown matching job "${job.name}"`);
      return 0;
    });
  }
}
