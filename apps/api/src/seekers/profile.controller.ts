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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  CV_MAX_BYTES,
  CvAnalysisDto,
  FileLinkDto,
  PERMISSIONS,
  PositionDto,
  ProfileDto,
  VerifierDto,
} from '@sanad/shared';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { CvService, IncomingFile } from './cv.service';
import {
  AffiliationStepDto,
  ContactStepDto,
  CorrectSectorDto,
  EducationStepDto,
  ExperienceStepDto,
  PersonalStepDto,
  PositionInputDto,
  ReorderPositionsDto,
  VerifierInputDto,
} from './dto/profile.dto';
import { ProfileService } from './profile.service';

const READ = PERMISSIONS.PROFILE_SELF_READ;
const UPDATE = PERMISSIONS.PROFILE_SELF_UPDATE;

/**
 * The signed-in seeker's own profile (S-05 / S-06). Every route works on the caller's profile
 * only (resolved from the access token), so there is no id to tamper with.
 */
@Controller('me/profile')
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly cv: CvService,
  ) {}

  @RequirePermissions(READ)
  @Get()
  get(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
    return this.profiles.get(user.id);
  }

  // ---- wizard steps -------------------------------------------------------

  @RequirePermissions(UPDATE)
  @Patch('personal')
  personal(@CurrentUser() user: AuthUser, @Body() dto: PersonalStepDto): Promise<ProfileDto> {
    return this.profiles.updatePersonal(user.id, dto);
  }

  @RequirePermissions(UPDATE)
  @Patch('affiliation')
  affiliation(@CurrentUser() user: AuthUser, @Body() dto: AffiliationStepDto): Promise<ProfileDto> {
    return this.profiles.updateAffiliation(user.id, dto);
  }

  @RequirePermissions(UPDATE)
  @Patch('contact')
  contact(@CurrentUser() user: AuthUser, @Body() dto: ContactStepDto): Promise<ProfileDto> {
    return this.profiles.updateContact(user.id, dto);
  }

  @RequirePermissions(UPDATE)
  @Patch('education')
  education(@CurrentUser() user: AuthUser, @Body() dto: EducationStepDto): Promise<ProfileDto> {
    return this.profiles.updateEducation(user.id, dto);
  }

  @RequirePermissions(UPDATE)
  @Patch('experience')
  experience(@CurrentUser() user: AuthUser, @Body() dto: ExperienceStepDto): Promise<ProfileDto> {
    return this.profiles.updateExperience(user.id, dto);
  }

  @RequirePermissions(UPDATE)
  @Post('complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
    return this.profiles.complete(user.id);
  }

  // ---- positions (unlimited) ---------------------------------------------

  @RequirePermissions(READ)
  @Get('positions')
  positions(@CurrentUser() user: AuthUser): Promise<PositionDto[]> {
    return this.profiles.listPositions(user.id);
  }

  @RequirePermissions(UPDATE)
  @Post('positions')
  addPosition(@CurrentUser() user: AuthUser, @Body() dto: PositionInputDto): Promise<PositionDto> {
    return this.profiles.createPosition(user.id, dto);
  }

  @RequirePermissions(UPDATE)
  @Put('positions/order')
  reorder(@CurrentUser() user: AuthUser, @Body() dto: ReorderPositionsDto): Promise<PositionDto[]> {
    return this.profiles.reorderPositions(user.id, dto.ids);
  }

  @RequirePermissions(UPDATE)
  @Patch('positions/:id')
  updatePosition(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PositionInputDto,
  ): Promise<PositionDto> {
    return this.profiles.updatePosition(user.id, id, dto);
  }

  @RequirePermissions(UPDATE)
  @Delete('positions/:id')
  @HttpCode(204)
  deletePosition(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.profiles.deletePosition(user.id, id);
  }

  // ---- verification contact ---------------------------------------------

  @RequirePermissions(UPDATE)
  @Put('verifier')
  putVerifier(@CurrentUser() user: AuthUser, @Body() dto: VerifierInputDto): Promise<VerifierDto> {
    return this.profiles.putVerifier(user.id, dto);
  }

  @RequirePermissions(UPDATE)
  @Delete('verifier')
  @HttpCode(204)
  deleteVerifier(@CurrentUser() user: AuthUser): Promise<void> {
    return this.profiles.deleteVerifier(user.id);
  }

  // ---- CV (S-06) ----------------------------------------------------------

  @RequirePermissions(UPDATE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('cv')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      // no storage/dest: multer keeps the file in memory (max 10 MB), nothing touches the disk
      limits: { fileSize: CV_MAX_BYTES, files: 1, fields: 5 },
      defParamCharset: 'utf8',
    }),
  )
  uploadCv(@CurrentUser() user: AuthUser, @UploadedFile() file?: IncomingFile): Promise<ProfileDto> {
    return this.cv.upload(user.id, file);
  }

  @RequirePermissions(UPDATE)
  @Delete('cv')
  removeCv(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
    return this.cv.remove(user.id);
  }

  /** Signed same-origin link, valid 5 minutes. */
  @RequirePermissions(READ)
  @Post('cv/link')
  @HttpCode(200)
  cvLink(@CurrentUser() user: AuthUser): Promise<FileLinkDto> {
    return this.cv.link(user.id);
  }

  @RequirePermissions(UPDATE)
  @Patch('cv/analysis')
  correctSector(@CurrentUser() user: AuthUser, @Body() dto: CorrectSectorDto): Promise<CvAnalysisDto> {
    return this.cv.correctSector(user.id, dto.sectorId ?? null);
  }
}
