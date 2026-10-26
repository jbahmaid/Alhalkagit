import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AdminEmployerDto,
  ApplicantProfileDto,
  ApplicantsDto,
  EmployerAccountDto,
  EmployerDashboardDto,
  EmployerJobDto,
  FileLinkDto,
  MyInterestDto,
  PERMISSIONS,
  SeekerJobDto,
  SeekerJobListDto,
} from '@sanad/shared';
import { EmployerApprovalStatus } from '@prisma/client';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { Errors } from '../common/app-exception';
import { AdminEmployersService } from './admin-employers.service';
import { CloseJobDto, InterestDto, JobInputDto, JobsQueryDto, RejectEmployerDto } from './dto/jobs.dto';
import { EmployersService } from './employers.service';
import { SeekerJobsService } from './seeker-jobs.service';

const uuid = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound('NOT_FOUND') });

/** Seeker: S-07 / S-08 and interest requests. */
@Controller('jobs')
export class SeekerJobsController {
  constructor(private readonly jobs: SeekerJobsService) {}

  @RequirePermissions(PERMISSIONS.JOBS_BROWSE)
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: JobsQueryDto): Promise<SeekerJobListDto> {
    return this.jobs.list(user.id, q);
  }

  @RequirePermissions(PERMISSIONS.JOBS_BROWSE)
  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<SeekerJobDto> {
    return this.jobs.detail(user.id, id);
  }

  @RequirePermissions(PERMISSIONS.INTERESTS_CREATE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/interest')
  interest(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: InterestDto,
  ): Promise<SeekerJobDto> {
    return this.jobs.expressInterest(user.id, id, dto);
  }
}

/** Seeker: S-09. */
@Controller('me/interests')
export class MyInterestsController {
  constructor(private readonly jobs: SeekerJobsService) {}

  @RequirePermissions(PERMISSIONS.INTERESTS_CREATE)
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<MyInterestDto[]> {
    return this.jobs.myInterests(user.id);
  }
}

/** Employer: S-11..S-16. Account reads need only the role; job management needs approval too. */
@Controller('employer')
export class EmployerController {
  constructor(private readonly employers: EmployersService) {}

  @RequirePermissions(PERMISSIONS.PROFILE_SELF_READ)
  @Get('account')
  account(@CurrentUser() user: AuthUser): Promise<EmployerAccountDto> {
    return this.employers.account(user.id);
  }

  @RequirePermissions(PERMISSIONS.JOBS_OWN_MANAGE)
  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser): Promise<EmployerDashboardDto> {
    return this.employers.dashboard(user.id);
  }

  @RequirePermissions(PERMISSIONS.JOBS_OWN_MANAGE)
  @Post('jobs')
  create(@CurrentUser() user: AuthUser, @Body() dto: JobInputDto): Promise<EmployerJobDto> {
    return this.employers.createJob(user.id, dto);
  }

  @RequirePermissions(PERMISSIONS.JOBS_OWN_MANAGE)
  @Get('jobs/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<EmployerJobDto> {
    return this.employers.getJob(user.id, id);
  }

  @RequirePermissions(PERMISSIONS.JOBS_OWN_MANAGE)
  @Patch('jobs/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: JobInputDto,
  ): Promise<EmployerJobDto> {
    return this.employers.updateJob(user.id, id, dto);
  }

  @RequirePermissions(PERMISSIONS.JOBS_OWN_MANAGE)
  @Post('jobs/:id/close')
  @HttpCode(200)
  close(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: CloseJobDto,
  ): Promise<EmployerJobDto> {
    return this.employers.closeJob(user.id, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INTERESTS_OWN_READ)
  @Get('jobs/:id/applicants')
  applicants(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<ApplicantsDto> {
    return this.employers.applicants(user.id, id);
  }

  @RequirePermissions(PERMISSIONS.INTERESTS_OWN_READ)
  @Get('applicants/:interestId')
  applicant(
    @CurrentUser() user: AuthUser,
    @Param('interestId', uuid) interestId: string,
  ): Promise<ApplicantProfileDto> {
    return this.employers.applicant(user.id, interestId);
  }

  @RequirePermissions(PERMISSIONS.INTERESTS_OWN_READ)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('applicants/:interestId/cv-link')
  @HttpCode(200)
  cvLink(@CurrentUser() user: AuthUser, @Param('interestId', uuid) interestId: string): Promise<FileLinkDto> {
    return this.employers.applicantCvLink(user.id, interestId);
  }
}

/** Admin: employer approval (FR-2.2.2). UI in batch 4. */
@Controller('admin/employers')
export class AdminEmployersController {
  constructor(private readonly admin: AdminEmployersService) {}

  @RequirePermissions(PERMISSIONS.EMPLOYERS_READ)
  @Get()
  list(@Query('status') status?: string): Promise<AdminEmployerDto[]> {
    const valid = Object.values(EmployerApprovalStatus) as string[];
    return this.admin.list(status && valid.includes(status) ? (status as EmployerApprovalStatus) : undefined);
  }

  @RequirePermissions(PERMISSIONS.EMPLOYERS_APPROVE)
  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<AdminEmployerDto> {
    return this.admin.approve(user.id, id);
  }

  @RequirePermissions(PERMISSIONS.EMPLOYERS_APPROVE)
  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', uuid) id: string, @Body() dto: RejectEmployerDto): Promise<AdminEmployerDto> {
    return this.admin.reject(id, dto.reason);
  }
}
