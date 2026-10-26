import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  PERMISSIONS,
  type AdminDashboardDto,
  type AdminLookupItemDto,
  type AdminUserDetailDto,
  type AdminUserRowDto,
  type AuditPageDto,
  type ExportTokenDto,
  type FileLinkDto,
  type MatchingSettingsDto,
  type Paged,
  type ProfileDto,
  type RevealedIdDto,
} from '@sanad/shared';
import type { Response } from 'express';
import { PassThrough } from 'node:stream';
import { TokenService } from '../auth/token.service';
import { Errors } from '../common/app-exception';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { CvService } from '../seekers/cv.service';
import {
  AffiliationStepDto,
  ContactStepDto,
  EducationStepDto,
  ExperienceStepDto,
  PersonalStepDto,
} from '../seekers/dto/profile.dto';
import { ProfileService } from '../seekers/profile.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminLookupsService } from './admin-lookups.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminUsersService } from './admin-users.service';
import {
  AdminChangeEmailDto,
  AdminEmployerUpdateDto,
  AuditQueryDto,
  ChangeRoleDto,
  CreateAdminDto,
  ExportRequestDto,
  ExportTokenRequestDto,
  isExportKind,
  LookupCreateDto,
  LookupUpdateDto,
  MatchingSettingsInputDto,
  UserListQueryDto,
} from './dto/admin.dto';
import { ExportService } from './export/export.service';

const uuid = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound('NOT_FOUND') });
/** Endpoints that check a password: same limit as login. */
const STRICT = { default: { limit: 10, ttl: 60_000 } };
const P = PERMISSIONS;

/** S-17 (FR-2.4.3): counters, oldest pending employers, latest audit entries. */
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @RequirePermissions(P.REPORTS_ALL_READ)
  @Get()
  get(): Promise<AdminDashboardDto> {
    return this.dashboard.get();
  }
}

/** S-19 (FR-2.4.2). Items are deactivated, never deleted. */
@Controller('admin/lookups')
@RequirePermissions(P.LOOKUPS_MANAGE)
export class AdminLookupsController {
  constructor(private readonly lookups: AdminLookupsService) {}

  @Get(':type')
  list(@Param('type') type: string): Promise<AdminLookupItemDto[]> {
    return this.lookups.list(type);
  }

  @Post(':type')
  create(@Param('type') type: string, @Body() dto: LookupCreateDto): Promise<AdminLookupItemDto> {
    return this.lookups.create(type, dto);
  }

  @Patch(':type/:id')
  update(
    @Param('type') type: string,
    @Param('id', uuid) id: string,
    @Body() dto: LookupUpdateDto,
  ): Promise<AdminLookupItemDto> {
    return this.lookups.update(type, id, dto);
  }
}

