import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProfileUpdatedJob, QUEUES } from '../common/queues';

/**
 * Consumes `profile.updated` jobs. Batch 2: no-op placeholder that only logs at debug level.
 * Batch 3 replaces the body with: delete or recompute match_scores for job.data.seekerId.
 */
@Processor(QUEUES.matching)
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger('Matching');

  async process(job: Job<ProfileUpdatedJob>): Promise<void> {
    this.logger.debug(`profile.updated seeker=${job.data.seekerId} reason=${job.data.reason} (no-op until batch 3)`);
  }
}
