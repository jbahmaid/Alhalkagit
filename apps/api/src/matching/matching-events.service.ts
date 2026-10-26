import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  JOB_UPDATED_JOB,
  JobUpdatedJob,
  MATCHING_DEBOUNCE_MS,
  QUEUES,
  RECOMPUTE_ALL_JOB,
  RecomputeAllJob,
} from '../common/queues';

/** API side: "this job changed" (debounced per job) and "settings changed, recompute all". */
@Injectable()
export class MatchingEventsService {
  private readonly logger = new Logger('MatchingEvents');

  constructor(@InjectQueue(QUEUES.matching) private readonly queue: Queue<JobUpdatedJob | RecomputeAllJob>) {}

  async jobChanged(jobId: string): Promise<void> {
    try {
      await this.queue.add(
        JOB_UPDATED_JOB,
        { jobId, at: new Date().toISOString() },
        {
          jobId: `job-${jobId}`,
          delay: MATCHING_DEBOUNCE_MS,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    } catch (err) {
      // Never fail the employer's save because the queue is down; the API scores missing pairs on read.
      this.logger.warn(`Could not enqueue job.updated for ${jobId}: ${(err as Error).message}`);
    }
  }

  /** Matching settings changed: every open job against every seeker (one debounced run). */
  async recomputeAll(): Promise<void> {
    try {
      await this.queue.add(
        RECOMPUTE_ALL_JOB,
        { at: new Date().toISOString() },
        {
          jobId: 'recompute-all',
          delay: MATCHING_DEBOUNCE_MS,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    } catch (err) {
      this.logger.warn(`Could not enqueue recompute.all: ${(err as Error).message}`);
    }
  }
}
