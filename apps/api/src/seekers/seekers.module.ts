import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../common/queues';
import { CvService } from './cv.service';
import { ProfileController } from './profile.controller';
import { ProfileEventsService } from './profile-events.service';
import { ProfileService } from './profile.service';

/** Seekers (employment domain): profile wizard, positions, CV. FR-2.1.2 to FR-2.1.9 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.cvAnalysis }, { name: QUEUES.matching })],
  controllers: [ProfileController],
  providers: [ProfileService, CvService, ProfileEventsService],
  exports: [ProfileService, ProfileEventsService],
})
export class SeekersModule {}
