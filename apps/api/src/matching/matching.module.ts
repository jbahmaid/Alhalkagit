import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../common/queues';
import { MatchingEventsService } from './matching-events.service';
import { MatchingProcessor } from './matching.processor';
import { MatchingService } from './matching.service';

/** API side: scoring on read and the job.updated producer. */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.matching })],
  providers: [MatchingService, MatchingEventsService],
  exports: [MatchingService, MatchingEventsService],
})
export class MatchingModule {}

/** Worker side: the processor that recomputes and stores match_scores. */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.matching })],
  providers: [MatchingService, MatchingProcessor],
})
export class MatchingWorkerModule {}