/** S-20 (FR-2.4.1): every account. Acting on an admin account also needs admins.manage. */
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly profiles: ProfileService,
    private readonly cv: CvService,
  ) {}

  @RequirePermissions(P.USERS_MANAGE)
  @Get()
  list(@Query() q: UserListQueryDto): Promise<Paged<AdminUserRowDto>> {
    return this.users.list(q);
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Get(':id')
  detail(@Param('id', uuid) id: string): Promise<AdminUserDetailDto> {
    return this.users.detail(id);
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string): Promise<AdminUserRowDto> {
    return this.users.suspend(actor, id);
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string): Promise<AdminUserRowDto> {
    return this.users.reactivate(actor, id);
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string): Promise<void> {
    return this.users.remove(actor, id);
  }

  @RequirePermissions(P.ADMINS_MANAGE)
  @Patch(':id/role')
  role(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<AdminUserRowDto> {
    return this.users.changeRole(actor, id, dto.role);
  }

  @RequirePermissions(P.USERS_MANAGE)
  @Throttle(STRICT)
  @Patch(':id/email')
  email(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: AdminChangeEmailDto,
  ): Promise<AdminUserRowDto> {
    return this.users.changeEmail(actor, id, dto);
  }

  @RequirePermissions(P.EMPLOYERS_UPDATE)
  @Patch(':id/employer')
  employer(@Param('id', uuid) id: string, @Body() dto: AdminEmployerUpdateDto): Promise<AdminUserDetailDto> {
    return this.users.updateEmployer(id, dto);
  }

  // ---- seeker profile (the wizard's own rules apply) ------------------------

  @RequirePermissions(P.SEEKERS_READ)
  @Get(':id/profile')
  async profile(@Param('id', uuid) id: string): Promise<ProfileDto> {
    await this.users.seekerUser(id);
    return this.profiles.get(id);
  }

  @RequirePermissions(P.SEEKERS_ID_NUMBER_REVEAL)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/profile/reveal-id')
  @HttpCode(200)
  revealId(@Param('id', uuid) id: string): Promise<RevealedIdDto> {
    return this.users.revealId(id);
  }

  @RequirePermissions(P.SEEKERS_UPDATE)
  @Patch(':id/profile/personal')
  async personal(@Param('id', uuid) id: string, @Body() dto: PersonalStepDto): Promise<ProfileDto> {
    await this.users.seekerUser(id);
    return this.profiles.updatePersonal(id, dto);
  }

  @RequirePermissions(P.SEEKERS_UPDATE)
  @Patch(':id/profile/affiliation')
  async affiliation(@Param('id', uuid) id: string, @Body() dto: AffiliationStepDto): Promise<ProfileDto> {
    await this.users.seekerUser(id);
    return this.profiles.updateAffiliation(id, dto);
  }

  @RequirePermissions(P.SEEKERS_UPDATE)
  @Patch(':id/profile/contact')
  async contact(@Param('id', uuid) id: string, @Body() dto: ContactStepDto): Promise<ProfileDto> {
    await this.users.seekerUser(id);
    return this.profiles.updateContact(id, dto);
  }

  @RequirePermissions(P.SEEKERS_UPDATE)
  @Patch(':id/profile/education')
  async education(@Param('id', uuid) id: string, @Body() dto: EducationStepDto): Promise<ProfileDto> {
    await this.users.seekerUser(id);
    return this.profiles.updateEducation(id, dto);
  }

  @RequirePermissions(P.SEEKERS_UPDATE)
  @Patch(':id/profile/experience')
  async experience(@Param('id', uuid) id: string, @Body() dto: ExperienceStepDto): Promise<ProfileDto> {
    await this.users.seekerUser(id);
    return this.profiles.updateExperience(id, dto);
  }

  @RequirePermissions(P.SEEKERS_READ)
  @Post(':id/profile/cv/link')
  @HttpCode(200)
  async cvLink(@Param('id', uuid) id: string): Promise<FileLinkDto> {
    await this.users.seekerUser(id);
    return this.cv.link(id);
  }
}

/** Admin accounts (SUPER_ADMIN only). */
@Controller('admin/admins')
export class AdminAdminsController {
  constructor(private readonly users: AdminUsersService) {}

  @RequirePermissions(P.ADMINS_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreateAdminDto): Promise<AdminUserRowDto> {
    return this.users.createAdmin(dto);
  }
}

/** S-21: read only. */
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @RequirePermissions(P.AUDIT_READ)
  @Get()
  page(@Query() q: AuditQueryDto): Promise<AuditPageDto> {
    return this.audit.page(q);
  }
}

@Controller('admin/settings')
@RequirePermissions(P.SETTINGS_MANAGE)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('matching')
  get(): Promise<MatchingSettingsDto> {
    return this.settings.get();
  }

  @Put('matching')
  save(@CurrentUser() user: AuthUser, @Body() dto: MatchingSettingsInputDto): Promise<MatchingSettingsDto> {
    return this.settings.save(user.id, dto);
  }
}

/**
 * Excel export (FR-2.5.4, architecture §8): admins only, `data.export`. The admin re-enters the
 * password for a 5-minute export token; the workbook is streamed and never stored.
 */
@Controller('admin/export')
@RequirePermissions(P.DATA_EXPORT)
export class AdminExportController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly tokens: TokenService,
    private readonly exports: ExportService,
  ) {}

  /** The permission is seeded for admins only; the role is checked as well. */
  private adminOnly(user: AuthUser): void {
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') throw Errors.forbidden('PERMISSION_DENIED');
  }

  @Throttle(STRICT)
  @Post('token')
  @HttpCode(200)
  async token(@CurrentUser() user: AuthUser, @Body() dto: ExportTokenRequestDto): Promise<ExportTokenDto> {
    this.adminOnly(user);
    if (!(await this.users.confirmPassword(user.id, dto.password)))
      throw Errors.forbidden('AUTH_WRONG_PASSWORD');
    const { token, expiresAt } = this.tokens.signExport(user.id);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':kind')
  @HttpCode(200)
  async export(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Body() dto: ExportRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    this.adminOnly(user);
    if (!isExportKind(kind)) throw Errors.notFound('NOT_FOUND');
    this.tokens.verifyExport(dto.token, user.id);
    const locale = dto.locale ?? 'ar';
    // Audited before a single byte is sent; a failure while streaming aborts the download.
    const plan = await this.exports.prepare({ kind, locale, users: dto.users, audit: dto.audit });
    const out = new PassThrough();
    this.exports
      .write(plan, locale, out)
      .catch((err) => out.destroy(err instanceof Error ? err : new Error(String(err))));
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(out, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="sanad-${kind}-${date}.xlsx"`,
    });
  }
}
