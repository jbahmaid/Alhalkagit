import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  MATCHING_DEBOUNCE_MS,
  PROFILE_UPDATED_JOB,
  ProfileChangeReason,
  ProfileUpdatedJob,
  QUEUES,
} from '../common/queues';

/**
 * Hook for "this seeker's match scores are stale" (architecture section 6). Every profile or CV
 * change calls `changed()`; the worker's MatchingProcessor recomputes the seeker against every
 * open job.
 *
 * Changes within a few seconds are coalesced into one job per seeker (same job id while waiting).
 */
@Injectable()
export class ProfileEventsService {
  private readonly logger = new Logger('ProfileEvents');

  constructor(@InjectQueue(QUEUES.matching) private readonly queue: Queue<ProfileUpdatedJob>) {}

  async changed(seekerId: string, reason: ProfileChangeReason): Promise<void> {
    try {
      await this.queue.add(
        PROFILE_UPDATED_JOB,
        { seekerId, reason, at: new Date().toISOString() },
        {
          jobId: `profile-${seekerId}`,
          delay: MATCHING_DEBOUNCE_MS,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    } catch (err) {
      // Never fail the user's save because the queue is down; scores are recomputed later anyway.
      this.logger.warn(`Could not enqueue profile.updated for ${seekerId}: ${(err as Error).message}`);
    }
  }
}
