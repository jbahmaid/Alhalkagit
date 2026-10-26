import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { AdminEmployersService } from './admin-employers.service';
import { EmployersService } from './employers.service';
import {
  AdminEmployersController,
  EmployerController,
  MyInterestsController,
  SeekerJobsController,
} from './jobs.controllers';
import { SeekerJobsService } from './seeker-jobs.service';

/** Employment: employers, jobs, matching on read, interest requests (FR-2.2, FR-2.3). */
@Module({
  imports: [MatchingModule],
  controllers: [SeekerJobsController, MyInterestsController, EmployerController, AdminEmployersController],
  providers: [SeekerJobsService, EmployersService, AdminEmployersService],
})
export class JobsModule {}
