import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_UPDATED_JOB, JobUpdatedJob, MATCHING_DEBOUNCE_MS, QUEUES } from '../common/queues';

/** API side: "this job changed, recompute it against all seekers" (debounced per job). */
@Injectable()
export class MatchingEventsService {
  private readonly logger = new Logger('MatchingEvents');

  constructor(@InjectQueue(QUEUES.matching) private readonly queue: Queue<JobUpdatedJob>) {}

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
}
