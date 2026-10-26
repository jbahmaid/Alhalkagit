import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../common/queues';
import { MatchingProcessor } from './matching.processor';

/** Worker side of the profile.updated hook (real scoring arrives in batch 3). */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.matching })],
  providers: [MatchingProcessor],
})
export class MatchingModule {}
